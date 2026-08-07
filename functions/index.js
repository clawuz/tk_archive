/**
 * Cloud Functions entry point.
 *
 * `functions/package.json` already declared `"main": "index.js"`, but the file
 * did not exist — `firebase deploy --only functions` would have found nothing
 * to deploy. Every function below was written in Tasks 2 and 5; this module
 * only exposes them.
 *
 * Deployed functions:
 *   startScan           callable  — user starts a scan from the dashboard
 *   getScanStatus       callable  — dashboard polls progress
 *   scanResults         callable  — dashboard downloads results
 *   startScanScheduled  https     — Cloud Scheduler starts the weekly scan
 *
 * The three callables require Firebase Auth. `startScanScheduled` requires a
 * service account OIDC token instead; see the comment at the top of
 * startScanScheduled.js for why it cannot be the same function as startScan.
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

module.exports = {
  startScan,
  getScanStatus,
  scanResults,
  startScanScheduled,
  download,
  tagNewFiles,
};
