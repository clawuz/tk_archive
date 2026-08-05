/**
 * Deployment-shape tests.
 *
 * These assert on the *deployed function objects* rather than the handler
 * factories the other suites exercise. Every defect below has already
 * happened once in this project and was caught by eye during review, not by a
 * test:
 *
 *   - index.js did not exist while package.json declared it as "main", so a
 *     deploy would have succeeded while deploying zero functions;
 *   - getScanStatus and scanResults were missing runWith({ serviceAccount }),
 *     leaving them on the default App Engine service account while
 *     terraform/main.tf grants Firestore and results-bucket access to
 *     archive-scanner alone.
 *
 * Both are invisible to handler-level tests: the handlers are correct in
 * isolation and only the deployment wiring is wrong.
 */

const EXPECTED_SERVICE_ACCOUNT = 'archive-scanner@test-project.iam.gserviceaccount.com';

let deployed;

beforeAll(() => {
  // Read at module load by getServiceAccountEmail(getProjectId()); must be set
  // before index.js is required.
  process.env.GCLOUD_PROJECT = 'test-project';
  deployed = require('../index.js');
});

describe('deployed function wiring', () => {
  it('exports every function the dashboard and scheduler depend on', () => {
    expect(Object.keys(deployed).sort()).toEqual(
      ['getScanStatus', 'scanResults', 'startScan', 'startScanScheduled'].sort()
    );
  });

  it.each(['startScan', 'getScanStatus', 'scanResults', 'startScanScheduled'])(
    '%s runs as the archive-scanner service account, not the default App Engine one',
    (name) => {
      const fn = deployed[name];
      expect(typeof fn).toBe('function');

      // __endpoint is the modern shape, __trigger the legacy one; firebase-functions
      // v4 populates both. Checking whichever exists keeps this test from
      // breaking on an internal rename while still asserting the real thing.
      const meta = fn.__endpoint || fn.__trigger;
      expect(meta).toBeTruthy();
      expect(meta.serviceAccountEmail).toBe(EXPECTED_SERVICE_ACCOUNT);
    }
  );

  it('exposes startScanScheduled over HTTP and the rest as callables', () => {
    // The distinction is load-bearing: Cloud Scheduler cannot authenticate to
    // a callable, which is the entire reason startScanScheduled exists.
    expect(deployed.startScanScheduled.__endpoint.httpsTrigger).toBeTruthy();

    for (const name of ['startScan', 'getScanStatus', 'scanResults']) {
      expect(deployed[name].__endpoint.callableTrigger).toBeTruthy();
    }
  });
});
