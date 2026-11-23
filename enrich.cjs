#!/usr/bin/env node
/**
 * TK Archive — zenginleştirme worker'ı (hafif taramanın 2. aşaması).
 *
 * scanLight.cjs'in açtığı kayıtları (`needs_enrichment: true`) sırayla
 * doldurur: görsel/tasarım için 240px küçük resim (+ image/* için 1600px
 * önizleme → GCS), video için 5 önizleme karesi. Karesi/küçük resmi hazır
 * olan dosyada `needs_tagging: true` açılır → ai_worker.py AI etiketlemeyi
 * alır. Videonun KENDİSİ yüklenmez: panelde "Oynatmak için yükle" düğmesi
 * `upload_requested: true` yazar, bu worker o isteği önce işler. Yüklenen şey
 * orijinal (4K HEVC, 1-2 GB) değil, 720p H.264 "proxy" kopyadır
 * (`proxies/{id}.mp4`, ~20-50 MB, her tarayıcıda oynar). 2026 videoları için
 * proxy arka planda kendiliğinden üretilir (`needs_proxy: true` kuyruğu).
 *
 * Öncelik: `enrichTier` 1=CREATIVE/2026 … 4=2023 (yeni → eski), sonra tier'sız.
 * Her dosya bitince bayrak düşer (checkpoint) — kesinti iş kaybettirmez.
 * Sunucu bağlı değilse bekler (dosya `missing_file` işaretlenmez).
 *
 * Usage: node enrich.cjs [--once] [--max-docs N] [--assign-tiers]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const admin = require('firebase-admin');
const { isVideoFile, extractVideoFrames } = require('./lib/videoFrames.cjs');

const execFilePromise = promisify(execFile);
const VIDEO_BUCKET = 'tk-archive-cd9d0-videos';
const MOUNT = '/Volumes/TRIBAL';
const CONCURRENCY = 3;
const IDLE_SLEEP_MS = 30000;
const TIERS = [
  [1, '/Volumes/TRIBAL/THY/CREATIVE/2026/'],
  [1, '/Volumes/TRIBAL/THY/ACCOUNT/2026/'],
  [1, '/Volumes/TRIBAL/THY/SOCIAL/2026/'],
  [1, '/Volumes/TRIBAL/THY/DIGITAL/2026/'],
  [1, '/Volumes/TRIBAL/THY/STRATEGY/2026/'],
  [2, '/Volumes/TRIBAL/THY/CREATIVE/2025/'],
  [2, '/Volumes/TRIBAL/THY/ACCOUNT/2025/'],
  [2, '/Volumes/TRIBAL/THY/SOCIAL/2025/'],
  [2, '/Volumes/TRIBAL/THY/STRATEGY/2025/'],
  [3, '/Volumes/TRIBAL/THY/CREATIVE/2024/'],
  [3, '/Volumes/TRIBAL/THY/ACCOUNT/2024/'],
  [4, '/Volumes/TRIBAL/2023/'],
  [4, '/Volumes/TRIBAL/THY/CREATIVE/2023/'],
];
// scanner.cjs ile aynı küme: Quick Look'un render edebildikleri.
const THUMBNAIL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'bmp', 'heic', 'tga',
  'pdf', 'psd', 'psb', 'ai', 'eps',
  'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'key', 'numbers',
]);

const key = JSON.parse(fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'tk-archive-cd9d0' });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const bucket = admin.storage().bucket(VIDEO_BUCKET);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mounted = () => fs.existsSync(MOUNT) && fs.readdirSync(MOUNT).length > 0;

let processed = 0;
async function beat(state, current) {
  try {
    await db.collection('ai_worker_status').doc('enrich').set({
      lastSeen: FieldValue.serverTimestamp(), state, current: current || null,
      processedSinceStart: processed,
    });
  } catch (e) { /* ağ kesintisi: sessiz geç */ }
}

