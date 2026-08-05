#!/usr/bin/env node
import admin from 'firebase-admin';

admin.initializeApp({
  projectId: 'tk-archive-cd9d0'
});

const db = admin.firestore();
const userId = '4vwo5gFYUPPnazkE38ihrIXutsh2'; // omer.kilavuz@twist.ddb.com

const now = admin.firestore.Timestamp.now();
const oneHourAgo = new admin.firestore.Timestamp(now.seconds - 3600, now.nanoseconds);
const twoHoursAgo = new admin.firestore.Timestamp(now.seconds - 7200, now.nanoseconds);

const jobs = [
  {
    id: `job-queued-${Date.now()}`,
    status: 'queued',
    archiveRoot: '/Volumes/Arsiv',
    scanType: 'local',
    createdAt: now,
    startedAt: null,
    completedAt: null,
    progress: { filesProcessed: 0, totalEstimate: 0 },
    results: null,
    errorMsg: null,
  },
  {
    id: `job-running-${Date.now()}`,
    status: 'running',
    archiveRoot: '/Volumes/Arsiv',
    scanType: 'local',
    createdAt: oneHourAgo,
    startedAt: oneHourAgo,
    completedAt: null,
    progress: { filesProcessed: 3850, totalEstimate: 15420 },
    results: null,
    errorMsg: null,
  },
  {
    id: `job-completed-${Date.now()}`,
    status: 'completed',
    archiveRoot: '/Volumes/Arsiv',
    scanType: 'local',
    createdAt: twoHoursAgo,
    startedAt: twoHoursAgo,
    completedAt: now,
    progress: { filesProcessed: 15420, totalEstimate: 15420 },
    results: {
      summary: {
        totalFiles: 15420,
        totalSizeBytes: 2500000000000,
        totalSizeGB: 2500,
        duplicateGroups: 342,
        wastedSpaceBytes: 125000000000,
        wastedSpaceGB: 125,
      },
      report: `# TK Archive Envanteri Raporu

## Özet
Başarıyla tarandı: 15.420 dosya, 2.500 GB toplam boyut.

## Dosya Türleri
- Video: 8.542 dosya (1.800 GB)
- Resim: 4.320 dosya (520 GB)
- Belge: 2.100 dosya (150 GB)
- Ses: 458 dosya (30 GB)

## Kopya Analizi
342 kopya grubu tespit edildi, toplam 125 GB boşa harcanan alan.

## En Büyük Dosyalar
- project_final_v2.mov: 4.2 GB
- 4K_footage_raw.mp4: 3.8 GB
- archive_backup_2023.zip: 2.5 GB
`,
    },
    errorMsg: null,
  },
  {
    id: `job-failed-${Date.now()}`,
    status: 'failed',
    archiveRoot: '/Volumes/NotFound',
    scanType: 'local',
    createdAt: now,
    startedAt: now,
    completedAt: now,
    progress: { filesProcessed: 0, totalEstimate: 0 },
    results: null,
    errorMsg: 'Klasör bulunamadı: /Volumes/NotFound',
  },
];

async function seed() {
  const batch = db.batch();

  jobs.forEach((jobData) => {
    const ref = db.collection('scans').doc(jobData.id);
    batch.set(ref, { userId, ...jobData });
  });

  await batch.commit();
  console.log(`✅ Seeded ${jobs.length} test jobs:\n`);
  jobs.forEach((job) => {
    console.log(`   ${job.status.toUpperCase()}: ${job.id}`);
  });

  console.log('\n📊 Test URLs:');
  jobs.forEach((job) => {
    console.log(`   ${job.status}: https://tk-archive-dam.web.app?jobId=${job.id}`);
  });
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
