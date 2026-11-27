#!/usr/bin/env node

/**
 * Applies copyright/license/usage data to the files matched (by exact
 * filename) against Telif.pdf's project sections — only the high-confidence
 * matches from telifDryRun.cjs's report, never a guess. Writes via
 * dot-notation update() so existing sibling fields (e.g. copyright.owner
 * defaulted by the scanner) are preserved unless this project's data
 * overrides them.
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

const projects = JSON.parse(
  fs.readFileSync('/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/telif_projects.json', 'utf8')
);
const report = JSON.parse(
  fs.readFileSync('/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/telif_dryrun_report.json', 'utf8')
);

function toMillis(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d.getTime();
}

function buildUsageRights(project) {
  const parts = [`Proje: ${project.name}`];
  if (project.productionAgency) parts.push(`Prodüksiyon Ajansı: ${project.productionAgency}`);
  if (project.creativeAgency && project.creativeAgency !== 'TBD') parts.push(`Kreatif Ajans: ${project.creativeAgency}`);
  if (project.photographer && project.photographer !== 'TBD') parts.push(`Fotoğrafçı: ${project.photographer}`);
  if (project.copyrightStart) parts.push(`Telif Başlangıç: ${project.copyrightStart}`);
  if (project.media && project.media !== 'TBD') parts.push(`Medya: ${project.media}`);
  if (project.note) parts.push(`Not: ${project.note}`);
  parts.push('Kaynak: Telif.pdf (23/02/2026)');
  return parts.join(' | ');
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const batches = [db.batch()];
  let opsInBatch = 0;
  let totalWrites = 0;
  const BATCH_LIMIT = 400;
  const summary = [];

  for (const projReport of report.projects) {
    const project = projects.find((p) => p.id === projReport.id);
    if (!project) continue;
    const usageRights = buildUsageRights(project);
    const expirationMillis = toMillis(project.copyrightExpiry);

    let projectFileCount = 0;
    for (const m of projReport.matched) {
      for (const fileId of m.fileIds) {
        projectFileCount++;
        totalWrites++;
        if (dryRun) continue;

        const docRef = db.collection('files').doc(fileId);
        const updates = {
          'copyright.productionCompany': project.productionAgency || null,
          'copyright.department': project.creativeAgency && project.creativeAgency !== 'TBD' ? project.creativeAgency : null,
          'copyright.contactPerson': project.photographer && project.photographer !== 'TBD' ? project.photographer : null,
          'usage.usage_rights': usageRights,
          'license.type': 'commercial',
        };
        if (expirationMillis) {
          updates['license.expirationDate'] = expirationMillis;
        }
        // Drop null-valued keys (we don't want to clobber existing values with
        // null when this project didn't supply that field — just omit it).
        Object.keys(updates).forEach((k) => {
          if (updates[k] === null) delete updates[k];
        });

        batches[batches.length - 1].update(docRef, updates);
        opsInBatch++;
        if (opsInBatch >= BATCH_LIMIT) {
          batches.push(db.batch());
          opsInBatch = 0;
        }
      }
    }
    summary.push({ project: project.name, files: projectFileCount, expirationMillis, usageRights });
  }

  console.log(dryRun ? '=== DRY RUN (no writes) ===' : '=== APPLYING WRITES ===');
  for (const s of summary) {
    if (s.files > 0) {
      console.log(`- ${s.project}: ${s.files} files${s.expirationMillis ? ` | expires ${new Date(s.expirationMillis).toISOString().slice(0,10)}` : ' | no expiration (unlimited)'}`);
    }
  }
  console.log(`\nTotal files to update: ${totalWrites}`);

  if (!dryRun) {
    for (const b of batches) {
      await b.commit();
    }
    console.log('Done — writes committed.');
  } else {
    console.log('(dry run — nothing written; re-run without --dry-run to apply)');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
