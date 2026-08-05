const functions = require('firebase-functions');
const { JobManager } = require('./lib/jobManager');
const { SCAN_STATUSES, SCAN_TYPES } = require('./lib/firestoreSchema');
const { triggerCloudRunJob: defaultTriggerCloudRunJob, getServiceAccountEmail, getProjectId } = require('./lib/cloudRunTrigger');

const VALID_SCAN_TYPES = Object.values(SCAN_TYPES);

/**
 * Builds the `startScan` callable handler.
 *
 * @param {{ jobManager?: JobManager, triggerCloudRunJob?: Function }} [overrides]
 *   Dependency-injection seam for tests — production code (the exported
 *   `startScan` Cloud Function below) calls this with no arguments, which
 *   lazily constructs the real `JobManager` and the real Cloud Run trigger
 *   the first time the handler actually runs (not at module load time).
 */
function createStartScanHandler(overrides = {}) {
  return async function startScan(data, context) {
    if (!context || !context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Bu işlemi gerçekleştirmek için giriş yapmalısınız.'
      );
    }

    const { archiveRoot, scanType } = data || {};

    if (typeof archiveRoot !== 'string' || archiveRoot.trim() === '') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Geçerli bir arşiv kök dizini (archiveRoot) belirtmelisiniz.'
      );
    }

    if (!VALID_SCAN_TYPES.includes(scanType)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `scanType şu değerlerden biri olmalıdır: ${VALID_SCAN_TYPES.join(', ')}.`
      );
    }

    const jobManager = overrides.jobManager || new JobManager();
    const triggerCloudRunJob = overrides.triggerCloudRunJob || defaultTriggerCloudRunJob;

    const userId = context.auth.uid;
    let jobId;
    try {
      ({ jobId } = await jobManager.createJob(userId, archiveRoot, scanType));
    } catch (err) {
      throw new functions.https.HttpsError(
        'internal',
        'Tarama kaydı oluşturulamadı. Lütfen daha sonra tekrar deneyin.'
      );
    }

    // Trigger the Cloud Run scan job asynchronously — we intentionally do
    // NOT await this before responding to the caller (the brief calls for
    // "async, don't wait"). If the trigger call itself fails to queue (not
    // the scan's eventual outcome, just the API call that starts it), mark
    // the job failed so the dashboard doesn't show it stuck at "queued".
    Promise.resolve()
      .then(() => triggerCloudRunJob({ jobId, archiveRoot, scanType }))
      .catch(async (err) => {
        console.error(`Cloud Run job tetikleme hatası (jobId=${jobId}):`, err);
        try {
          await jobManager.updateJobStatus(jobId, SCAN_STATUSES.FAILED, {
            errorMsg: 'Tarama başlatılamadı: Cloud Run job tetiklenemedi.',
          });
        } catch (updateErr) {
          console.error(`Job durumu güncellenemedi (jobId=${jobId}):`, updateErr);
        }
      });

    return { jobId, status: SCAN_STATUSES.QUEUED };
  };
}

// Deployed callable. Runs as the archive-scanner service account so it has
// permission to invoke the Cloud Run Admin API (Task 4's scanner job) —
// GCLOUD_PROJECT is populated automatically by the Cloud Functions runtime,
// no secret/project id is hardcoded here.
const startScan = functions
  .runWith({ serviceAccount: getServiceAccountEmail(getProjectId() || '{PROJECT}') })
  .https.onCall(createStartScanHandler());

module.exports = { startScan, createStartScanHandler };
