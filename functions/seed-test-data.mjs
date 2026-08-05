#!/usr/bin/env node
import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'tk-archive-cd9d0'
});

const db = admin.firestore();

async function seedTestData() {
  const userId = '4vwo5gFYUPPnazkE38ihrIXutsh2'; // omer.kilavuz@twist.ddb.com
  const jobId = 'test-job-' + Date.now();

  const jobDoc = {
    userId,
    status: 'completed',
    archiveRoot: '/Volumes/Arsiv',
    scanType: 'local',
    createdAt: admin.firestore.Timestamp.now(),
    startedAt: admin.firestore.Timestamp.now(),
    completedAt: admin.firestore.Timestamp.now(),
    progress: {
      filesProcessed: 15420,
      totalEstimate: 15420,
    },
    results: {
      summary: {
        totalFiles: 15420,
        totalSizeBytes: 2500000000000, // 2.5 TB
        totalSizeGB: 2500,
        duplicateGroups: 342,
        wastedSpaceBytes: 125000000000, // 125 GB
        wastedSpaceGB: 125,
      },
      report: `# TK Archive Envanteri Raporu

## Özet
- **Toplam Dosya:** 15.420
- **Toplam Boyut:** 2.500 GB
- **Kopya Grupları:** 342
- **Boşa Harcanan Alan:** 125 GB

## Dosya Türleri
- Video: 8.542 dosya (1.800 GB)
- Resim: 4.320 dosya (520 GB)
- Belge: 2.100 dosya (150 GB)
- Ses: 458 dosya (30 GB)

## En Büyük Dosyalar
- project_final_v2.mov: 4.2 GB
- 4K_footage_raw.mp4: 3.8 GB
- archive_backup_2023.zip: 2.5 GB

## Öneriler
- Eski video işlediler silebilir (342 kopya grubu = 125 GB tasarruf)
- 2020 öncesi arşiv Nas'a taşıyabilir
`,
    },
  };

  try {
    const jobRef = db.collection('scans').doc(jobId);
    await jobRef.set(jobDoc);
    console.log('✅ Test data seeded:');
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Path: scans/${jobId}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  console.log('\nOpen dashboard with test data:');
  console.log(`https://tk-archive-dam.web.app?jobId=${jobId}`);
}

seedTestData().then(() => process.exit(0));
