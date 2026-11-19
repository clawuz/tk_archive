#!/usr/bin/env node

/**
 * One-off backfill: generates the 1600px Storage-hosted preview (see
 * scanner.cjs's uploadImagePreviewIfNeeded, added 2026-10-02) for local
 * images that were scanned BEFORE that existed — those files only have
 * the small 240px inline thumbnail, which the lightbox now falls back to
 * on error, but looks blurry/undersized compared to a real preview.
 *
 * Doesn't touch Firestore at all — just fills in the deterministic
 * Storage object (previews/{fileId}.png) the frontend already knows how
 * to find (getImagePreviewUrl in streamingService.ts), same as a normal
 * scan would for a newly-added file.
 *
 * Usage: node backfillImagePreviews.cjs [--limit N]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);

const admin = require('firebase-admin');
const keyPath = path.join(__dirname, 'functions/config/serviceAccountKey.json');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0',
});
const db = admin.firestore();

const VIDEO_BUCKET = 'tk-archive-cd9d0-videos'; // shared with scanner.cjs, previews/ prefix

async function uploadImagePreviewIfNeeded(fullPath, fileId) {
  const objectName = `previews/${fileId}.png`;
  const bucket = admin.storage().bucket(VIDEO_BUCKET);
  const object = bucket.file(objectName);
  const [exists] = await object.exists();
  if (exists) return 'exists';

  const tmpDir = path.join(os.tmpdir(), `preview-${fileId}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFilePromise('qlmanage', ['-t', '-s', '1600', '-o', tmpDir, fullPath], { timeout: 20000 });
    const outputFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.png'));
    if (outputFiles.length === 0) return 'qlmanage-failed';
    await bucket.upload(path.join(tmpDir, outputFiles[0]), {
      destination: objectName,
      metadata: { contentType: 'image/png' },
    });
    return 'uploaded';
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Pulling the whole `files` collection client-side (24k+ docs, many with
// large inline base64 thumbnails/frames) to filter for images was far too
// slow — querying by mimeType server-side instead. Covers the raster
// types the lightbox actually treats as image/* (see FilePreview in
// DAMDashboard.jsx); PSD/AI/etc. render through a different path (or none)
// and don't need this preview.
const IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff',
  'image/heif', 'image/heic', 'image/svg+xml', 'image/bmp',
  'image/x-sony-arw', 'image/x-canon-cr2',
];

async function run(limit) {
  const results = await Promise.all(
    IMAGE_MIME_TYPES.map((t) =>
      db.collection('files').where('source', '==', 'local').where('mimeType', '==', t).get()
    )
  );
  const images = results.flatMap((snap) => snap.docs);
  const batch = limit ? images.slice(0, limit) : images;
  console.log(`${images.length} yerel görsel bulundu, ${batch.length} tanesi işlenecek.\n`);

  let uploaded = 0, skipped = 0, missing = 0, failed = 0;
  for (const doc of batch) {
    const data = doc.data();
    const filePath = data.path;
    if (!filePath || !fs.existsSync(filePath)) {
      console.log(`  ⏭  ${data.name} — dosya bulunamadı (${filePath})`);
      missing++;
      continue;
    }
    try {
      const result = await uploadImagePreviewIfNeeded(filePath, doc.id);
      if (result === 'exists') {
        skipped++;
      } else if (result === 'uploaded') {
        uploaded++;
        process.stdout.write('.');
      } else {
        failed++;
        console.log(`\n  ✗ ${data.name} — qlmanage başarısız`);
      }
    } catch (err) {
      failed++;
      console.log(`\n  ✗ ${data.name} — ${err.message}`);
    }
  }

  console.log(`\n\nBitti — yüklenen: ${uploaded}, zaten vardı: ${skipped}, dosya bulunamadı: ${missing}, hata: ${failed}`);
}

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : null;
run(limit).catch((err) => {
  console.error('Backfill hatası:', err);
  process.exit(1);
});
