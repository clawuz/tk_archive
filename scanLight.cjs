#!/usr/bin/env node
/**
 * TK Archive — "hafif tarama" (aşama 1).
 *
 * Sunucudaki dosyaları SADECE listeleyip Firestore'a kayıt açar: ad, yol,
 * boyut, tarih, uzantı, klasörden türeyen etiketler ve arama indeksi
 * (searchTokens). Dosya İÇERİĞİ okunmaz: hash yok, kare/küçük resim yok,
 * GCS yüklemesi yok. Böylece onbinlerce dosya dakikalar içinde aranabilir
 * olur; zenginleştirme (küçük resim, kareler, hash) ve AI etiketleme sonra,
 * arka planda yapılır — `scanLevel: 'light'` ve `needs_enrichment: true`
 * işaretli kayıtlar o işin kuyruğudur.
 *
 * - fileId scanner.cjs ile aynı (sha256("local:"+yol)[:32]) → sonradan tam
 *   tarama aynı kaydın üstüne yazar, kopya oluşmaz.
 * - Var olan kayıtlara DOKUNMAZ (create(), zaten varsa atlar).
 * - `needs_tagging: false` — AI etiketleme, karesi/küçük resmi hazır olunca
 *   zenginleştirme aşaması tarafından açılır (aksi halde worker görseli
 *   olmayan dosyayı "skipped" yapıp bayrağı silerdi).
 *
 * Usage:
 *   node scanLight.cjs [--dry-run] [--only <yol-parçası>] [<kök>...]
 *   (kök verilmezse aşağıdaki DEFAULT_ROOTS)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { extractAutoTags } = require('./lib/autoTags.cjs');
const { generateSearchTokens } = require('./lib/searchTokens.cjs');

const ARCHIVE_ROOT = '/Volumes/TRIBAL'; // etiketler bu köke göre (önceki taramalarla aynı)
// Tüm THY birimleri (karar: 2026-10-30, "sadece THY bizim için önemli"). Var olan kayıtlar atlanır.
const DEFAULT_ROOTS = [
  'THY/CREATIVE/2026', 'THY/CREATIVE/2025', 'THY/CREATIVE/2024', 'THY/CREATIVE/2023',
  'THY/ACCOUNT/2026', 'THY/ACCOUNT/2025', 'THY/ACCOUNT/2024',
  'THY/SOCIAL/2026', 'THY/SOCIAL/2025',
  'THY/DIGITAL/2026',
  'THY/STRATEGY/2026', 'THY/STRATEGY/2025',
  '2023/THY',
];
// Medya olmayan klasörler: DataRoute başka bir proje (yazılım kodu) — karar 2026-10-30.
const EXCLUDE_DIRS = new Set(['dataroute', 'node_modules', '__macosx']);
// Yardımcı/önizleme dosyaları: kimse aramaz (karar: 2026-10-12, kullanıcı onayı)
const JUNK = /(_preview\.\w+$|\.pek$|\.cfa$|\.xmp$|\.ims$|\.cpk$|\.mpgindex$|\.xpr$|^thumbs\.db$|^desktop\.ini$)/i;

const MIME = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  webm: 'video/webm', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', mts: 'video/mp2t', m2ts: 'video/mp2t',
  mpeg: 'video/mpeg', mpg: 'video/mpeg', m4v: 'video/x-m4v', mxf: 'application/mxf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', heic: 'image/heic', svg: 'image/svg+xml',
  tga: 'image/x-tga', psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript', eps: 'application/postscript',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', rar: 'application/x-rar-compressed',
};

// Render çıktısı numaralı kare dizileri (TK-..._00180.tga): bir klasörde 20+
// tane varsa kayıt açılmaz, sadece backups/sequences.json'a yazılır — tek tek
// aranmaz, arşivi gürültüyle doldurur (karar: 2026-10-12, atlamak geri
// alınabilir; eklemek istenirse bu liste kullanılır).
const SEQ = /[._-]?\d{3,}\.(tga|png|jpe?g|tiff?|exr|dpx|bmp)$/i;
const SEQ_MIN = 20;

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      console.error(`  (okunamadı: ${dir}: ${e.message})`);
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name.toLowerCase())) stack.push(full); }
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1] : null;
  const roots = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
  const rootList = (roots.length ? roots : DEFAULT_ROOTS).map((r) => path.join(ARCHIVE_ROOT, r));

  const key = JSON.parse(fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'tk-archive-cd9d0' });
  const db = admin.firestore();

  console.log('Mevcut kayıt kimlikleri çekiliyor...');
  const existing = new Set((await db.collection('files').select().get()).docs.map((d) => d.id));
  console.log(`  ${existing.size} kayıt var`);

  const scanId = `light-${new Date().toISOString().slice(0, 10)}`;
  const writer = db.bulkWriter();
  let created = 0, skippedExisting = 0, skippedJunk = 0, skippedSeq = 0, prunedSeq = 0, failed = 0;
  const seqFile = path.join(__dirname, '../tk-ai-engine/backups/sequences.json');
  let sequences = {};
  try { sequences = JSON.parse(fs.readFileSync(seqFile, 'utf8')); } catch { /* ilk çalışma */ }
  writer.onWriteError((err) => {
    if (err.code === 6) { skippedExisting++; return false; } // ALREADY_EXISTS
    if (err.failedAttempts < 12) return true;
    failed++;
    console.error('yazma hatası:', err.documentRef.path, err.message);
    return false;
  });

  for (const root of rootList) {
    if (!fs.existsSync(root)) { console.log(`[yok] ${root}`); continue; }
    const t = Date.now();
    const files = walk(root);
    let n = 0;
    const seqCount = new Map();
    for (const full of files) {
      if (SEQ.test(path.basename(full))) seqCount.set(path.dirname(full), (seqCount.get(path.dirname(full)) || 0) + 1);
    }
    const seqDirs = new Set([...seqCount].filter(([, c]) => c >= SEQ_MIN).map(([d]) => d));
    for (const [d, c] of seqCount) if (c >= SEQ_MIN) sequences[d] = c;
    const toCheck = [];
    for (const full of files) {
      if (only && !full.includes(only)) continue;
      const name = path.basename(full);
      if (JUNK.test(name)) { skippedJunk++; continue; }
      if (seqDirs.has(path.dirname(full)) && SEQ.test(name)) {
        skippedSeq++;
        const sid = crypto.createHash('sha256').update(`local:${full}`).digest('hex').slice(0, 32);
        if (existing.has(sid)) toCheck.push(sid);
        continue;
      }
      const fileId = crypto.createHash('sha256').update(`local:${full}`).digest('hex').slice(0, 32);
      if (existing.has(fileId)) { skippedExisting++; continue; }
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const ext = path.extname(name).toLowerCase().slice(1);
      const mimeType = MIME[ext] || 'application/octet-stream';
      const autoTags = extractAutoTags(path.relative(ARCHIVE_ROOT, full).split(path.sep));
      const doc = {
        fileId, name, path: full, source: 'local', extension: ext, mimeType, type: mimeType,
        size: stat.size, hash: null, tags: autoTags,
        searchTokens: generateSearchTokens(name, autoTags),
        videoPreviewFrames: null, thumbnail: null,
        needs_tagging: false,
        scanLevel: 'light', needs_enrichment: true,
        createdAt: stat.birthtime.getTime(), modifiedAt: stat.mtime.getTime(),
        uploadedAt: Date.now(), scanId, lastScanAt: Date.now(),
        copyright: { owner: 'TK', year: new Date().getFullYear() },
        license: { type: 'commercial', name: 'Commercial Use' },
        status: 'active', isDeleted: false,
      };
      n++;
      if (!dryRun) {
        writer.create(db.collection('files').doc(fileId), doc).catch(() => {}); // hata onWriteError'da sayılır
        if (n % 1500 === 0) await writer.flush(); // kuyruk şişmesin (DEADLINE_EXCEEDED)
      }
    }
    created += n;
    // Önceki (pilot) hafif taramada açılmış dizi karelerini temizle — sadece scanLevel=light olanlar.
    for (let i = 0; i < toCheck.length && !dryRun; i += 300) {
      const refs = toCheck.slice(i, i + 300).map((id) => db.collection('files').doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: ['scanLevel'] });
      for (const sn of snaps) {
        if (sn.exists && sn.get('scanLevel') === 'light') { writer.delete(sn.ref); prunedSeq++; }
      }
    }
    console.log(`[${path.relative(ARCHIVE_ROOT, root)}] diskte ${files.length}, yeni kayıt ${n} (${((Date.now() - t) / 1000).toFixed(0)} sn)`);
  }
  await writer.close();
  if (!dryRun) {
    fs.mkdirSync(path.join(__dirname, '../tk-ai-engine/backups'), { recursive: true });
    fs.writeFileSync(seqFile, JSON.stringify(sequences, null, 1));
  }
  console.log(`kare dizisi atlandı: ${skippedSeq} dosya, ${Object.keys(sequences).length} klasör | pilottan temizlenen: ${prunedSeq}`);
  console.log(`\n${dryRun ? '[dry-run] ' : ''}oluşturulacak/oluşturulan: ${created} | zaten var (atlandı): ${skippedExisting} | yardımcı dosya: ${skippedJunk} | hata: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
