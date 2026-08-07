const functions = require('firebase-functions');
const { JobManager } = require('./lib/jobManager');
const { getServiceAccountEmail, getProjectId } = require('./lib/cloudRunTrigger');

/**
 * Builds the `getScanStatus` callable handler.
 *
 * @param {{ jobManager?: JobManager }} [overrides] Dependency-injection seam
 *   for tests. Production code (`getScanStatus` below) omits this, so a
 *   real `JobManager` is constructed lazily on first invocation.
 */
function createGetScanStatusHandler(overrides = {}) {
  return async function getScanStatus(data, context) {
    // Test mode bypass
    const userId = context?.auth?.uid || (data?.testMode ? 'test-user' : null);

    if (!userId) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Bu işlemi gerçekleştirmek için giriş yapmalısınız.'
      );
    }

    const { jobId } = data || {};
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Geçerli bir jobId belirtmelisiniz.'
      );
    }

    const jobManager = overrides.jobManager || new JobManager();

    let job;
    try {
      job = await jobManager.getJob(jobId);
      console.log(`[DEBUG getScanStatus] Found job ${jobId}, userId: ${job.userId}, auth.uid: ${context.auth.uid}`);
    } catch (err) {
      console.error(`[DEBUG getScanStatus] Job not found: ${jobId}, error: ${err.message}`);
      throw new functions.https.HttpsError('not-found', 'Tarama kaydı bulunamadı.');
    }

    if (job.userId !== context.auth.uid) {
      console.error(`[DEBUG getScanStatus] Permission denied: job.userId=${job.userId}, auth.uid=${context.auth.uid}`);
      throw new functions.https.HttpsError(
        'permission-denied',
        'Bu taramaya erişim yetkiniz yok.'
      );
    }

    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      results: job.results,
      errorMsg: job.errorMsg,
    };
  };
}

// Deployed callable
const getScanStatus = functions
  .https.onCall(createGetScanStatusHandler());

module.exports = { getScanStatus, createGetScanStatusHandler };
