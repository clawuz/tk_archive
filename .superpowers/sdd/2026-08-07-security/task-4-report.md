# Task 4: Server-Side Auth Bypass - Critical Security Fix

## Vulnerability Summary
Removed critical authentication bypass vulnerability (S4) that allowed unauthenticated requests to bypass Firebase Cloud Functions authentication by passing `testMode: true` in the request body.

## Files Modified

### 1. `functions/startScan.js`
**Change:** Replaced unsafe authentication pattern with strict auth check
- **Before:** `const userId = context?.auth?.uid || (data?.testMode ? 'test-user' : null);`
- **After:** 
  ```javascript
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '...');
  }
  const userId = context.auth.uid;
  ```
- **Impact:** Eliminates auth bypass; now rejects ALL unauthenticated requests immediately

### 2. `functions/getScanStatus.js`
**Change:** Identical fix applied to getScanStatus function
- **Before:** `const userId = context?.auth?.uid || (data?.testMode ? 'test-user' : null);`
- **After:** 
  ```javascript
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '...');
  }
  const userId = context.auth.uid;
  ```
- **Impact:** Prevents status queries from bypassing authentication

### 3. `src/components/dam/DAMDashboard.jsx`
**Change:** Removed testMode parameter from function call
- **Before:** 
  ```javascript
  const result = await startScan({
    archiveRoot: archiveRoot.trim(),
    scanType: scanSource,
    testMode: params.get('testMode') === 'true'
  })
  ```
- **After:** 
  ```javascript
  const result = await startScan({
    archiveRoot: archiveRoot.trim(),
    scanType: scanSource
  })
  ```
- **Impact:** Removes client-side test mode logic; relies on proper authentication

## Deployment Status

### Functions Deployed Successfully
- ✔ `startScan(us-central1)` - Successful update operation
- ✔ `getScanStatus(us-central1)` - Successful update operation

### Deployment Warnings (Non-Critical)
- Node.js 20 runtime deprecated on 2026-04-30 (scheduled decommission 2026-10-30)
- firebase-functions SDK 4.9.0 is outdated; upgrade to 5.1.0+ recommended
- Artifact cleanup policy not configured for us-central1 (minor monthly billing impact)

### Deployment Note
The `download` function failed to update (unrelated to security fix). This is a pre-existing issue in the project, not caused by this change.

## Security Validation

### Authentication Flow (Post-Fix)
1. Cloud Functions receive request with `context` object
2. **First check:** `if (!context.auth)` → immediate rejection with 'unauthenticated' error
3. If auth exists, extract `userId = context.auth.uid`
4. No request body parameter can bypass this check

### Attack Surface Eliminated
- Request body parameter `testMode` no longer bypasses authentication
- No fallback to 'test-user' when auth is missing
- All callers must be authenticated (Firebase Auth)

## Git Commit
- **Commit:** `bce2514`
- **Message:** `security: remove server-side testMode auth bypass from callables`
- **Changes:** 3 files changed, 5 insertions(+), 11 deletions(-)
- **Staged Files:** 
  - functions/startScan.js
  - functions/getScanStatus.js
  - src/components/dam/DAMDashboard.jsx

## Remediation Complete
All requirements met:
- [x] Fixed testMode fallback in startScan.js
- [x] Fixed testMode fallback in getScanStatus.js
- [x] Removed testMode parameter from DAMDashboard.jsx calls
- [x] Deployed functions successfully
- [x] Committed with security message
- [x] Verified deployment status
