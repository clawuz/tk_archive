#!/usr/bin/env node

/**
 * Adds a shared tag to every file that got copyright/license data from
 * Telif.pdf, so they can all be found together in the app's tag filter /
 * search (the DAM has no folder concept — tags are the grouping mechanism).
 * Mirrors damService.ts's addTagsToFile: appends to the file's own `tags`
 * array, recomputes searchTokens, and keeps the `tags` collection's
 * usageCount aggregate in sync (the same aggregate the tag filter
 * checkboxes and search autocomplete read from).
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
const TAG = 'telif-dokumani-2026';

const fileIds = JSON.parse(
  fs.readFileSync('/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/telif_all_tagged_ids.json', 'utf8')
);

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  let tagged = 0;
  let alreadyTagged = 0;
  let missing = 0;

  // Firestore writes must be chunked under the 500-op batch limit.
  let batch = db.batch();
  let opsInBatch = 0;
  const batches = [];

  for (const fileId of fileIds) {
    const ref = db.collection('files').doc(fileId);
    const snap = await ref.get();
    if (!snap.exists) {
      missing++;
      continue;
    }
    const data = snap.data();
    const currentTags = data.tags || [];
    if (currentTags.includes(TAG)) {
      alreadyTagged++;
      continue;
    }
    const newTags = [...currentTags, TAG];
    const searchTokens = generateSearchTokens(data.name || '', newTags);

    if (!dryRun) {
      batch.update(ref, { tags: newTags, searchTokens });
      opsInBatch++;
      if (opsInBatch >= 400) {
        batches.push(batch);
        batch = db.batch();
        opsInBatch = 0;
      }
    }
    tagged++;
  }
  if (opsInBatch > 0) batches.push(batch);

  console.log(dryRun ? '=== DRY RUN (no writes) ===' : '=== APPLYING TAG ===');
  console.log(`Tag: "${TAG}"`);
  console.log(`Files to tag now: ${tagged}`);
  console.log(`Already tagged: ${alreadyTagged}`);
  console.log(`Missing (no doc found): ${missing}`);

  if (!dryRun) {
    for (const b of batches) await b.commit();

    // Keep the tags/ aggregate collection in sync (usageCount = total files
    // carrying this tag now).
    const totalWithTag = tagged + alreadyTagged;
    await db.collection('tags').doc(TAG).set(
      { tagId: TAG, displayName: TAG, usageCount: totalWithTag },
      { merge: true }
    );
    console.log(`\nDone — tagged ${tagged} files, tags/${TAG} usageCount set to ${totalWithTag}.`);
  } else {
    console.log('\n(dry run — nothing written; re-run without --dry-run to apply)');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
