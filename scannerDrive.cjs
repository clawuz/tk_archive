#!/usr/bin/env node

/**
 * TK Archive Google Drive Scanner
 * Scans Google Drive folder and populates Firestore with file metadata
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const admin = require('firebase-admin');

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
// so unlike scanner.cjs's local videos, nothing here needs downloading or
// re-uploading to Cloud Storage. Cheaper and simpler: no bandwidth, no
// duplicate storage, and Drive already serves it reliably.

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

async function scanDriveFolder(drive, folderId, scanId) {
  const files = [];
  let pageToken = null;

  try {
    do {
      console.log('.');
      process.stdout.write('.');

      const result = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink)',
        pageSize: 100,
        pageToken: pageToken
      });

      const driveFiles = result.data.files || [];

      for (const file of driveFiles) {
        // Skip Google Workspace files (folders, docs, etc)
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          // Optionally recurse into folders
          // const subFiles = await scanDriveFolder(drive, file.id, scanId);
          // files.push(...subFiles);
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
          tags: [],
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
    console.error(`\n❌ Error scanning Drive:`, err.message);
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
    const files = await scanDriveFolder(drive, DRIVE_FOLDER_ID, scanId);
    console.log(`\n📁 Found ${files.length} files\n`);

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
