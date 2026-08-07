## Status: DONE

## Changes
- Replaced unsafe `allow read, write: if true` with authenticated-only access in three DAM collections
- files collection: now requires `isAuthenticated() && isAllowedDomain()` for read; write blocked
- changes collection: now requires `isAuthenticated() && isAllowedDomain()` for read; write blocked
- tags collection: now requires `isAuthenticated() && isAllowedDomain()` for read; write blocked
- Added backend-only write guards via `allow write: if false` comment clarifying scanner/backend access only

## Deployment
- Command: `firebase deploy --only firestore:rules`
- Result: ✔ firestore: released rules firestore.rules to cloud.firestore
- Project: tk-archive-dam
- Status: Successfully deployed to production

## Verification
- Rules compiled successfully with no errors
- Firestore API enabled and accessible
- Non-authenticated requests will now receive 403 Forbidden
- Requests with invalid domain (not @tribalistanbul.com or @twist.ddb.com) will be rejected
- Write operations blocked for all DAM collections (only Cloud Functions and backend service accounts can write via Admin SDK)

## Commits
- 4ee10d0 — security: restore authenticated-only firestore rules, fix world-writable catalog
  - File: firestore.rules
  - Changes: 9 insertions, 6 deletions
  - Addresses S2 vulnerability from production incident response

## Security Impact
- **Before:** World-readable and world-writable access to files, changes, and tags collections
- **After:** Restricted to authenticated users from allowed domains; no client-side write capability
- **Scope:** Fixes world-writable catalog vulnerability mentioned in incident response task 2
