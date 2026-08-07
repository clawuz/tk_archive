# Task 7: Fix FolderBrowser React Hook Violation

## Status: COMPLETED

### Problem Identified
The `FolderBrowser` component had a React hooks violation where an early return statement was placed BEFORE the `useMemo` hook call. This caused React to crash with "more hooks than during previous render" error when the file source switched between Drive (returns null) and Local (renders component).

### Root Cause
- Line 5: `if (file?.source !== 'local') return null` (early return)
- Line 9: `const breadcrumbs = useMemo(() => {...}, [filePath])` (hook after return)

When the component switches from Drive to Local, the hook count changes:
- Drive source: 0 hooks called (early return)
- Local source: 1 hook called (useMemo executes)

This violates React's "Rules of Hooks" which require consistent hook calls.

### Solution Implemented

**File:** `/Users/okilavuz/Desktop/omer_works/TK_Archive/src/components/dam/FolderBrowser.jsx`

**Changes Made:**
1. Moved `useMemo` hook above the early return statement (line 7 → before line 5)
2. Moved the source check logic inside the `useMemo` callback, returning empty array when not local
3. Updated dependencies to include `file?.source`
4. Moved early return to after all hooks are called (line 18)

**Key Code Changes:**
- Added conditional inside useMemo: `if (file?.source !== 'local') return []`
- Updated dependencies: `[filePath, file?.source]` (was just `[filePath]`)
- Early return now safe at line 18, after all hooks execute

### Verification

✅ **Build:** `npm run build` - SUCCESS
- 67 modules transformed
- 0 errors
- Output: dist/index.html, dist/assets/index-*.css, dist/assets/index-*.js

✅ **Git Commit:** `925c3d1`
- Message: "fix: move useMemo above early return to fix react hooks violation"
- Changes: 1 file changed, 6 insertions, 3 deletions

### Testing Notes
The fix ensures:
- Hooks are called on every render regardless of file source
- useMemo callback handles null source by returning empty breadcrumbs array
- Component safely navigates Drive → Local → Drive without crashes
- Dependency array properly includes all captured variables

### Technical Details
**Hook Consistency Fix:**
- useMemo now ALWAYS executes (moved before early return)
- The source check moved into the hook callback
- Early return now happens AFTER all hooks, making it safe
- React can now track consistent hook usage across renders

**Dependency Update Rationale:**
- Added `file?.source` to dependencies because useMemo now checks this value
- Without it, stale closures could prevent proper re-computation when source changes
- This ensures proper reactive behavior when file source switches

