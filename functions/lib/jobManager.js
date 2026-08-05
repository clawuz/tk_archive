const admin = require('firebase-admin');
const { SCAN_STATUSES, COLLECTIONS } = require('./firestoreSchema');

/**
 * JobManager — CRUD operations for archive scan jobs stored in Firestore
 * (/scans/{scanId}).
 *
 * The constructor takes no required arguments in production use
 * (`new JobManager()`), matching the Task 1 interface contract. It accepts
 * an optional Firestore-compatible db instance so tests can inject an
 * in-memory double instead of talking to a live/emulated Firestore.
 */
class JobManager {
  constructor(db) {
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = admin.firestore();
      } catch (err) {
        // If no app is initialized, Cloud Functions should auto-initialize.
        // This is a fallback; in production, admin SDK is pre-initialized.
        if (!admin.apps.length) {
          admin.initializeApp();
          this.db = admin.firestore();
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * Create a new scan job record.
   * @returns {Promise<{ jobId: string, createdAt: FirebaseFirestore.Timestamp }>}
   */
  async createJob(userId, archiveRoot, scanType) {
    const docRef = this.db.collection(COLLECTIONS.SCANS).doc();
    const createdAt = admin.firestore.Timestamp.now();

    const jobData = {
      userId,
      archiveRoot,
      scanType,
      status: SCAN_STATUSES.QUEUED,
      createdAt,
      startedAt: null,
      completedAt: null,
      progress: { filesProcessed: 0, totalEstimate: 0 },
      results: null,
      errorMsg: null,
    };

    await docRef.set(jobData);

    return { jobId: docRef.id, createdAt };
  }

  /**
   * Update job status and any additional fields (progress, errorMsg, results).
   * Automatically stamps startedAt when transitioning to RUNNING and
   * completedAt when transitioning to COMPLETED/FAILED, unless the caller
   * already supplied those fields in `updates`.
   * @returns {Promise<void>}
   */
  async updateJobStatus(jobId, status, updates = {}) {
    const docRef = this.db.collection(COLLECTIONS.SCANS).doc(jobId);

    const payload = { status };

    if (Object.prototype.hasOwnProperty.call(updates, 'progress')) {
      payload.progress = updates.progress;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'errorMsg')) {
      payload.errorMsg = updates.errorMsg;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'results')) {
      payload.results = updates.results;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'startedAt')) {
      payload.startedAt = updates.startedAt;
    } else if (status === SCAN_STATUSES.RUNNING) {
      payload.startedAt = admin.firestore.Timestamp.now();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'completedAt')) {
      payload.completedAt = updates.completedAt;
    } else if (status === SCAN_STATUSES.COMPLETED || status === SCAN_STATUSES.FAILED) {
      payload.completedAt = admin.firestore.Timestamp.now();
    }

    await docRef.update(payload);
  }

  /**
   * Retrieve a job record by id.
   * @returns {Promise<{ jobId: string, status: string, createdAt: *, startedAt: *, completedAt: *, results: *, errorMsg: * }>}
   * @throws {Error} if the job does not exist
   */
  async getJob(jobId) {
    const snapshot = await this.db.collection(COLLECTIONS.SCANS).doc(jobId).get();

    if (!snapshot.exists) {
      throw new Error(`Tarama kaydı bulunamadı: ${jobId}`);
    }

    return { jobId: snapshot.id, ...snapshot.data() };
  }
}

module.exports = { JobManager };
