const functions = require('firebase-functions');
const { OAuth2Client } = require('google-auth-library');
const { JobManager } = require('./lib/jobManager');
const { SCAN_STATUSES, SCAN_TYPES } = require('./lib/firestoreSchema');
const {
  triggerCloudRunJob: defaultTriggerCloudRunJob,
  getServiceAccountEmail,
  getProjectId,
} = require('./lib/cloudRunTrigger');

/**
 * `startScanScheduled` — the Cloud Scheduler entry point for the weekly scan.
 *
 * Why this exists as a separate function rather than reusing `startScan`:
 *
 *   `startScan` is a *callable* (`functions.https.onCall`). Callables
 *   authenticate with a Firebase Auth ID token, which the client SDK puts in
 *   the request body and the runtime turns into `context.auth`. Cloud
 *   Scheduler cannot produce one — it can only mint a Google OIDC token for a
 *   service account, which never populates `context.auth`. Pointing the
 *   scheduler at `startScan` produces an `unauthenticated` error every Monday
 *   at 02:00, forever, and the retries fail identically.
 *
 * So the scheduled path is a plain HTTP function. It performs the same two
 * steps `startScan` does — create the Firestore `/scans/{jobId}` record, then
 * trigger the Cloud Run Job — but authenticates the caller as a service
 * account instead of a user.
 *
 * Authentication is enforced twice, on purpose:
 *
 *   1. By the platform. The function is deployed without public invoker
 *      access, so Cloud Functions IAM rejects any caller lacking
 *      `roles/cloudfunctions.invoker` before this code runs.
 *   2. By this code, when `SCHEDULER_SERVICE_ACCOUNT` is set: the OIDC bearer
 *      token is verified against Google's public keys and its `email` claim
 *      is compared to the expected scheduler identity.
 *
 * Layer 2 exists because layer 1 is a deploy-time flag that is easy to get
 * wrong once (`--allow-unauthenticated` is a single word) and silently turns
 * this into an unauthenticated endpoint that starts 50 TB scans.
 *
 * No secrets: there is no shared token, no API key, and no service account
 * key. Configuration comes from environment variables set at deploy time.
 *
 * Environment variables
 *   SCHEDULED_SCAN_USER_ID     required — owner recorded on the scan document
 *   SCHEDULED_ARCHIVE_ROOT     default archiveRoot when the body omits it
 *   SCHEDULED_SCAN_TYPE        default scanType when the body omits it ("both")
 *   SCHEDULER_SERVICE_ACCOUNT  expected OIDC caller; skips token check if unset
 *   SCHEDULER_AUDIENCE         expected OIDC audience; defaults to the
 *                              function's own URL
 */

const VALID_SCAN_TYPES = Object.values(SCAN_TYPES);

const DEFAULT_SCAN_TYPE = SCAN_TYPES.BOTH;

function getFunctionUrl() {
  const projectId = getProjectId();
  const region = process.env.FUNCTION_REGION || process.env.ARCHIVE_SCANNER_REGION || 'us-central1';
  const name = process.env.K_SERVICE || process.env.FUNCTION_NAME || 'startScanScheduled';
  return `https://${region}-${projectId}.cloudfunctions.net/${name}`;
}

let cachedOAuthClient;
function defaultVerifyOidcToken(idToken, audience) {
  if (!cachedOAuthClient) {
    cachedOAuthClient = new OAuth2Client();
  }
  return cachedOAuthClient
    .verifyIdToken({ idToken, audience })
    .then((ticket) => ticket.getPayload());
}

/**
 * Builds the `startScanScheduled` handler.
 *
 * @param {{
 *   jobManager?: JobManager,
 *   triggerCloudRunJob?: Function,
 *   verifyOidcToken?: Function,
 *   env?: object
 * }} [overrides] Dependency-injection seam for tests, matching the pattern
 *   used by startScan.js / getScanStatus.js / scanResults.js.
 */
