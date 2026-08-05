const { createStartScanHandler } = require('../startScan');
const { createGetScanStatusHandler } = require('../getScanStatus');
const { createScanResultsHandler } = require('../scanResults');
const { SCAN_STATUSES } = require('../lib/firestoreSchema');

function makeContext(uid) {
  return uid ? { auth: { uid } } : { auth: null };
}

describe('startScan', () => {
  it('test_startScan_creates_job_and_returns_jobId', async () => {
    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job-1', createdAt: 'ts' }),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
    };
    const triggerCloudRunJob = vi.fn().mockResolvedValue(undefined);
    const startScan = createStartScanHandler({ jobManager, triggerCloudRunJob });

    const result = await startScan(
      { archiveRoot: '/Volumes/Arsiv', scanType: 'local' },
      makeContext('user-123')
    );

    expect(result).toEqual({ jobId: 'job-1', status: SCAN_STATUSES.QUEUED });
    expect(jobManager.createJob).toHaveBeenCalledWith('user-123', '/Volumes/Arsiv', 'local');
  });

  it('test_startScan_fails_without_auth', async () => {
    const jobManager = { createJob: vi.fn(), updateJobStatus: vi.fn() };
    const triggerCloudRunJob = vi.fn();
    const startScan = createStartScanHandler({ jobManager, triggerCloudRunJob });

    await expect(
      startScan({ archiveRoot: '/Volumes/Arsiv', scanType: 'local' }, makeContext(null))
    ).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('rejects invalid scanType with a Turkish invalid-argument error', async () => {
    const jobManager = { createJob: vi.fn(), updateJobStatus: vi.fn() };
    const startScan = createStartScanHandler({ jobManager, triggerCloudRunJob: vi.fn() });

    await expect(
      startScan({ archiveRoot: '/Volumes/Arsiv', scanType: 'invalid' }, makeContext('user-123'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('rejects missing archiveRoot with invalid-argument', async () => {
    const jobManager = { createJob: vi.fn(), updateJobStatus: vi.fn() };
    const startScan = createStartScanHandler({ jobManager, triggerCloudRunJob: vi.fn() });

    await expect(
      startScan({ scanType: 'local' }, makeContext('user-123'))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('marks the job failed (without throwing to the caller) when the Cloud Run trigger rejects', async () => {
    const jobManager = {
      createJob: vi.fn().mockResolvedValue({ jobId: 'job-2', createdAt: 'ts' }),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
    };
    const triggerCloudRunJob = vi.fn().mockRejectedValue(new Error('boom'));
    const startScan = createStartScanHandler({ jobManager, triggerCloudRunJob });

    const result = await startScan(
      { archiveRoot: '/Volumes/Arsiv', scanType: 'both' },
      makeContext('user-123')
    );

    expect(result).toEqual({ jobId: 'job-2', status: SCAN_STATUSES.QUEUED });

    // trigger failure is handled asynchronously in the background; flush microtasks
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(jobManager.updateJobStatus).toHaveBeenCalledWith(
      'job-2',
      SCAN_STATUSES.FAILED,
      expect.objectContaining({ errorMsg: expect.any(String) })
    );
  });
});

describe('getScanStatus', () => {
  it('test_getScanStatus_returns_job_details', async () => {
    const job = {
      jobId: 'job-1',
      userId: 'user-123',
      status: SCAN_STATUSES.RUNNING,
      progress: { filesProcessed: 5, totalEstimate: 10 },
      createdAt: 'created',
      startedAt: 'started',
      completedAt: null,
      results: null,
      errorMsg: null,
    };
    const jobManager = { getJob: vi.fn().mockResolvedValue(job) };
    const getScanStatus = createGetScanStatusHandler({ jobManager });

    const result = await getScanStatus({ jobId: 'job-1' }, makeContext('user-123'));

    expect(result).toEqual({
      jobId: 'job-1',
      status: SCAN_STATUSES.RUNNING,
      progress: { filesProcessed: 5, totalEstimate: 10 },
      createdAt: 'created',
      startedAt: 'started',
      completedAt: null,
      results: null,
      errorMsg: null,
    });
  });

  it('test_getScanStatus_fails_wrong_user', async () => {
    const job = { jobId: 'job-1', userId: 'owner-user', status: SCAN_STATUSES.QUEUED };
    const jobManager = { getJob: vi.fn().mockResolvedValue(job) };
    const getScanStatus = createGetScanStatusHandler({ jobManager });

    await expect(
      getScanStatus({ jobId: 'job-1' }, makeContext('someone-else'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('fails without auth', async () => {
    const jobManager = { getJob: vi.fn() };
    const getScanStatus = createGetScanStatusHandler({ jobManager });

    await expect(getScanStatus({ jobId: 'job-1' }, makeContext(null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(jobManager.getJob).not.toHaveBeenCalled();
  });

  it('translates a missing job into a not-found HttpsError', async () => {
    const jobManager = {
      getJob: vi.fn().mockRejectedValue(new Error('Tarama kaydı bulunamadı: job-x')),
    };
    const getScanStatus = createGetScanStatusHandler({ jobManager });

    await expect(
      getScanStatus({ jobId: 'job-x' }, makeContext('user-123'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('scanResults', () => {
  function makeBucket(files) {
    return {
      file: vi.fn((path) => ({
        download: vi.fn().mockResolvedValue([Buffer.from(files[path] || '')]),
      })),
    };
  }

  it('test_scanResults_downloads_files', async () => {
    const job = {
      jobId: 'job-1',
      userId: 'user-123',
      status: SCAN_STATUSES.COMPLETED,
      results: {
        reportPath: 'gs://my-bucket/scans/job-1/report.md',
        jsonlPath: 'gs://my-bucket/scans/job-1/scan.jsonl',
        summary: { totalFiles: 42 },
      },
    };
    const jobManager = { getJob: vi.fn().mockResolvedValue(job) };
    const bucket = makeBucket({
      'scans/job-1/report.md': '# Report',
      'scans/job-1/scan.jsonl': '{"file":"a"}',
    });
    const scanResults = createScanResultsHandler({ jobManager, getBucket: () => bucket });

    const result = await scanResults({ jobId: 'job-1' }, makeContext('user-123'));

    expect(result).toEqual({
      report: '# Report',
      jsonl: '{"file":"a"}',
      summary: { totalFiles: 42 },
    });
    expect(bucket.file).toHaveBeenCalledWith('scans/job-1/report.md');
    expect(bucket.file).toHaveBeenCalledWith('scans/job-1/scan.jsonl');
  });

  it('test_scanResults_fails_incomplete_job', async () => {
    const job = { jobId: 'job-1', userId: 'user-123', status: SCAN_STATUSES.RUNNING, results: null };
    const jobManager = { getJob: vi.fn().mockResolvedValue(job) };
    const scanResults = createScanResultsHandler({ jobManager, getBucket: () => makeBucket({}) });

    await expect(
      scanResults({ jobId: 'job-1' }, makeContext('user-123'))
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('fails when a different user tries to access the job', async () => {
    const job = {
      jobId: 'job-1',
      userId: 'owner-user',
      status: SCAN_STATUSES.COMPLETED,
      results: { reportPath: 'r', jsonlPath: 'j', summary: {} },
    };
    const jobManager = { getJob: vi.fn().mockResolvedValue(job) };
    const scanResults = createScanResultsHandler({ jobManager, getBucket: () => makeBucket({}) });

    await expect(
      scanResults({ jobId: 'job-1' }, makeContext('someone-else'))
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('fails without auth', async () => {
    const jobManager = { getJob: vi.fn() };
    const scanResults = createScanResultsHandler({ jobManager, getBucket: () => makeBucket({}) });

    await expect(scanResults({ jobId: 'job-1' }, makeContext(null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(jobManager.getJob).not.toHaveBeenCalled();
  });
});
