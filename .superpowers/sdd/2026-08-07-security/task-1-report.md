# Task 1: Rotate Exposed Service Account Key — Report

## Status: NEEDS_CONTEXT

**Waiting for:** New service account key from GCP Console (manual rotation by human operator)

---

## What's the Vulnerability

A Firebase Admin SDK service account private key has been committed to the Git repository and is currently live in production on `tk-archive-dam.web.app`.

**Compromised Key Details:**
- **File:** `functions/config/serviceAccountKey.json`
- **Service Account:** `firebase-adminsdk-fbsvc@tk-archive-dam.iam.gserviceaccount.com`
- **Key ID:** `70789297f6019ae0bd010cf4bc2d75bfcacca572`
- **Committed in:** Commit `e4acaaeb95964acfeb14f12fc8d212c32a5a9f30`
  - Message: "feat: complete video preview, thumbnails, downloads, folder navigation"
- **First appearance in repo:** This single commit (August 5, 2026)
- **Impact:** Full Firebase Admin access (read/write all Firestore, storage, auth, etc.)

---

## What Needs to Happen — HUMAN ACTION REQUIRED

**YOU CANNOT PROCEED** until the human operator completes the following in Google Cloud Console:

### Step-by-Step GCP Console Actions

1. **Open Google Cloud Console**
   - URL: https://console.cloud.google.com

2. **Select the Firebase Project**
   - Project: `tk-archive-dam`

3. **Revoke the Exposed Key**
   - Navigate to: **IAM & Admin** → **Service Accounts**
   - Find service account: `firebase-adminsdk-fbsvc@tk-archive-dam.iam.gserviceaccount.com`
   - Go to: **Keys** tab
   - Find the key with ID: `70789297f6019ae0bd010cf4bc2d75bfcacca572`
   - Click **Delete** (or **Revoke** if available)
   - Confirm deletion

4. **Create a New Key**
   - Still in the **Keys** tab
   - Click **Create New Key** → **JSON**
   - The private key JSON file will download automatically

5. **Place New Key in Repository**
   - Save the downloaded JSON to: `/Users/okilavuz/Desktop/omer_works/TK_Archive/functions/config/serviceAccountKey.json`
   - ⚠️ **TEMPORARY ONLY** — This file will NOT be committed after cleanup

6. **Notify Claude**
   - Come back to this session and tell Claude: "key rotated"
   - Claude will then proceed with Part B

---

## What Claude Will Do After (Part B)

Once the new key is in place, Claude will:

1. **Deploy Functions to Verify New Key Works**
   - Run: `cd functions && npm run deploy`
   - Confirm zero errors

2. **Update .gitignore**
   - Add `functions/config/` to `.gitignore`
   - Ensures future keys never get committed

3. **Purge Leaked Key from Git History**
   - Use `git filter-branch` to rewrite history
   - Remove the private key from commit `e4acaaeb95964acfeb14f12fc8d212c32a5a9f30`
   - Rebuild all downstream commits

4. **Force-Push Cleaned History**
   - Push to `origin/main` with `--force`
   - GitHub will accept the rewritten history
   - All collaborators must pull the new history

5. **Final Verification**
   - Confirm the key no longer appears in any commit
   - Verify deployment still works with new key

---

## Project Context

- **Repository:** https://github.com/clawuz/tk_archive
- **Branch:** `main` (15 commits ahead of origin/main)
- **Functions Directory:** `/Users/okilavuz/Desktop/omer_works/TK_Archive/functions/`
- **Current .gitignore:** Does NOT exclude `functions/config/` (will be fixed)

---

## Important Notes

- **Do NOT attempt to modify the private key manually** — only the human operator with GCP IAM permissions can rotate the key
- **The new key will be placed in the same file path** (`functions/config/serviceAccountKey.json`), so the app configuration doesn't need to change
- **Force-push is required** — Git history rewriting requires explicit force authorization; this is safe for a production incident but should not be done for other reasons
- **All team members need to sync** — After the force-push, all local clones need to pull the new history; stale working trees will have merge conflicts

---

## Next Steps

1. ✅ Claude has identified the vulnerability and confirmed the file location
2. ⏳ **HUMAN**: Open GCP Console and rotate the key (steps above)
3. ⏳ **HUMAN**: Save new key to `functions/config/serviceAccountKey.json`
4. ⏳ **HUMAN**: Tell Claude "key rotated"
5. 🔄 Claude will deploy, fix .gitignore, rewrite history, and force-push

---

**Prepared by:** Claude Code Agent  
**Date:** 2026-08-07  
**Incident:** S1 - Service Account Private Key Exposed in Git
