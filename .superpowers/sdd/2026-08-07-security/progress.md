# SDD ledger — plan: docs/superpowers/plans/2026-08-07-security-remediation-video-tagging.md

## Tasks

- [ ] Task 1: Rotate Exposed Service Account Key
- [ ] Task 2: Restore Firestore Security Rules
- [ ] Task 3: Remove Client-Side Auth Bypass
- [ ] Task 4: Remove Server-Side Auth Bypass
- [ ] Task 5: Secure Download Endpoint
- [ ] Task 6: Redesign Local File Serving
- [ ] Task 7: Fix FolderBrowser Hook Violation
- [ ] Task 8: Implement Breadcrumb Navigation
- [ ] Task 9: Extract 10 Strategic Frames from Videos
- [ ] Task 10: Google Cloud Vision Integration
- [ ] Task 11: Display Video Frames + Tags in FileDetail
- [ ] Task 12: TypeScript Configuration + Code Quality
- [ ] Task 13: Final Verification & Deployment

## Progress

**Task 1:** NEEDS_CONTEXT (awaiting GCP manual key rotation)
- Exposed key identified: 70789297f6019ae0bd010cf4bc2d75bfcacca572
- Waiting for: Human to rotate key in GCP Console
- Next: Deploy functions, add to .gitignore, purge history

**Task 10 Updated:** YOLO Local + Incremental Tagging
- Changed from Google Cloud Vision ($60 cost) to Local YOLO ($0)
- Incremental: Only tag files with needs_tagging: true
- Initial batch (8000 files) + ongoing (only new files)
