#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const { extractAutoTags } = require('./lib/autoTags.cjs');
const { isVideoFile, extractVideoFrames } = require('./lib/videoFrames.cjs');
const { generateSearchTokens } = require('./lib/searchTokens.cjs');
const { getDriveClient } = require('./lib/driveOAuth.cjs');
const { uploadPreview } = require('./lib/drivePreviewUpload.cjs');
const { generatePreviewIfNeeded, runWithConcurrency } = require('./lib/previewTranscode.cjs');

const SHARE_ROOT = '/Volumes/TRIBAL';
const CONCURRENCY = 3;
const LOG_PATH = path.join(__dirname, 'preview_log.csv');

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'tk-archive-cd9d0' });
const db = admin.firestore();

function loadRoots() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'roots.json'), 'utf8'));
  return config.roots;
}

function walkVideos(dirPath, acc = []) {
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
      walkVideos(fullPath, acc);
    } else if (entry.isFile() && isVideoFile(fullPath) && !/(_preview\.mp4|\.part\.mp4)$/i.test(entry.name)) {
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

function getMimeType(ext) {
  const map = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    mts: 'video/mp2t',
    m2ts: 'video/mp2t',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

const logRows = ['path,outcome,timestamp,error'];
// Rows are appended to disk immediately as each file finishes, not just
// buffered in memory for the whole ~10,000-file run — a crash, kill, or
// lost SMB mount partway through would otherwise lose the entire log.
function logResult(filePath, outcome, error = '') {
  const safePath = filePath.replace(/"/g, '""');
  const safeError = (error || '').replace(/"/g, '""').replace(/\n/g, ' ');
  const row = `"${safePath}","${outcome}","${new Date().toISOString()}","${safeError}"`;
  logRows.push(row);
  fs.appendFileSync(LOG_PATH, row + '\n');
}

// Hoisted so the top-level run().catch() handler below can still update the
// Firestore scan doc if run() throws before returning it.
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

    const previewPath = await generatePreviewIfNeeded(fullPath);

    const [hash, frames] = await Promise.all([
      calculateHash(fullPath),
      extractVideoFrames(fullPath, fileId),
    ]);

    const previewFileName = path.basename(previewPath);
    const driveFileId = await uploadPreview(driveClient, {
      shareRelativeDir,
      fileName: previewFileName,
      localFilePath: previewPath,
      description: fullPath,
    });

    const autoTags = extractAutoTags(shareRelativePath.split(path.sep));

    const fileDoc = {
      fileId,
      name: path.basename(fullPath),
      path: fullPath,
      source: 'local',
      extension: ext,
      mimeType: getMimeType(ext),
      type: getMimeType(ext),
      size: stat.size,
      hash,
      tags: autoTags,
      searchTokens: generateSearchTokens(path.basename(fullPath), autoTags),
      videoPreviewFrames: frames || null,
      thumbnail: null,
      driveFileId,
      needs_tagging: !!frames,
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

    // Preserve prior curation on re-runs, same rationale as scanner.cjs.
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const PRESERVE_FIELDS = ['tags', 'needs_tagging', 'tagSource', 'taggedAt', 'description', 'descriptionSource', 'copyright', 'license', 'usage'];
      for (const field of PRESERVE_FIELDS) {
        if (existing[field] !== undefined) fileDoc[field] = existing[field];
      }
      fileDoc.searchTokens = generateSearchTokens(fileDoc.name, fileDoc.tags);
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
  const roots = loadRoots();
  const driveClient = await getDriveClient();

  scanRef = db.collection('scans').doc();
  const scanId = scanRef.id;
  await scanRef.set({
    scanId,
    source: 'local',
    archivePath: roots.join(', '),
    status: 'running',
    startedAt: admin.firestore.Timestamp.now(),
    userId: 'scanner-local-preview-cli',
    triggerType: 'manual',
    errors: [],
  });

  let allFiles = [];
  for (const root of roots) {
    console.log(`\n📂 Scanning: ${root}`);
    allFiles = allFiles.concat(walkVideos(root));
  }
  console.log(`\n📁 Found ${allFiles.length} video files across ${roots.length} roots\n`);

  // Header line written up front; logResult() appends each row incrementally
  // as files finish, so the CSV is durable on disk throughout the run.
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
