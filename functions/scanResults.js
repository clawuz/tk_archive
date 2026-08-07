const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { JobManager } = require('./lib/jobManager');
const { SCAN_STATUSES } = require('./lib/firestoreSchema');
const { getServiceAccountEmail, getProjectId } = require('./lib/cloudRunTrigger');

/**
 * Storage paths on the job record may be stored as `gs://bucket/path/...`
 * (see Task 1's JobManager tests) but `bucket.file(path)` expects a path
 * relative to the bucket, not a full gs:// URI. Strip the scheme+bucket if
 * present; pass through untouched otherwise.
 */
function toBucketRelativePath(path) {
  if (typeof path === 'string' && path.startsWith('gs://')) {
    const withoutScheme = path.slice('gs://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    return slashIdx === -1 ? '' : withoutScheme.slice(slashIdx + 1);
  }
  return path;
}

function defaultGetBucket() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  // Must be the same bucket the Cloud Run Job uploaded to. Terraform sets
  // RESULTS_BUCKET on the job (archive-scan-results-{project}) and
  // .github/workflows/deploy-functions.yml sets the identical value on this
  // function. Falling through to admin.storage().bucket() would read the
  // Firebase *default* bucket instead, and every download would 404 against a
  // scan that had in fact completed successfully.
  const bucketName = process.env.RESULTS_BUCKET;
  return bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
}

/**
 * Builds the `scanResults` callable handler.
 *
 * @param {{ jobManager?: JobManager, getBucket?: () => object }} [overrides]
 *   Dependency-injection seam for tests. Production code (`scanResults`
 *   below) omits this, so a real `JobManager` and the real Storage bucket
 *   are resolved lazily on first invocation.
 */
function createScanResultsHandler(overrides = {}) {
  return async function scanResults(data, context) {
    if (!context || !context.auth || !context.auth.uid) {
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
    const getBucket = overrides.getBucket || defaultGetBucket;

    let job;
    try {
      job = await jobManager.getJob(jobId);
    } catch (err) {
      throw new functions.https.HttpsError('not-found', 'Tarama kaydı bulunamadı.');
    }

    if (job.userId !== context.auth.uid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Bu taramaya erişim yetkiniz yok.'
      );
    }

    if (job.status !== SCAN_STATUSES.COMPLETED) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Tarama henüz tamamlanmadı.'
      );
    }

    if (!job.results || !job.results.reportPath || !job.results.jsonlPath) {
      throw new functions.https.HttpsError(
        'internal',
        'Tarama sonucu dosya yolları eksik.'
      );
    }

    const bucket = getBucket();

    let reportBuffer;
    let jsonlBuffer;
    try {
      [[reportBuffer], [jsonlBuffer]] = await Promise.all([
        bucket.file(toBucketRelativePath(job.results.reportPath)).download(),
        bucket.file(toBucketRelativePath(job.results.jsonlPath)).download(),
      ]);
    } catch (err) {
      console.error(`Sonuç dosyaları indirilemedi (jobId=${jobId}):`, err);
      throw new functions.https.HttpsError(
        'internal',
        'Tarama sonuç dosyaları indirilemedi.'
      );
    }

    return {
      report: reportBuffer.toString('utf-8'),
      jsonl: jsonlBuffer.toString('utf-8'),
      summary: job.results.summary || {},
    };
  };
}

// Runs as archive-scanner — see the note on getScanStatus.js for why the
// default App Engine service account is not relied on.
//
// Deployed callable
const scanResults = functions
  .https.onCall(createScanResultsHandler());

module.exports = { scanResults, createScanResultsHandler };
