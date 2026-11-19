/**
 * Cloud Functions entry point.
 *
 * `functions/package.json` already declared `"main": "index.js"`, but the file
 * did not exist — `firebase deploy --only functions` would have found nothing
 * to deploy. Every function below was written in Tasks 2 and 5; this module
 * only exposes them.
 *
 * Deployed functions:
 *   startScan           callable   — user starts a scan from the dashboard
 *   getScanStatus       callable   — dashboard polls progress
 *   scanResults         callable   — dashboard downloads results
 *   startScanScheduled  https      — Cloud Scheduler starts the weekly scan
 *   tagNewFiles         callable   — Claude Vision tagging. No longer called by the app
 *                                    (the dashboard button now queues the file for the
 *                                    free local v2 worker instead — see
 *                                    damService.requestAutoTag); kept deployed for ad-hoc use
 *
 * NOT exported: onFileNeedsTagging (the automatic Claude Vision trigger on
 * needs_tagging). The Anthropic API credit ran out and the local v2 worker
 * (tk-ai-engine/sprint3/ai_worker.py) polls needs_tagging itself now. The
 * function is still defined in ./tagNewFiles (as a no-op) — re-export it
 * here only if going back to Claude.
 *
 *   requestAccess       callable   — self-serve account provisioning from the login
 *                                    page, before the caller has ever signed in
 *   adminCreateUser     callable   — admin panel: create/promote a user with a
 *                                    chosen role (requestAccess always defaults
 *                                    to viewer; this is the one-step version)
 *   adminDeleteUser     callable   — admin panel: remove a user's Auth account
 *                                    and Firestore profile
 *
 * The other callables require Firebase Auth; `requestAccess` deliberately
 * doesn't (see its own comment for why) and validates the email domain
 * itself instead. `adminCreateUser`/`adminDeleteUser` require Auth *and*
 * check the caller's own Firestore role (see requireStaffCaller in
 * manageUsers.js) since custom claims aren't in use. `startScanScheduled`
 * requires a service account OIDC token instead of any of the above; see
 * the comment at the top of startScanScheduled.js for why it cannot be the
 * same function as startScan.
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK for all functions
if (!admin.apps.length) {
  admin.initializeApp();
}

const { startScan } = require('./startScan');
const { getScanStatus } = require('./getScanStatus');
const { scanResults } = require('./scanResults');
const { startScanScheduled } = require('./startScanScheduled');
const { download } = require('./download');
const { tagNewFiles } = require('./tagNewFiles');
const { requestAccess } = require('./requestAccess');
const { adminCreateUser, adminDeleteUser } = require('./manageUsers');

module.exports = {
  startScan,
  getScanStatus,
  scanResults,
  startScanScheduled,
  download,
  tagNewFiles,
  requestAccess,
  adminCreateUser,
  adminDeleteUser,
};
