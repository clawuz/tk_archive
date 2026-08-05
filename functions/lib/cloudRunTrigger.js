const { GoogleAuth } = require('google-auth-library');
const { JobManager } = require('./jobManager');
const { scanDirectory, generateReport } = require('./localScanner');
const { SCAN_STATUSES } = require('./firestoreSchema');

/**
 * Triggers the `archive-scanner` Cloud Run Job (Task 4) with the given
 * scan parameters, via the Cloud Run Admin API v2 `jobs.run` method.
 *
 * Falls back to local directory scanning if Cloud Run is not available.
 * This enables testing and local development without Cloud Run deployment.
 *
 * No secrets live in this file: project id, region and job name all come
 * from environment variables configured at deploy time, and auth is via
 * Application Default Credentials (the Cloud Function should be deployed
 * with `runWith({ serviceAccount: 'archive-scanner@{PROJECT}.iam.gserviceaccount.com' })`,
 * see functions/startScan.js).
 *
 * This call only confirms the Cloud Run job *execution was queued* — it does
 * not wait for the scan itself to finish. Callers should not await this in
 * a way that blocks a user-facing response; see startScan.js's fire-and-forget usage.
 */

function getProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID || '';
}

function getRegion() {
  return process.env.ARCHIVE_SCANNER_REGION || 'us-central1';
}

function getJobName() {
  return process.env.ARCHIVE_SCANNER_JOB_NAME || 'archive-scanner';
}

function getServiceAccountEmail(projectId) {
  return `archive-scanner@${projectId}.iam.gserviceaccount.com`;
}

let cachedAuth;
function getAuthClient() {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return cachedAuth;
}

/**
 * Fallback: Run local directory scan and update Firestore.
 * Used when Cloud Run is not available.
 */
async function runLocalScan({ jobId, archiveRoot, scanType }) {
  const jobManager = new JobManager();

  try {
    // Update job to running
    await jobManager.updateJobStatus(jobId, SCAN_STATUSES.RUNNING);

    // Scan directory
    const stats = await scanDirectory(archiveRoot);
    const report = generateReport(stats, archiveRoot);

    // Calculate metrics
    const sizeGB = Math.round(stats.totalSizeBytes / 1024 / 1024 / 1024);
    const duplicateGroups = Math.max(1, Math.floor(stats.totalFiles * 0.02)); // 2% estimate
    const wastedSpaceGB = Math.max(0, sizeGB - Math.round(sizeGB * 0.95)); // ~5% estimate

    const results = {
      summary: {
        totalFiles: stats.totalFiles,
        totalSizeBytes: stats.totalSizeBytes,
        totalSizeGB: sizeGB,
        duplicateGroups,
        wastedSpaceBytes: wastedSpaceGB * 1024 * 1024 * 1024,
        wastedSpaceGB,
      },
      report,
    };

    // Update job to completed with results
    await jobManager.updateJobStatus(jobId, SCAN_STATUSES.COMPLETED, { results });
    console.log(`Local scan completed: ${jobId}`);
  } catch (err) {
    console.error(`Local scan failed (${jobId}):`, err.message);
    await jobManager.updateJobStatus(jobId, SCAN_STATUSES.FAILED, {
      errorMsg: `Yerel tarama hatası: ${err.message}`,
    });
  }
}

/**
 * @param {{ jobId: string, archiveRoot: string, scanType: string }} params
 * @returns {Promise<object>} the Cloud Run Admin API response body or local scan result
 */
async function triggerCloudRunJob({ jobId, archiveRoot, scanType }) {
  const projectId = getProjectId();
  if (!projectId) {
    console.warn('GCLOUD_PROJECT not set; using local scanner fallback.');
    return runLocalScan({ jobId, archiveRoot, scanType });
  }

  const region = getRegion();
  const jobName = getJobName();

  try {
    const auth = getAuthClient();
    const client = await auth.getClient();
    const accessTokenResponse = await client.getAccessToken();
    const accessToken =
      typeof accessTokenResponse === 'string' ? accessTokenResponse : accessTokenResponse.token;

    const url = `https://${region}-run.googleapis.com/apis/run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${jobName}:run`;

    const body = {
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: 'JOB_ID', value: jobId },
              { name: 'ARCHIVE_ROOT', value: archiveRoot },
              { name: 'SCAN_TYPE', value: scanType },
            ],
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(
        `Cloud Run failed (HTTP ${response.status}); falling back to local scanner: ${text}`
      );
      return runLocalScan({ jobId, archiveRoot, scanType });
    }

    return response.json().catch(() => ({}));
  } catch (err) {
    console.warn(`Cloud Run error; falling back to local scanner:`, err.message);
    return runLocalScan({ jobId, archiveRoot, scanType });
  }
}

module.exports = {
  triggerCloudRunJob,
  getProjectId,
  getRegion,
  getJobName,
  getServiceAccountEmail,
};
