/**
 * Firestore schema constants for Archive Inventory scan job tracking.
 *
 * Collection: /scans/{scanId}
 *   - userId: string (owner)
 *   - archiveRoot: string (e.g. "/Volumes/Arsiv")
 *   - scanType: "local" | "drive" | "both"
 *   - status: "queued" | "running" | "completed" | "failed"
 *   - createdAt: timestamp
 *   - startedAt: timestamp | null
 *   - completedAt: timestamp | null
 *   - progress: { filesProcessed: number, totalEstimate: number }
 *   - results: { jsonlPath: string, reportPath: string, summary: {...} } | null
 *   - errorMsg: string | null
 */

const SCAN_STATUSES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const SCAN_TYPES = Object.freeze({
  LOCAL: 'local',
  DRIVE: 'drive',
  BOTH: 'both',
});

const COLLECTIONS = Object.freeze({
  SCANS: 'scans',
  SCAN_LOGS: 'scan_logs',
});

module.exports = { SCAN_STATUSES, SCAN_TYPES, COLLECTIONS };
