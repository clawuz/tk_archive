#!/usr/bin/env node

/**
 * One-time aggregation: counts every tag across all files/{fileId} docs and
 * writes {tagId, displayName, usageCount} into the tags collection.
 *
 * Needed because the tags collection had no writer at all before this —
 * damService.ts's addTagsToFile/removeTagFromFile only ever touched each
 * file's own `tags` array, never the separate `tags` collection that
 * getTags() (the tag filter checkboxes, and search autocomplete) reads
 * from. That's now fixed going forward (see bumpTagUsage in damService.ts);
 * this script backfills the counts for tags that already existed on files
 * before that fix landed. Re-running it is safe (idempotent — it always
 * recomputes counts from the current file tags, not incrementally).
 *
 * Metadata-only: reads file docs already in Firestore, no downloads, no
 * external API calls.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

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
  console.log('📊 Aggregating tags from the files collection...');
  const counts = new Map();
  let lastDoc = null;
  let totalFiles = 0;

  while (true) {
    let q = db.collection('files').orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      totalFiles++;
      const tags = docSnap.data().tags || [];
      for (const t of tags) {
        if (!t) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    process.stdout.write('.');
    if (snap.docs.length < PAGE_SIZE) break;
  }

  console.log(`\n📁 Scanned ${totalFiles} files, found ${counts.size} unique tags`);

  const entries = [...counts.entries()];
  const BATCH_SIZE = 400;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const [tagId, usageCount] of entries.slice(i, i + BATCH_SIZE)) {
      const ref = db.collection('tags').doc(tagId);
      batch.set(ref, { tagId, displayName: tagId, usageCount }, { merge: true });
    }
    await batch.commit();
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${Math.min(BATCH_SIZE, entries.length - i)} tags written`);
  }

  console.log('✅ Tags collection backfilled');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err.message);
  process.exit(1);
});
