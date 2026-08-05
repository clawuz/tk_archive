const { createStartScanScheduledHandler } = require('../startScanScheduled');
const { SCAN_STATUSES } = require('../lib/firestoreSchema');

const SCHEDULER_SA = 'archive-scheduler@tk-archive-cd9d0.iam.gserviceaccount.com';

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    body: {},
    ...overrides,
  };
}

function makeJobManager() {
  return {
    createJob: vi.fn().mockResolvedValue({ jobId: 'job-sched-1', createdAt: 'ts' }),
    updateJobStatus: vi.fn().mockResolvedValue(undefined),
  };
}

const BASE_ENV = {
  SCHEDULED_SCAN_USER_ID: 'system-scheduler-uid',
  SCHEDULED_ARCHIVE_ROOT: '/mnt/arsiv',
  SCHEDULED_SCAN_TYPE: 'both',
};

describe('startScanScheduled', () => {
  it('creates a job and triggers Cloud Run for the scheduler payload', async () => {
    const jobManager = makeJobManager();
    const triggerCloudRunJob = vi.fn().mockResolvedValue({});
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob,
      env: BASE_ENV,
    });

    const res = makeRes();
    await handler(makeReq({ body: { archiveRoot: '/mnt/arsiv', scanType: 'both' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ jobId: 'job-sched-1', status: SCAN_STATUSES.QUEUED });
    expect(jobManager.createJob).toHaveBeenCalledWith(
      'system-scheduler-uid',
      '/mnt/arsiv',
      'both'
    );
    expect(triggerCloudRunJob).toHaveBeenCalledWith({
      jobId: 'job-sched-1',
      archiveRoot: '/mnt/arsiv',
      scanType: 'both',
    });
  });

  it('falls back to the configured defaults when the body is empty', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn().mockResolvedValue({}),
      env: BASE_ENV,
    });

    const res = makeRes();
    await handler(makeReq({ body: {} }), res);

    expect(res.statusCode).toBe(200);
    expect(jobManager.createJob).toHaveBeenCalledWith(
      'system-scheduler-uid',
      '/mnt/arsiv',
      'both'
    );
  });

  it('rejects non-POST methods', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn(),
      env: BASE_ENV,
    });

    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);

    expect(res.statusCode).toBe(405);
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('rejects an invalid scanType', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn(),
      env: BASE_ENV,
    });

    const res = makeRes();
    await handler(makeReq({ body: { scanType: 'everything' } }), res);

    expect(res.statusCode).toBe(400);
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('refuses to create an ownerless scan when SCHEDULED_SCAN_USER_ID is unset', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn(),
      env: { SCHEDULED_ARCHIVE_ROOT: '/mnt/arsiv', SCHEDULED_SCAN_TYPE: 'both' },
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it('fails with 400 when neither the body nor the env supplies archiveRoot', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn(),
      env: { SCHEDULED_SCAN_USER_ID: 'system-scheduler-uid' },
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(400);
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  describe('OIDC caller verification', () => {
    const env = { ...BASE_ENV, SCHEDULER_SERVICE_ACCOUNT: SCHEDULER_SA, SCHEDULER_AUDIENCE: 'https://aud' };

    it('accepts a token issued to the configured scheduler service account', async () => {
      const jobManager = makeJobManager();
      const verifyOidcToken = vi
        .fn()
        .mockResolvedValue({ email: SCHEDULER_SA, email_verified: true });
      const handler = createStartScanScheduledHandler({
        jobManager,
        triggerCloudRunJob: vi.fn().mockResolvedValue({}),
        verifyOidcToken,
        env,
      });

      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer good-token' } }), res);

      expect(res.statusCode).toBe(200);
      expect(verifyOidcToken).toHaveBeenCalledWith('good-token', 'https://aud');
    });

    it('rejects a request with no bearer token', async () => {
      const jobManager = makeJobManager();
      const handler = createStartScanScheduledHandler({
        jobManager,
        triggerCloudRunJob: vi.fn(),
        verifyOidcToken: vi.fn(),
        env,
      });

      const res = makeRes();
      await handler(makeReq(), res);

      expect(res.statusCode).toBe(401);
      expect(jobManager.createJob).not.toHaveBeenCalled();
    });

    it('rejects a token that fails verification', async () => {
      const jobManager = makeJobManager();
      const handler = createStartScanScheduledHandler({
        jobManager,
        triggerCloudRunJob: vi.fn(),
        verifyOidcToken: vi.fn().mockRejectedValue(new Error('bad signature')),
        env,
      });

      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer forged' } }), res);

      expect(res.statusCode).toBe(401);
      expect(jobManager.createJob).not.toHaveBeenCalled();
    });

    it('rejects a valid token belonging to a different service account', async () => {
      const jobManager = makeJobManager();
      const handler = createStartScanScheduledHandler({
        jobManager,
        triggerCloudRunJob: vi.fn(),
        verifyOidcToken: vi
          .fn()
          .mockResolvedValue({ email: 'someone-else@evil.iam.gserviceaccount.com', email_verified: true }),
        env,
      });

      const res = makeRes();
      await handler(makeReq({ headers: { authorization: 'Bearer other-sa' } }), res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).not.toContain(SCHEDULER_SA);
      expect(jobManager.createJob).not.toHaveBeenCalled();
    });
  });

  it('reports failure to the scheduler (so it retries) and marks the job failed when the trigger rejects', async () => {
    const jobManager = makeJobManager();
    const handler = createStartScanScheduledHandler({
      jobManager,
      triggerCloudRunJob: vi.fn().mockRejectedValue(new Error('Cloud Run down')),
      env: BASE_ENV,
    });

    const res = makeRes();
    await handler(makeReq(), res);

    // Non-2xx matters: a 200 here would make Cloud Scheduler record a
    // successful run and skip its retries for a scan that never started.
    expect(res.statusCode).toBe(500);
    expect(jobManager.updateJobStatus).toHaveBeenCalledWith(
      'job-sched-1',
      SCAN_STATUSES.FAILED,
      expect.objectContaining({ errorMsg: expect.any(String) })
    );
  });
});