async function qlThumb(filePath, size, tmpTag) {
  const tmpDir = path.join(os.tmpdir(), `enrich-${tmpTag}-${size}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFilePromise('qlmanage', ['-t', '-s', String(size), '-o', tmpDir, filePath], { timeout: size > 500 ? 25000 : 20000 });
    const out = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.png'));
    return out.length ? path.join(tmpDir, out[0]) : null;
  } catch (e) {
    return null;
  }
  // tmpDir temizliği çağıran tarafta (dosya okunduktan sonra)
}

// Küçük resim Firestore'da inline durur → PNG yerine JPEG (~10x küçük, arama hızı). Saydam PNG'ler ya da
// kazanç olmayanlar PNG kalır (png_to_jpeg.py boş döner).
const PY = path.join(__dirname, '../tk-ai-engine/.venv/bin/python');
const PNG_TO_JPEG = path.join(__dirname, '../tk-ai-engine/sprint3/png_to_jpeg.py');
async function thumbDataUri(pngPath) {
  try {
    const { stdout } = await execFilePromise(PY, [PNG_TO_JPEG, pngPath], { timeout: 20000, maxBuffer: 8 << 20 });
    if (stdout) return `data:image/jpeg;base64,${stdout}`;
  } catch (e) { /* PNG'ye düş */ }
  return `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`;
}

function cleanTmp(tmpTag, size) {
  fs.rmSync(path.join(os.tmpdir(), `enrich-${tmpTag}-${size}`), { recursive: true, force: true });
}

async function enrichOne(doc) {
  const data = doc.data();
  const p = data.path;
  const id = doc.id;
  const ext = (data.extension || path.extname(p).slice(1)).toLowerCase();
  const update = { needs_enrichment: false, enrichedAt: Date.now() };

  if (!fs.existsSync(p)) {
    // Bağlıyken yok = gerçekten silinmiş/taşınmış
    update.enrichStatus = 'missing_file';
    await doc.ref.update(update);
    return 'missing';
  }

  if (isVideoFile(p)) {
    const frames = await extractVideoFrames(p, id);
    update.videoUploaded = false; // video GCS'te değil — proxy kuyruğu ya da panelden istek yükler
    if (PROXY_RE.test(p)) update.needs_proxy = true;
    if (frames) {
      update.videoPreviewFrames = frames;
      update.needs_tagging = true;
      update.enrichStatus = 'done';
    } else {
      update.enrichStatus = 'no_frames';
    }
  } else if (THUMBNAIL_EXTENSIONS.has(ext)) {
    const small = await qlThumb(p, 240, id);
    if (small) {
      const dataUri = await thumbDataUri(small);
      cleanTmp(id, 240);
      update.thumbnail = { url: dataUri, generated: true, generatedAt: Date.now() };
      update.needs_tagging = true;
      update.enrichStatus = 'done';
    } else {
      cleanTmp(id, 240);
      update.enrichStatus = 'no_thumbnail';
    }
    if ((data.mimeType || '').startsWith('image/')) {
      const objectName = `previews/${id}.png`;
      try {
        const [exists] = await bucket.file(objectName).exists();
        if (!exists) {
          const big = await qlThumb(p, 1600, id);
          if (big) await bucket.upload(big, { destination: objectName, metadata: { contentType: 'image/png' } });
          cleanTmp(id, 1600);
        }
      } catch (e) {
        cleanTmp(id, 1600);
      }
    }
  } else {
    update.enrichStatus = 'no_visual'; // ses/proje/font/zip: sadece ad+klasörle aranır
  }
  await doc.ref.update(update);
  return update.enrichStatus;
}

// ---- Video proxy: 720p H.264 (+AAC), tarayıcıda her yerde oynar, ~50x küçük ----
const PROXY_RE = /^\/Volumes\/TRIBAL\/THY\/[^/]+\/2026\//; // otomatik proxy kapsamı
const PROXY_FILTER = "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";

async function makeProxy(srcPath, id) {
  const out = path.join(os.tmpdir(), `proxy-${id}.mp4`);
  const common = ['-hide_banner', '-loglevel', 'error', '-y'];
  const tail = ['-vf', PROXY_FILTER, '-pix_fmt', 'yuv420p', '-map', '0:v:0', '-map', '0:a:0?'];
  const audio = ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
  const opts = { timeout: 45 * 60 * 1000, maxBuffer: 8 << 20 };
  try {
    // Donanım (VideoToolbox) — 4K HEVC için ~1.5x gerçek zaman
    await execFilePromise('ffmpeg', [...common, '-hwaccel', 'videotoolbox', '-i', srcPath, ...tail, '-c:v', 'h264_videotoolbox', '-b:v', '3500k', ...audio], opts);
  } catch (e) {
    // Yazılım yedeği (donanım çözemeyen codec'ler)
    await execFilePromise('ffmpeg', [...common, '-i', srcPath, ...tail, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', ...audio], opts);
  }
  return out;
}

async function proxyOne(doc) {
  const d = doc.data();
  await beat('proxy', d.name);
  let tmp = null;
  try {
    if (!fs.existsSync(d.path)) throw new Error('dosya sunucuda bulunamadı (paylaşım bağlı mı?)');
    tmp = await makeProxy(d.path, doc.id);
    await bucket.upload(tmp, { destination: `proxies/${doc.id}.mp4`, metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=86400' } });
    await doc.ref.update({
      videoProxy: true, videoUploaded: true, needs_proxy: FieldValue.delete(),
      upload_requested: FieldValue.delete(), uploadError: FieldValue.delete(), proxyError: FieldValue.delete(),
    });
    console.log(`  ▶ proxy hazır: ${d.name} (${(fs.statSync(tmp).size / 1e6).toFixed(0)} MB)`);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    await doc.ref.update({ needs_proxy: FieldValue.delete(), upload_requested: FieldValue.delete(), uploadError: msg, proxyError: msg }).catch(() => {});
    console.log(`  ✗ proxy hatası: ${d.name} — ${msg.split('\n')[0]}`);
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

// Panelden gelen "Oynatmak için yükle" istekleri (öncelikli)
async function handleUploadRequests() {
  const snap = await db.collection('files').where('upload_requested', '==', true).limit(5).get();
  for (const doc of snap.docs) await proxyOne(doc);
  return snap.size;
}

// Arka plan kuyruğu: needs_proxy (2026 videoları)
async function handleProxyQueue() {
  const snap = await db.collection('files').where('needs_proxy', '==', true).limit(2).get();
  await Promise.all(snap.docs.map(proxyOne));
  return snap.size;
}

// Mevcut 2026 videolarını proxy kuyruğuna al (kopya/gizli olmayan, proxy'si olmayan)
async function queueProxies() {
  let n = 0;
  for (const root of ['CREATIVE', 'ACCOUNT', 'SOCIAL', 'DIGITAL', 'STRATEGY'].map((r) => `/Volumes/TRIBAL/THY/${r}/2026/`)) {
    let last = null;
    for (;;) {
      let q = db.collection('files').where('path', '>=', root).where('path', '<', root + '\uffff')
        .orderBy('path').select('path', 'mimeType', 'isDuplicate', 'videoProxy', 'needs_proxy').limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      let c = 0;
      for (const d of snap.docs) {
        if ((d.get('mimeType') || '').startsWith('video/') && d.get('isDuplicate') !== true && d.get('videoProxy') !== true && d.get('needs_proxy') !== true) {
          batch.update(d.ref, { needs_proxy: true }); c++;
        }
      }
      if (c) await batch.commit();
      n += c;
      last = snap.docs[snap.docs.length - 1];
    }
    console.log(`  ${root} → toplam kuyrukta ${n}`);
  }
}

// Konu grupları: yeni taranan dosyalar kurallara göre gruba girsin — iş yokken saatte bir
// (sprint3/assign_groups.py; yalnızca değişen dosyaları yazar).
const ASSIGN_GROUPS = path.join(__dirname, '../tk-ai-engine/sprint3/assign_groups.py');
let lastGroupRun = 0;
async function maybeAssignGroups() {
  if (Date.now() - lastGroupRun < 3600 * 1000) return;
  lastGroupRun = Date.now();
  try {
    await beat('groups');
    await execFilePromise(PY, [ASSIGN_GROUPS, '--quiet'], { timeout: 20 * 60 * 1000, maxBuffer: 4 << 20 });
    console.log('  ▦ konu grupları güncellendi');
  } catch (e) {
    console.log(`  ✗ konu grupları: ${String(e.message).split('\n')[0]}`);
  }
}

async function nextBatch() {
  for (const tier of [1, 2, 3, 4]) {
    const s = await db.collection('files').where('needs_enrichment', '==', true).where('enrichTier', '==', tier).limit(30).get();
    if (!s.empty) return s.docs;
  }
  const s = await db.collection('files').where('needs_enrichment', '==', true).limit(30).get();
  return s.docs;
}

async function assignTiers() {
  console.log('enrichTier atanıyor...');
  let n = 0;
  for (const [tier, prefix] of TIERS) {
    let last = null;
    for (;;) {
      let q = db.collection('files').where('path', '>=', prefix).where('path', '<', prefix + '')
        .orderBy('path').select('path', 'needs_enrichment', 'enrichTier').limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      let c = 0;
      for (const d of snap.docs) {
        if (d.get('needs_enrichment') === true && d.get('enrichTier') !== tier) { batch.update(d.ref, { enrichTier: tier }); c++; }
      }
      if (c) await batch.commit();
      n += c;
      last = snap.docs[snap.docs.length - 1];
    }
    console.log(`  tier ${tier} (${prefix}) → toplam ${n}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--assign-tiers')) { await assignTiers(); return; }
  if (args.includes('--queue-proxies')) { await queueProxies(); return; }
  const once = args.includes('--once');
  const mi = args.indexOf('--max-docs');
  const maxDocs = mi >= 0 ? parseInt(args[mi + 1], 10) : Infinity;
  console.log('Enrich worker başladı.');
  for (;;) {
    if (processed >= maxDocs) { console.log(`--max-docs ${maxDocs} doldu.`); return; }
    if (!mounted()) {
      await beat('no_mount');
      if (once) { console.log('Sunucu bağlı değil.'); return; }
      await sleep(60000);
      continue;
    }
    if (await handleUploadRequests()) continue;
    const docs = await nextBatch();
    if (!docs.length) {
      if (await handleProxyQueue()) continue;
      await maybeAssignGroups();
      if (once) { console.log('Kuyruk boş.'); return; }
      await beat('idle');
      await sleep(IDLE_SLEEP_MS);
      continue;
    }
    // CONCURRENCY'lik havuz
    let idx = 0;
    const run = async () => {
      while (idx < docs.length && processed < maxDocs) {
        const doc = docs[idx++];
        try {
          const st = await enrichOne(doc);
          processed++;
          console.log(`  ✓ ${doc.get('name')} — ${st}`);
        } catch (e) {
          console.log(`  ✗ ${doc.get('name')} — ${e.message}`);
          await doc.ref.update({ needs_enrichment: false, enrichStatus: 'failed', enrichError: String(e.message).slice(0, 200) }).catch(() => {});
        }
      }
    };
    await beat('enriching', docs[0].get('name'));
    await Promise.all(Array.from({ length: CONCURRENCY }, run));
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
