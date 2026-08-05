const { JobManager } = require('../lib/jobManager');
const { SCAN_STATUSES, COLLECTIONS } = require('../lib/firestoreSchema');
const { createFakeFirestore } = require('./fakeFirestore');

describe('JobManager', () => {
  let db;
  let jobManager;

  beforeEach(() => {
    db = createFakeFirestore();
    jobManager = new JobManager(db);
  });

  it('test_createJob_creates_scan_record', async () => {
    const { jobId, createdAt } = await jobManager.createJob(
      'user-123',
      '/Volumes/Arsiv',
      'local'
    );

    expect(jobId).toBeTruthy();
    expect(createdAt).toBeTruthy();

    const snapshot = await db.collection(COLLECTIONS.SCANS).doc(jobId).get();
    expect(snapshot.exists).toBe(true);
    const record = snapshot.data();
    expect(record.userId).toBe('user-123');
    expect(record.archiveRoot).toBe('/Volumes/Arsiv');
    expect(record.scanType).toBe('local');
    expect(record.status).toBe(SCAN_STATUSES.QUEUED);
    expect(record.createdAt).toBeTruthy();
    expect(record.startedAt).toBeNull();
    expect(record.completedAt).toBeNull();
    expect(record.progress).toEqual({ filesProcessed: 0, totalEstimate: 0 });
    expect(record.results).toBeNull();
    expect(record.errorMsg).toBeNull();
  });

  it('test_updateJobStatus_updates_status', async () => {
    const { jobId } = await jobManager.createJob('user-123', '/Volumes/Arsiv', 'local');

    await jobManager.updateJobStatus(jobId, SCAN_STATUSES.RUNNING, {
      progress: { filesProcessed: 10, totalEstimate: 100 },
    });

    const snapshot = await db.collection(COLLECTIONS.SCANS).doc(jobId).get();
    const record = snapshot.data();
    expect(record.status).toBe(SCAN_STATUSES.RUNNING);
    expect(record.progress).toEqual({ filesProcessed: 10, totalEstimate: 100 });
    expect(record.startedAt).toBeTruthy();

    await jobManager.updateJobStatus(jobId, SCAN_STATUSES.COMPLETED, {
      results: { jsonlPath: 'gs://bucket/scan.jsonl', reportPath: 'gs://bucket/report.md', summary: { totalFiles: 100 } },
    });

    const finalSnapshot = await db.collection(COLLECTIONS.SCANS).doc(jobId).get();
    const finalRecord = finalSnapshot.data();
    expect(finalRecord.status).toBe(SCAN_STATUSES.COMPLETED);
    expect(finalRecord.completedAt).toBeTruthy();
    expect(finalRecord.results).toEqual({
      jsonlPath: 'gs://bucket/scan.jsonl',
      reportPath: 'gs://bucket/report.md',
      summary: { totalFiles: 100 },
    });
  });

  it('test_getJob_retrieves_job', async () => {
    const { jobId } = await jobManager.createJob('user-456', '/Volumes/Arsiv2', 'drive');

    const job = await jobManager.getJob(jobId);

    expect(job.jobId).toBe(jobId);
    expect(job.status).toBe(SCAN_STATUSES.QUEUED);
    expect(job.createdAt).toBeTruthy();
    expect(job.userId).toBe('user-456');
    expect(job.archiveRoot).toBe('/Volumes/Arsiv2');
    expect(job.scanType).toBe('drive');
  });

  it('test_getJob_throws_on_missing', async () => {
    await expect(jobManager.getJob('does-not-exist')).rejects.toThrow();
  });
});
