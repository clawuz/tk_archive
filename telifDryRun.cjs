#!/usr/bin/env node

/**
 * Dry run: matches Telif.pdf project labels against the real `files`
 * collection by filename, without writing anything to Firestore.
 *
 * Reads every file's {name, path} once (metadata-only, no downloads), builds
 * a lookup keyed by normalized filename, then checks each Telif.pdf label
 * against it. Reports matched/unmatched per project plus any label that maps
 * to more than one project (a real ambiguity in the source PDF, e.g. T_0289
 * appears in both project 2 and project 9).
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

const projects = JSON.parse(
  fs.readFileSync('/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/telif_projects.json', 'utf8')
);

// Corrected: a label is only "too generic to try" when it's bare digits or a
// digit plus a short suffix/annotation with NO other letters at all (e.g.
// "1", "13", "8rev", "26 a", "3[1]") — those carry no project-identifying
// text. Anything with 3+ letters of real content (e.g. "Kabin Ekibi",
// "Business amenity kit 1") is absolutely worth trying — a prior version of
// this script wrongly required 2+ digits on every label and silently never
// looked up pure-text labels like "Kabin Ekibi.tif", which turned out to be
// a real, already-scanned file. Always attempt the lookup; only the report
// bucket (not the attempt) distinguishes "generic-looking" from the rest.
function isGenericLabel(label) {
  const s = label.trim();
  const lettersOnly = s.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '');
  return lettersOnly.length < 3;
}

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, '') // strip extension
    .replace(/[^a-z0-9]+/g, ''); // strip all non-alphanumeric (spaces, _, -, (), [], diacritics-as-is)
}

// Turkish-aware loose normalize: also fold Turkish special chars to ASCII.
function foldTurkish(s) {
  return s
    .replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g').replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o').replace(/ç/g, 'c').replace(/Ç/g, 'c');
}

function normalizeLoose(name) {
  return normalize(foldTurkish(name));
}

async function run() {
  console.log('Scanning files collection (name + path only)...');
  const byExact = new Map(); // normalize(name) -> [{id, path, name}]
  const byLoose = new Map(); // normalizeLoose(name) -> [{id, path, name}]
  let lastDoc = null;
  let total = 0;

  while (true) {
    let q = db.collection('files').select('name', 'path').orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.name) return;
      const entry = { id: doc.id, path: data.path || '', name: data.name };
      const exactKey = normalize(data.name);
      const looseKey = normalizeLoose(data.name);
      if (!byExact.has(exactKey)) byExact.set(exactKey, []);
      byExact.get(exactKey).push(entry);
      if (!byLoose.has(looseKey)) byLoose.set(looseKey, []);
      byLoose.get(looseKey).push(entry);
      total++;
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
    if (total % 20000 < PAGE_SIZE) console.log(`  ...${total} files scanned`);
  }
  console.log(`Scanned ${total} files total.\n`);

  const report = { generatedAt: new Date().toISOString(), totalFilesScanned: total, projects: [] };
  const labelToProjects = new Map(); // normalized label -> [{projectId, label}]

  for (const project of projects) {
    const projReport = { id: project.id, name: project.name, matched: [], unmatched: [], generic: [] };
    for (const label of project.labels) {
      const exactKey = normalize(label);
      const looseKey = normalizeLoose(label);
      let hits = byExact.get(exactKey);
      let matchType = 'exact';
      if (!hits || hits.length === 0) {
        hits = byLoose.get(looseKey);
        matchType = 'loose';
      }
      const generic = isGenericLabel(label);
      if (hits && hits.length > 0 && !generic) {
        // Safe to trust: label has real identifying text (not just digits),
        // so a filename match is almost certainly the same real asset.
        projReport.matched.push({
          label,
          matchType,
          count: hits.length,
          samplePaths: hits.slice(0, 3).map((h) => h.path),
          fileIds: hits.map((h) => h.id),
        });
        if (!labelToProjects.has(looseKey)) labelToProjects.set(looseKey, []);
        labelToProjects.get(looseKey).push({ projectId: project.id, projectName: project.name, label });
      } else if (hits && hits.length > 0 && generic) {
        // UNSAFE to auto-apply: a bare-number label (e.g. "13", "22") matches
        // by pure coincidence against any unrelated file sharing that name
        // elsewhere in the archive (verified: "1" hit 498 Turkish Cargo
        // files, "22" hit a fish-shipping campaign — nothing to do with the
        // Dreamliner shoot). Report as a separate bucket, never auto-applied.
        projReport.generic.push({ label, riskyMatchCount: hits.length, sample: hits[0].path });
      } else if (generic) {
        projReport.generic.push({ label, riskyMatchCount: 0 });
      } else {
        projReport.unmatched.push(label);
      }
    }
    report.projects.push(projReport);
  }

  // Cross-project collisions: same normalized label claimed by >1 project.
  const collisions = [];
  for (const [key, claims] of labelToProjects.entries()) {
    const distinctProjects = new Set(claims.map((c) => c.projectId));
    if (distinctProjects.size > 1) {
      collisions.push({ key, claims });
    }
  }
  report.collisions = collisions;

  const outPath = '/private/tmp/claude-504/-Users-okilavuz-Documents-test/26a30e5f-0612-499c-aecd-3d10884818bc/scratchpad/telif_dryrun_report.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // Console summary
  console.log('=== SUMMARY ===');
  let totalMatchedLabels = 0, totalMatchedFiles = 0, totalUnmatched = 0, totalGeneric = 0;
  for (const p of report.projects) {
    const matchedFiles = p.matched.reduce((s, m) => s + m.count, 0);
    totalMatchedLabels += p.matched.length;
    totalMatchedFiles += matchedFiles;
    totalUnmatched += p.unmatched.length;
    totalGeneric += p.generic.length;
    console.log(
      `[${p.id}] ${p.name}: ${p.matched.length} labels matched -> ${matchedFiles} real files | ${p.unmatched.length} unmatched | ${p.generic.length} generic/skipped`
    );
  }
  console.log('\nTOTALS:');
  console.log(`  labels matched: ${totalMatchedLabels} -> ${totalMatchedFiles} real files would be updated`);
  console.log(`  labels unmatched (code-bearing but no file found): ${totalUnmatched}`);
  console.log(`  generic labels skipped (no code, needs manual/path review): ${totalGeneric}`);
  console.log(`  cross-project collisions: ${collisions.length}`);
  console.log(`\nFull report written to ${outPath}`);

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
