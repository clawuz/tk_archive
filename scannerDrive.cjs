#!/usr/bin/env node

/**
 * TK Archive Google Drive Scanner
 * Scans Google Drive folder and populates Firestore with file metadata
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const { extractAutoTags } = require('./lib/autoTags.cjs');

console.log('📦 Loading firebase-admin...');
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0'
});

const db = admin.firestore();

// Drive-sourced videos play directly from Google's own embeddable viewer
// (https://drive.google.com/file/d/{id}/preview — see streamingService.ts),
// and are NEVER downloaded by this scanner — not even briefly for frame
// extraction. A real archive is too large for that to be a one-time cost:
// every scan would re-download every video's full bytes just to re-scan a
// folder for a few new files. Claude Vision tagging works from Drive's
// single auto-generated thumbnail instead (functions/tagNewFiles.js),
// backed by the folder/filename auto-tags below and a taxonomy prompt that
// knows a single frame is limited evidence.

// Configuration — a real folder ID is required (not 'root'/My Drive): a
// service account has no personal Drive of its own, so it can only see
// folders explicitly shared with it (see authorize() below).
const DRIVE_FOLDER_ID = process.argv[2];
const DRIVE_FOLDER_NAME = process.argv[3] || 'Google Drive';

if (!DRIVE_FOLDER_ID) {
  console.error('❌ Missing folder ID.');
  console.error('\nUsage: node scannerDrive.cjs <driveFolderId> [folderName]');
  console.error(`\nThe folder must first be shared (Viewer access is enough) with:`);
  console.error(`  archive-scanner@tk-archive-cd9d0.iam.gserviceaccount.com`);
  console.error('\nThe folder ID is the last segment of its Drive URL:');
  console.error('  https://drive.google.com/drive/folders/<THIS PART>\n');
  process.exit(1);
}

console.log(`\n📂 Scanning Google Drive folder: ${DRIVE_FOLDER_NAME}`);
console.log(`🔄 Folder ID: ${DRIVE_FOLDER_ID}\n`);

// Service-account auth: the scanner runs unattended (no browser, no user
// consent screen), so it authenticates as its own Google identity rather
// than a real user's — archive-scanner@tk-archive-cd9d0.iam.gserviceaccount.com.
// That identity only sees Drive folders explicitly shared with it.
function authorize() {
  const keyPath = path.join(__dirname, 'functions/config/driveServiceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    console.error('❌ Drive service account key not found!');
    console.error(`\nExpected: ${keyPath}`);
    console.error('Generate one with:');
    console.error('  gcloud iam service-accounts keys create functions/config/driveServiceAccountKey.json \\');
    console.error('    --iam-account=archive-scanner@tk-archive-cd9d0.iam.gserviceaccount.com\n');
    process.exit(1);
  }
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

async function getMimeType(mimeType) {
  const mimeMap = {
    'application/vnd.google-apps.folder': 'folder',
    'image/jpeg': 'image/jpeg',
    'image/png': 'image/png',
    'image/gif': 'image/gif',
    'image/webp': 'image/webp',
    'video/mp4': 'video/mp4',
    'video/quicktime': 'video/quicktime',
    'application/pdf': 'application/pdf',
    'application/msword': 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeMap[mimeType] || mimeType || 'application/octet-stream';
}

// folderPath accumulates folder names from the scan root down (used for
// extractAutoTags, same as scanner.cjs's relative-path breadcrumb for local
// files) — [DRIVE_FOLDER_NAME] at the top call, one more segment per level
// of recursion. depth is just a sanity cap against runaway recursion.
async function scanDriveFolder(drive, folderId, scanId, folderPath = [], depth = 0) {
  const files = [];
  if (depth > 10) {
    console.warn(`\n⚠️  Max folder depth (10) reached at ${folderPath.join('/')}, not recursing further`);
    return files;
  }
  let pageToken = null;

  try {
    do {
      console.log('.');
      process.stdout.write('.');

      const result = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, videoMediaMetadata)',
        pageSize: 100,
        pageToken: pageToken
      });

      const driveFiles = result.data.files || [];

      for (const file of driveFiles) {
        // Recurse into subfolders — the archive is organized this way
        // (AIRCRAFTS, CABIN-CREW, STOCK FOOTAGE, ...), so a flat single-level
        // scan was missing almost everything.
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          const subFiles = await scanDriveFolder(drive, file.id, scanId, [...folderPath, file.name], depth + 1);
          files.push(...subFiles);
          continue;
        }

        const resolvedMimeType = await getMimeType(file.mimeType);
        const extension = file.name.split('.').pop() || '';


        const fileDoc = {
          fileId: file.id,
          name: file.name,
          path: file.webViewLink || `https://drive.google.com/file/d/${file.id}`,
          source: 'drive',
          extension,
          mimeType: resolvedMimeType,
          type: file.mimeType,
          size: parseInt(file.size) || 0,
          hash: `drive:${file.id}`, // Google Drive IDs as hash
          tags: extractAutoTags([...folderPath, file.name]),
          createdAt: new Date(file.createdTime).getTime(),
          modifiedAt: new Date(file.modifiedTime).getTime(),
          uploadedAt: Date.now(),
          scanId,
          lastScanAt: Date.now(),
          driveFileId: file.id,
          driveFolderId: folderId,
          thumbnail: file.thumbnailLink ? {
            url: file.thumbnailLink,
            generated: false,
            generatedAt: Date.now()
          } : null,
          // This scanner never produces frames itself (no video download —
          // see the comment near VIDEO scanning above); the batch curation
          // preserve step below carries forward videoPreviewFrames from an
          // existing doc if an earlier one-off pass put any there.
          videoPreviewFrames: null,
          // Real dimensions from Drive's own metadata (no download — see the
          // comment near VIDEO scanning above) so the player UI can size its
          // box to the video's actual orientation instead of assuming 16:9.
          videoWidth: file.videoMediaMetadata?.width || null,
          videoHeight: file.videoMediaMetadata?.height || null,
          // Flag for the server-side Claude Vision tagging function
          // (functions/tagNewFiles.js) — same as scanner.cjs's local files.
          needs_tagging: !!file.thumbnailLink,
          copyright: {
            owner: 'TK',
            year: new Date().getFullYear()
          },
          license: {
            type: 'commercial',
            name: 'Commercial Use'
          },
          status: 'active',
          isDeleted: false
        };

        files.push(fileDoc);
      }

      pageToken = result.data.nextPageToken;
    } while (pageToken);

  } catch (err) {
    console.error(`\n❌ Error scanning Drive folder ${folderPath.join('/')}:`, err.message);
  }

  return files;
}

async function run() {
  const startTime = Date.now();

  try {
    // Create Google Drive API client
    const auth = authorize();
    const drive = google.drive({ version: 'v3', auth });

    // Create scan document
    const scanRef = db.collection('scans').doc();
    const scanId = scanRef.id;

    await scanRef.set({
      scanId,
      source: 'drive',
      archivePath: DRIVE_FOLDER_NAME,
      driveFolderId: DRIVE_FOLDER_ID,
      status: 'running',
      startedAt: admin.firestore.Timestamp.now(),
      userId: 'scanner-cli',
      triggerType: 'manual',
      errors: []
    });

    console.log(`\n✅ Created scan: ${scanId}\n`);

    // Scan Drive folder
    console.log(`🔍 Scanning Google Drive...`);
    const files = await scanDriveFolder(drive, DRIVE_FOLDER_ID, scanId, [DRIVE_FOLDER_NAME]);
    console.log(`\n📁 Found ${files.length} files\n`);

    // Preserve curation from previous scans — same reasoning as
    // scanner.cjs: batch.set(fileRef, file) below is a full overwrite per
    // file, so without this a re-scan would wipe tags/copyright edits and
    // re-flag needs_tagging, re-billing Claude Vision on every re-scan.
    console.log(`🔎 Checking for existing curation to preserve...`);
    const PRESERVE_FIELDS = [
      'tags', 'needs_tagging', 'tagSource', 'taggedAt',
      'description', 'descriptionSource', 'copyright', 'license', 'usage',
      // Carries forward frames from an earlier one-off pass, if any exist —
      // this scanner itself never downloads a video to produce them.
      'videoPreviewFrames',
    ];
    const existingByFileId = new Map();
    const CHUNK_SIZE = 300;
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const refs = chunk.map((f) => db.collection('files').doc(f.fileId));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) existingByFileId.set(snap.id, snap.data());
      }
    }
    for (const file of files) {
      const existing = existingByFileId.get(file.fileId);
      if (!existing) continue;
      for (const field of PRESERVE_FIELDS) {
        if (existing[field] !== undefined) file[field] = existing[field];
      }
    }
    console.log(`  Preserved curation on ${existingByFileId.size} already-scanned files\n`);

    // Write files to Firestore (batch)
    if (files.length > 0) {
      console.log(`💾 Writing to Firestore...`);
      const batchSize = 500;

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = db.batch();
        const batchFiles = files.slice(i, i + batchSize);

        for (const file of batchFiles) {
          const fileRef = db.collection('files').doc(file.fileId);
          batch.set(fileRef, file);
        }

        await batch.commit();
        console.log(`  Batch ${Math.floor(i / batchSize) + 1}: ${batchFiles.length} files written`);
      }
      console.log(`✅ Wrote ${files.length} total files to Firestore\n`);
    }

    // Update scan with results
    const duration = Date.now() - startTime;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

    await scanRef.update({
      status: 'completed',
      completedAt: admin.firestore.Timestamp.now(),
      duration,
      results: {
        totalFiles: files.length,
        totalSizeBytes,
        totalSizeGB: Math.round(totalSizeBytes / 1024 / 1024 / 1024 * 100) / 100,
        newFiles: files.length,
        deletedFiles: 0,
        modifiedFiles: 0,
        unchangedFiles: 0,
        fileTypes: {}
      }
    });

    console.log(`✨ Scan completed!`);
    console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
    console.log(`📊 Total files: ${files.length}`);
    console.log(`💾 Total size: ${Math.round(totalSizeBytes / 1024 / 1024 / 1024 * 100) / 100} GB\n`);

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Scan failed:`, error.message);
    console.error(error);
    process.exit(1);
  }
}

run();
