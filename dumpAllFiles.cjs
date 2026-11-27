#!/usr/bin/env node

/**
 * One-time cache dump of {id, name, path} for every files/ doc, so folder
 * searches for the Telif.pdf matching task don't need to rescan Firestore
 * (183k reads) every time. Metadata-only.
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
const PAGE_SIZE = 1000;
const outPath = '/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/all_files_cache.jsonl';

async function run() {
  const out = fs.createWriteStream(outPath);
  let lastDoc = null;
  let total = 0;
  while (true) {
    let q = db.collection('files').select('name', 'path', 'source').orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((doc) => {
      const d = doc.data();
      out.write(JSON.stringify({ id: doc.id, name: d.name || '', path: d.path || '', source: d.source || '' }) + '\n');
      total++;
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  out.end();
  console.log(`Dumped ${total} files to ${outPath}`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
