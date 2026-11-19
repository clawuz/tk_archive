#!/usr/bin/env node

/**
 * Creates Firestore `files` docs for Telif.pdf's "PERFECT JOURNEY A350 –
 * A321Neo" assets found live in Google Drive (as original .tif masters, in
 * several duplicated campaign folders) but never scanned into the DAM by
 * scannerDrive.cjs. Mirrors the exact schema a normal Drive scan produces —
 * same field shape as every other source:'drive' doc already in the
 * collection — but never fabricates tags/description/thumbnail: those stay
 * empty and needs_tagging:true, exactly like a freshly-scanned, not-yet-
 * vision-tagged file, per this project's standing rule that no AI
 * tagging/description ever runs without an explicit, separately-confirmed
 * cost step.
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

const matches = JSON.parse(
  fs.readFileSync('/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/perfect_journey_drive_matches.json', 'utf8')
);

const PROJECT = {
  name: 'PERFECT JOURNEY A350 – A321Neo',
  productionAgency: 'X FİLM',
  copyrightExpiry: '2029-07-01',
  note: "Perfect Journey filmlerinin telifi Haziran 2029'a kadar devam etmektedir.",
};

function usageRights() {
  return [
    `Proje: ${PROJECT.name}`,
    `Prodüksiyon Ajansı: ${PROJECT.productionAgency}`,
    `Telif Bitiş: ${PROJECT.copyrightExpiry}`,
    `Not: ${PROJECT.note}`,
    'Kaynak: Telif.pdf (23/02/2026) — dosya Drive\'da bulundu, DAM\'a daha önce taranmamıştı.',
  ].join(' | ');
}

function extensionOf(title) {
  const m = title.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : '';
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const expirationMillis = new Date(PROJECT.copyrightExpiry + 'T00:00:00Z').getTime();
  const nowMillis = Date.now();
  const batch = db.batch();
  let count = 0;
  const report = [];

  for (const m of matches) {
    const ext = extensionOf(m.title);
    const modifiedAt = new Date(m.modifiedTime).getTime();
    const searchTokens = generateSearchTokens(m.title, []);

    const doc = {
      fileId: m.fileId,
      name: m.title,
      path: `https://drive.google.com/file/d/${m.fileId}/view?usp=drivesdk`,
      source: 'drive',
      extension: ext,
      mimeType: m.mimeType,
      type: m.mimeType,
      size: m.size,
      hash: `drive:${m.fileId}`,
      tags: [],
      createdAt: nowMillis,
      modifiedAt,
      uploadedAt: nowMillis,
      scanId: null,
      lastScanAt: nowMillis,
      driveFileId: m.fileId,
      driveFolderId: m.parentId,
      thumbnail: null,
      videoPreviewFrames: null,
      videoWidth: null,
      videoHeight: null,
      needs_tagging: true,
      copyright: {
        owner: 'TK',
        year: new Date(modifiedAt).getFullYear(),
        productionCompany: PROJECT.productionAgency,
      },
      license: {
        type: 'commercial',
        name: 'Commercial Use',
        expirationDate: expirationMillis,
      },
      usage: { usage_rights: usageRights() },
      status: 'active',
      isDeleted: false,
      searchTokens,
    };

    report.push({ label: m.label, fileId: m.fileId, title: m.title });
    if (!dryRun) {
      batch.set(db.collection('files').doc(m.fileId), doc, { merge: false });
    }
    count++;
  }

  console.log(dryRun ? '=== DRY RUN (no writes) ===' : '=== CREATING DOCS ===');
  for (const r of report) console.log(`- ${r.label} -> ${r.fileId} (${r.title})`);
  console.log(`\nTotal new docs: ${count}`);

  if (!dryRun) {
    await batch.commit();
    console.log('Done — docs created.');
  } else {
    console.log('(dry run — nothing written; re-run without --dry-run to apply)');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
