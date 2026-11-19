#!/usr/bin/env node
/**
 * Firestore'da kaydı olmayan (yetim) GCS nesnelerini siler — 2026-10-30 maliyet
 * temizliği (kullanıcı onaylı). SKYTRAX temizliğinde silinen eski kopya kayıtlarının
 * (backups/skytrax_stale_*.json) video yüklemeleri ve önizlemeleri artık arayüzden
 * erişilemez durumda (oynatma/önizleme URL'si fileId'den türetilir, kayıt yok).
 *   videolar: yalnızca kaynağı doğrulananlar (silinen kayıt kimliği yedekte olanlar)
 *   önizlemeler: kaydı olmayan hepsi
 * Silinen nesnelerin listesi backups/gcs_orphans_deleted.json'a yazılır.
 * Usage: node cleanupOrphanMedia.cjs [--apply]
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const key = require('./functions/config/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(key), projectId: 'tk-archive-cd9d0' });
const BK = path.join(__dirname, '../tk-ai-engine/backups');
(async () => {
  const apply = process.argv.includes('--apply');
  const db = admin.firestore();
  const ids = new Set((await db.collection('files').select().get()).docs.map((d) => d.id));
  const deleted = JSON.parse(fs.readFileSync(path.join(BK, fs.readdirSync(BK).find((f) => f.startsWith('skytrax_stale_'))), 'utf8'));
  const bucket = admin.storage().bucket('tk-archive-cd9d0-videos');
  const victims = [];
  let token;
  do {
    const [files, next] = await bucket.getFiles({ autoPaginate: false, maxResults: 5000, pageToken: token });
    for (const f of files) {
      const isP = f.name.startsWith('previews/');
      const id = isP ? f.name.slice(9).replace(/\.png$/, '') : f.name.split('.')[0];
      if (ids.has(id)) continue;
      if (!isP && !deleted[id]) continue; // kaynağı doğrulanamayan yetim video: dokunma
      victims.push({ name: f.name, size: Number(f.metadata.size), kind: isP ? 'preview' : 'video' });
    }
    token = next && next.pageToken;
  } while (token);
  const sum = (k) => victims.filter((v) => v.kind === k).reduce((a, v) => a + v.size, 0);
  console.log(`silinecek: video ${victims.filter((v) => v.kind === 'video').length} (${(sum('video') / 1e9).toFixed(1)} GB), önizleme ${victims.filter((v) => v.kind === 'preview').length} (${(sum('preview') / 1e9).toFixed(2)} GB)`);
  if (!apply) return;
  fs.writeFileSync(path.join(BK, 'gcs_orphans_deleted.json'), JSON.stringify(victims, null, 1));
  let n = 0;
  for (let i = 0; i < victims.length; i += 20) {
    await Promise.all(victims.slice(i, i + 20).map((v) => bucket.file(v.name).delete().then(() => n++).catch((e) => console.error('silinemedi', v.name, e.message))));
  }
  console.log('silindi:', n);
})();
