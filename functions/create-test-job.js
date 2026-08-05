const admin = require('firebase-admin');
const serviceAccount = require('/Users/okilavuz/Desktop/omer_works/Agency_Planing/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0'
});

const db = admin.firestore();

async function createTestJob() {
  const jobId = 'job-completed-1785852537652';

  // Create a completed job document
  const jobDoc = {
    jobId,
    userId: 'google-oauth2|118049559433462648850', // This is the user ID from auth
    status: 'completed',
    progress: {
      filesProcessed: 15420,
      totalEstimate: 15420
    },
    createdAt: new Date(Date.now() - 7200000),
    startedAt: new Date(Date.now() - 7200000),
    completedAt: new Date(Date.now() - 1800000),
    results: {
      summary: {
        totalFiles: 15420,
        totalSizeBytes: 2500000000000,
        totalSizeGB: 2500,
        duplicateGroups: 342,
        wastedSpaceBytes: 125000000000,
        wastedSpaceGB: 125
      },
      report: `# TK Archive Envanteri Raporu

## Özet
Tarama başarıyla tamamlandı. 15.420 dosya, 2.500 GB toplam boyut analiz edildi.

## Dosya Türleri
- Video: 8.542 dosya (1.800 GB)
- Resim: 4.320 dosya (520 GB)
- Belge: 2.100 dosya (150 GB)
- Ses: 458 dosya (30 GB)

## Kopya Analizi
342 kopya grubu tespit edildi. Toplam 125 GB boşa harcanan alan.

### En Büyük Dosyalar
- project_final_v2.mov: 4.2 GB
- 4K_footage_raw.mp4: 3.8 GB
- archive_backup_2023.zip: 2.5 GB

## Öneriler
Eski video işlemeleri silebilir (125 GB tasarruf). 2020 öncesi arşiv NAS'a taşıyabilir.
`
    },
    errorMsg: null
  };

  try {
    await db.collection('scans').doc(jobId).set(jobDoc);
    console.log(`✅ Created job ${jobId}`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

createTestJob();
