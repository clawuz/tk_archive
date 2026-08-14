#!/usr/bin/env node

/**
 * Removes a fixed list of confirmed-meaningless tags from both the tags
 * collection (deletes the doc) and every files/{fileId} doc whose tags
 * array contains one of them. Metadata-only — reads/writes existing
 * Firestore docs, no downloads, no external API calls.
 *
 * The list is hardcoded per-run rather than read from argv/stdin: each
 * cleanup pass is a deliberate, reviewed batch (see chat history for what
 * was reviewed and why), not a generic "delete whatever's passed in" tool.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const TAGS_TO_REMOVE = [
  'tek-satir-yatay-tire',
  'tek-satir-dikey-tire',
  'cift-satir-yatay-tire',
  'cift-satir-dikey-tire',
  'web',
  'dokulu',
  'pamuk',
  'modal',
  'renkli-disi',
  'renkli-disi-renkli-zemin',
  'siyah-disi',
  '4-ekim',
  '3-ekim',
  's-pamuk',
  's-modal',
  's-lacos',
  'l-lacos',
  'b-pamuk',
  'b-modal',
  'uniform',
  'condensed',
  'round',
  '03-tipografi',
  'pngler',
];

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0',
});

const db = admin.firestore();
const REMOVE_SET = new Set(TAGS_TO_REMOVE);

async function run() {
  console.log(`🗑️  Removing ${TAGS_TO_REMOVE.length} tags:`, TAGS_TO_REMOVE.join(', '));

  // 1. Delete the tag vocabulary docs
  const tagBatch = db.batch();
  for (const tag of TAGS_TO_REMOVE) {
    tagBatch.delete(db.collection('tags').doc(tag));
  }
  await tagBatch.commit();
  console.log(`✅ Deleted ${TAGS_TO_REMOVE.length} docs from tags collection`);

  // 2. Strip them from every file's tags array
  console.log('📁 Scanning files collection...');
  let lastDoc = null;
  let scanned = 0;
  let updated = 0;
  const PAGE_SIZE = 500;

  while (true) {
    let q = db.collection('files').orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      scanned++;
      const tags = docSnap.data().tags || [];
      const filtered = tags.filter((t) => !REMOVE_SET.has(t));
      if (filtered.length !== tags.length) {
        batch.update(docSnap.ref, { tags: filtered });
        batchCount++;
        updated++;
      }
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
