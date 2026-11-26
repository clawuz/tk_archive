#!/usr/bin/env node
/**
 * Moves inline base64 thumbnails and video preview frames out of the `files`
 * Firestore documents into Cloud Storage (see lib/mediaStorage.cjs).
 *
 * Two passes, so nothing is deleted before it has been verified:
 *
 *   Phase A  (additive)  upload to Storage and write the NEW locations next to
 *                        the old data:  thumbnail.storageUrl  and
 *                        videoPreviewFramesStorage. The dashboard keeps using
 *                        the old inline data, so behaviour does not change.
 *   Phase B  (switch)    verify every new URL answers 200, then point
 *                        thumbnail.url / videoPreviewFrames at Storage and
 *                        delete the base64 plus the temporary fields. This is
 *                        what actually shrinks the documents. Requires the
 *                        dashboard that understands both forms to be deployed
 *                        first (--confirm-readers-deployed).
 *
 * Usage:
 *   node migrateThumbnailsToStorage.cjs --phase=A                 # dry run (default)
 *   node migrateThumbnailsToStorage.cjs --phase=A --apply [--limit=500]
 *   node migrateThumbnailsToStorage.cjs --phase=B --apply --confirm-readers-deployed
 *
 * Safe to stop and re-run: a checkpoint file remembers the last document, and
 * both phases skip documents that are already done. It never touches
 * needs_tagging or any curation field.
 */

const fs = require('fs');
const path = require('path');

const PAGE_SIZE = 300;
const CONCURRENCY = 12;
const CHECKPOINT = (phase) => path.join(__dirname, `.migrate-thumbs-${phase}.checkpoint.json`);

// ---------------------------------------------------------------------------
// Pure planning logic (unit-tested, no I/O)
// ---------------------------------------------------------------------------

const isInlineImage = (u) => typeof u === 'string' && u.startsWith('data:image/');
const base64Of = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** What Phase A has to upload for a document. */
function planA(data) {
  const thumb = data.thumbnail;
  const frames = data.videoPreviewFrames;
  return {
    thumbnail: thumb && isInlineImage(thumb.url) && !thumb.storageUrl ? base64Of(thumb.url) : null,
    frames:
      Array.isArray(frames) && frames.some((f) => f && f.frameData) && !data.videoPreviewFramesStorage
        ? frames.filter((f) => f && f.frameData)
        : null,
  };
}

/** The Firestore update Phase B applies once the URLs are verified (or null). */
function planB(data, FieldValue) {
  const update = {};
  const urls = [];
  const thumb = data.thumbnail;
  if (thumb && thumb.storageUrl) {
    update['thumbnail.url'] = thumb.storageUrl;
    update['thumbnail.storageUrl'] = FieldValue.delete();
    urls.push(thumb.storageUrl);
  }
  const staged = data.videoPreviewFramesStorage;
  if (Array.isArray(staged) && staged.length > 0 && staged.every((f) => f && f.url)) {
    update.videoPreviewFrames = staged.map((f) => ({
      timestamp: f.timestamp,
      frameNumber: f.frameNumber,
      url: f.url,
    }));
    update.videoPreviewFramesStorage = FieldValue.delete();
    for (const f of staged) urls.push(f.url);
  }
  return Object.keys(update).length ? { update, urls } : null;
}

// ---------------------------------------------------------------------------

