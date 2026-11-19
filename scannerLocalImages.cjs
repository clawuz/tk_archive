#!/usr/bin/env node

// Uploads image files from a local/SMB folder straight to Drive (no preview
// step — unlike video, a photo is already small enough to upload as-is) and
// registers them in Firestore, mirroring scannerLocalPreview.cjs's approach
// for videos. Takes the folder to scan as a CLI arg — this isn't wired into
// roots.json since it targets images specifically, not the video sweep.
//
// Usage: node scannerLocalImages.cjs "/Volumes/TRIBAL/THY/ACCOUNT/2024/Ercan_video_gorsel"

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const { extractAutoTags } = require('./lib/autoTags.cjs');
const { generateSearchTokens, aiSearchText } = require('./lib/searchTokens.cjs');
const { getDriveClient } = require('./lib/driveOAuth.cjs');
const { uploadPreview } = require('./lib/drivePreviewUpload.cjs');
const { runWithConcurrency } = require('./lib/previewTranscode.cjs');

const SHARE_ROOT = '/Volumes/TRIBAL';
const CONCURRENCY = 3;
const LOG_PATH = path.join(__dirname, 'image_log.csv');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('Usage: node scannerLocalImages.cjs <folder>');
  process.exit(1);
}

const IMAGE_EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
  heic: 'image/heic',
  psd: 'image/vnd.adobe.photoshop',
};

function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return ext in IMAGE_EXT_MIME;
}

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'tk-archive-cd9d0' });
const db = admin.firestore();

function walkImages(dirPath, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`\n⚠️  Cannot read directory ${dirPath}: ${err.message}`);
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkImages(fullPath, acc);
    } else if (entry.isFile() && isImageFile(fullPath)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function fileIdFor(fullPath) {
  return crypto.createHash('sha256').update(`local:${fullPath}`).digest('hex').slice(0, 32);
}

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

const logRows = ['path,outcome,timestamp,error'];
function logResult(filePath, outcome, error = '') {
  const safePath = filePath.replace(/"/g, '""');
  const safeError = (error || '').replace(/"/g, '""').replace(/\n/g, ' ');
  const row = `"${safePath}","${outcome}","${new Date().toISOString()}","${safeError}"`;
  logRows.push(row);
  fs.appendFileSync(LOG_PATH, row + '\n');
}

let scanRef = null;

async function processFile(fullPath, driveClient, scanId) {
  const fileId = fileIdFor(fullPath);

  try {
    const existingSnap = await db.collection('files').doc(fileId).get();
    if (existingSnap.exists && existingSnap.data().driveFileId) {
      logResult(fullPath, 'skipped-already-done');
      return;
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase().slice(1);
    const shareRelativePath = path.relative(SHARE_ROOT, fullPath);
    const shareRelativeDir = path.dirname(shareRelativePath);

    const hash = await calculateHash(fullPath);

    const driveFileId = await uploadPreview(driveClient, {
      shareRelativeDir,
      fileName: path.basename(fullPath),
      localFilePath: fullPath,
      description: fullPath,
      mimeType: IMAGE_EXT_MIME[ext] || 'application/octet-stream',
    });

    const autoTags = extractAutoTags(shareRelativePath.split(path.sep));

    const fileDoc = {
      fileId,
      name: path.basename(fullPath),
      path: fullPath,
      source: 'local',
      extension: ext,
      mimeType: IMAGE_EXT_MIME[ext] || 'application/octet-stream',
      type: IMAGE_EXT_MIME[ext] || 'application/octet-stream',
      size: stat.size,
      hash,
      tags: autoTags,
      searchTokens: generateSearchTokens(path.basename(fullPath), autoTags),
      thumbnail: null,
      driveFileId,
      needs_tagging: false,
      createdAt: stat.birthtime.getTime(),
      modifiedAt: stat.mtime.getTime(),
      uploadedAt: Date.now(),
      scanId,
      lastScanAt: Date.now(),
      copyright: { owner: 'TK', year: new Date().getFullYear() },
      license: { type: 'commercial', name: 'Commercial Use' },
      status: 'active',
      isDeleted: false,
    };

    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const PRESERVE_FIELDS = ['tags', 'needs_tagging', 'tagSource', 'taggedAt', 'ai', 'description', 'descriptionSource', 'copyright', 'license', 'usage'];
      for (const field of PRESERVE_FIELDS) {
        if (existing[field] !== undefined) fileDoc[field] = existing[field];
      }
      fileDoc.searchTokens = generateSearchTokens(fileDoc.name, fileDoc.tags, aiSearchText(fileDoc.ai));
    }

    await db.collection('files').doc(fileId).set(fileDoc);
    logResult(fullPath, 'processed');
    process.stdout.write('.');
  } catch (err) {
    logResult(fullPath, 'failed', err.message);
    process.stderr.write('x');
  }
}

async function run() {
  const driveClient = await getDriveClient();

  scanRef = db.collection('scans').doc();
  const scanId = scanRef.id;
  await scanRef.set({
    scanId,
    source: 'local-image',
    archivePath: ROOT,
    status: 'running',
    startedAt: admin.firestore.Timestamp.now(),
    userId: 'scanner-local-images-cli',
    triggerType: 'manual',
    errors: [],
  });

  console.log(`\n📂 Scanning: ${ROOT}`);
  const allFiles = walkImages(ROOT);
  console.log(`\n🖼️  Found ${allFiles.length} image files\n`);

  fs.writeFileSync(LOG_PATH, logRows[0] + '\n');

  await runWithConcurrency(allFiles, CONCURRENCY, (f) => processFile(f, driveClient, scanId));

  console.log(`\n\n📝 Log written to ${LOG_PATH}`);

  await scanRef.update({
    status: 'completed',
    completedAt: admin.firestore.Timestamp.now(),
    results: { totalFiles: allFiles.length },
  });

  console.log(`✨ Done. ${allFiles.length} files considered.`);
  process.exit(0);
}

run().catch(async (err) => {
  console.error('\n❌ Scan failed:', err);
  if (scanRef) {
    await scanRef
      .update({
        status: 'failed',
        completedAt: admin.firestore.Timestamp.now(),
        error: err.message,
      })
      .catch(() => {});
  }
  process.exit(1);
});
