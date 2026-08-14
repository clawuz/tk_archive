#!/usr/bin/env node

/**
 * One-time backfill: computes searchTokens (see lib/searchTokens.cjs) for
 * every existing files/{fileId} doc from its current name/tags. Going
 * forward, scanner.cjs/scannerDrive.cjs compute this at scan time and
 * damService.ts's addTagsToFile/removeTagFromFile keep it in sync when
 * tags change through the UI — this script only covers files that already
 * existed before that wiring landed. Metadata-only: reads/writes existing
 * Firestore docs, no downloads, no external API calls.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { generateSearchTokens } = require('./lib/searchTokens.cjs');

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0',
});

const db = admin.firestore();
const PAGE_SIZE = 500;

async function run() {
  console.log('📊 Backfilling searchTokens for all files...');
  let lastDoc = null;
  let scanned = 0;
  let updated = 0;

  while (true) {
    let q = db.collection('files').orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      scanned++;
      const data = docSnap.data();
      const tokens = generateSearchTokens(data.name, data.tags || []);
      batch.update(docSnap.ref, { searchTokens: tokens });
      batchCount++;
      updated++;
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    process.stdout.write('.');
    if (snap.docs.length < PAGE_SIZE) break;
  }

  console.log(`\n📊 Scanned ${scanned} files, updated ${updated} files`);
  console.log('✅ Done');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