async function runPool(items, worker, limit) {
  let i = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

// A transient network error or rate limit must not be mistaken for a missing
// object, so retry before giving up. A real 404 fails immediately.
async function urlOk(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return true;
      if (res.status === 404 || res.status === 403) return false;
    } catch {
      // network error: fall through to retry
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
  const phase = (opt('phase') || '').toUpperCase();
  const apply = flag('apply');
  const limit = opt('limit') ? parseInt(opt('limit'), 10) : Infinity;

  if (phase !== 'A' && phase !== 'B') {
    console.error('Usage: --phase=A|B [--apply] [--limit=N] [--confirm-readers-deployed]');
    process.exit(1);
  }
  if (phase === 'B' && apply && !flag('confirm-readers-deployed')) {
    console.error('Phase B shrinks the documents. It needs the dashboard + tagNewFiles that understand');
    console.error('Storage URLs to be deployed first. Re-run with --confirm-readers-deployed once they are.');
    process.exit(1);
  }

  const admin = require('firebase-admin');
  const { uploadThumbnail, uploadFrames, MEDIA_BUCKET } = require('./lib/mediaStorage.cjs');
  const serviceAccount = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'tk-archive-cd9d0' });
  const db = admin.firestore();
  const bucket = admin.storage().bucket(MEDIA_BUCKET);
  const { FieldValue } = admin.firestore;

  console.log(`\nPhase ${phase} — ${apply ? 'APPLY (writes!)' : 'DRY RUN (no writes, no uploads)'}${Number.isFinite(limit) ? ` — limit ${limit}` : ''}\n`);

  const ckptFile = CHECKPOINT(phase);
  let last = null;
  if (apply && fs.existsSync(ckptFile)) {
    last = JSON.parse(fs.readFileSync(ckptFile, 'utf8')).lastId;
    console.log(`Resuming after document ${last}\n`);
  }

  const stats = { scanned: 0, thumbs: 0, frameDocs: 0, frames: 0, switched: 0, skipped: 0, failed: 0, bytes: 0 };
  const fields = phase === 'A' ? ['thumbnail', 'videoPreviewFrames', 'videoPreviewFramesStorage'] : ['thumbnail.storageUrl', 'videoPreviewFramesStorage'];

  let done = false;
  while (!done && stats.scanned < limit) {
    let q = db.collection('files').orderBy(admin.firestore.FieldPath.documentId()).select(...fields).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const docs = snap.docs.slice(0, Math.max(0, limit - stats.scanned));
    await runPool(
      docs,
      async (doc) => {
        const data = doc.data();
        try {
          if (phase === 'A') {
            const plan = planA(data);
            if (!plan.thumbnail && !plan.frames) return void stats.skipped++;
            const update = {};
            if (plan.thumbnail) {
              stats.thumbs++;
              stats.bytes += plan.thumbnail.length;
              if (apply) update['thumbnail.storageUrl'] = await uploadThumbnail(bucket, doc.id, plan.thumbnail);
            }
            if (plan.frames) {
              stats.frameDocs++;
              stats.frames += plan.frames.length;
              stats.bytes += plan.frames.reduce((s, f) => s + f.frameData.length, 0);
              if (apply) {
                const up = await uploadFrames(bucket, doc.id, plan.frames);
                // A frame that failed to upload comes back inline: do not stage a partial set.
                if (up.every((f) => f.url)) update.videoPreviewFramesStorage = up;
                else stats.failed++;
              }
            }
            if (apply && Object.keys(update).length) await doc.ref.update(update);
          } else {
            const plan = planB(data, FieldValue);
            if (!plan) return void stats.skipped++;
            const checks = await Promise.all(plan.urls.map(urlOk));
            if (!checks.every(Boolean)) {
              stats.failed++;
              console.error(`  ✗ ${doc.id}: a Storage URL does not answer 200 — left untouched`);
              return;
            }
            stats.switched++;
            if (apply) await doc.ref.update(plan.update);
          }
        } catch (err) {
          stats.failed++;
          console.error(`  ✗ ${doc.id}: ${err.message}`);
        }
      },
      CONCURRENCY
    );

    stats.scanned += docs.length;
    last = snap.docs[snap.docs.length - 1].id;
    if (apply) fs.writeFileSync(ckptFile, JSON.stringify({ lastId: last, at: new Date().toISOString() }));
    process.stdout.write(`\r  scanned ${stats.scanned}  thumbs ${stats.thumbs}  frame-docs ${stats.frameDocs}  switched ${stats.switched}  failed ${stats.failed}   `);
    if (snap.docs.length < PAGE_SIZE) done = true;
  }

  console.log('\n\nSummary');
  console.log(`  documents scanned:        ${stats.scanned}`);
  if (phase === 'A') {
    console.log(`  thumbnails to move:       ${stats.thumbs}`);
    console.log(`  docs with frames:         ${stats.frameDocs} (${stats.frames} frames)`);
    console.log(`  inline base64 found:      ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  } else {
    console.log(`  documents to switch:      ${stats.switched}`);
  }
  console.log(`  already done / nothing:   ${stats.skipped}`);
  console.log(`  failed:                   ${stats.failed}`);
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
  process.exit(stats.failed ? 2 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { planA, planB, isInlineImage };