function createStartScanScheduledHandler(overrides = {}) {
  const env = overrides.env || process.env;

  return async function startScanScheduled(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Yalnızca POST istekleri kabul edilir.' });
      return;
    }

    // --- caller identity ---------------------------------------------------
    const expectedCaller = env.SCHEDULER_SERVICE_ACCOUNT;
    if (expectedCaller) {
      const verifyOidcToken = overrides.verifyOidcToken || defaultVerifyOidcToken;
      const header = req.headers ? req.headers.authorization || req.headers.Authorization : null;

      if (!header || !String(header).startsWith('Bearer ')) {
        res.status(401).json({ error: 'Kimlik doğrulanamadı: OIDC belirteci eksik.' });
        return;
      }

      const audience = env.SCHEDULER_AUDIENCE || getFunctionUrl();
      let payload;
      try {
        payload = await verifyOidcToken(String(header).slice('Bearer '.length), audience);
      } catch (err) {
        console.error('OIDC belirteci doğrulanamadı:', err);
        res.status(401).json({ error: 'Kimlik doğrulanamadı: OIDC belirteci geçersiz.' });
        return;
      }

      if (!payload || payload.email !== expectedCaller || payload.email_verified !== true) {
        // Logged, not returned: the response must not tell an unauthorized
        // caller which service account would have been accepted.
        console.error(
          `Beklenmeyen çağıran: ${payload && payload.email} (beklenen: ${expectedCaller})`
        );
        res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
        return;
      }
    }

    // --- scan parameters ---------------------------------------------------
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const archiveRoot =
      typeof body.archiveRoot === 'string' && body.archiveRoot.trim() !== ''
        ? body.archiveRoot
        : env.SCHEDULED_ARCHIVE_ROOT;

    if (typeof archiveRoot !== 'string' || archiveRoot.trim() === '') {
      res.status(400).json({
        error:
          'Geçerli bir arşiv kök dizini (archiveRoot) belirtilmedi ve SCHEDULED_ARCHIVE_ROOT tanımlı değil.',
      });
      return;
    }

    const scanType =
      typeof body.scanType === 'string' && body.scanType.trim() !== ''
        ? body.scanType
        : env.SCHEDULED_SCAN_TYPE || DEFAULT_SCAN_TYPE;

    if (!VALID_SCAN_TYPES.includes(scanType)) {
      res.status(400).json({
        error: `scanType şu değerlerden biri olmalıdır: ${VALID_SCAN_TYPES.join(', ')}.`,
      });
      return;
    }

    // A scheduled scan still needs an owner: Firestore rules scope /scans
    // documents by userId, and the dashboard lists a user's own scans. Without
    // this the weekly scan would produce records nobody can read.
    const userId = env.SCHEDULED_SCAN_USER_ID;
    if (typeof userId !== 'string' || userId.trim() === '') {
      console.error('SCHEDULED_SCAN_USER_ID tanımlı değil; zamanlanmış tarama sahipsiz kalırdı.');
      res.status(500).json({
        error: 'Sunucu yapılandırması eksik: SCHEDULED_SCAN_USER_ID tanımlı değil.',
      });
      return;
    }

    // --- run ---------------------------------------------------------------
    const jobManager = overrides.jobManager || new JobManager();
    const triggerCloudRunJob = overrides.triggerCloudRunJob || defaultTriggerCloudRunJob;

    let jobId;
    try {
      ({ jobId } = await jobManager.createJob(userId, archiveRoot, scanType));
    } catch (err) {
      console.error('Zamanlanmış tarama kaydı oluşturulamadı:', err);
      res.status(500).json({ error: 'Tarama kaydı oluşturulamadı.' });
      return;
    }

    // Unlike startScan (which answers a waiting user and fires the trigger off
    // in the background), this awaits: a non-2xx response is how Cloud
    // Scheduler learns to retry. Returning 200 while the trigger fails would
    // burn the weekly slot silently.
    try {
      await triggerCloudRunJob({ jobId, archiveRoot, scanType });
    } catch (err) {
      console.error(`Cloud Run job tetikleme hatası (jobId=${jobId}):`, err);
      try {
        await jobManager.updateJobStatus(jobId, SCAN_STATUSES.FAILED, {
          errorMsg: 'Tarama başlatılamadı: Cloud Run job tetiklenemedi.',
        });
      } catch (updateErr) {
        console.error(`Job durumu güncellenemedi (jobId=${jobId}):`, updateErr);
      }
      res.status(500).json({ error: 'Cloud Run job tetiklenemedi.', jobId });
      return;
    }

    res.status(200).json({ jobId, status: SCAN_STATUSES.QUEUED });
  };
}

// Deployed HTTP function. Runs as archive-scanner so it can call the Cloud Run
// Admin API, exactly like startScan. GCLOUD_PROJECT is injected by the
// runtime — no project id or credential is hardcoded here.
const startScanScheduled = functions
  .runWith({ serviceAccount: getServiceAccountEmail(getProjectId() || '{PROJECT}') })
  .https.onRequest(createStartScanScheduledHandler());

module.exports = { startScanScheduled, createStartScanScheduledHandler };
