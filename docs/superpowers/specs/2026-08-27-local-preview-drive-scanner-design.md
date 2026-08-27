# Local Archive Preview + Drive Scanner — Design

## Context

A separate archive location (not yet scanned by TK_Archive) contains roughly
10,000 large raw video files (`.mov`/`.mp4`, multi-GB each) organized in
year-based subfolders on a network-mounted volume. The goal is to make these
files browsable, taggable, and previewable inside the existing TK_Archive DAM
(`tribal-tk-archive.web.app`) without uploading the raw multi-GB originals
anywhere.

This is an **extension of the existing scanning pipeline**, not a new
application. It reuses `lib/autoTags.cjs`, `lib/videoFrames.cjs`, the
`files` Firestore collection, and the Claude Vision tagging Cloud Function
(`functions/tagNewFiles.js`) exactly as `scanner.cjs` and `scannerDrive.cjs`
already do for their respective sources.

## Why not the existing `scanner.cjs` path as-is

`scanner.cjs` currently uploads the **full original video** to a Cloud
Storage bucket (`tk-archive-cd9d0-videos`) so the app can stream it. For
~10,000 multi-GB raw files, doing the same would mean uploading potentially
tens of terabytes — too slow and too large for this archive's storage
budget. Instead, a small transcoded preview is generated locally and only
the preview is uploaded.

## Why Google Drive over Cloud Storage for the preview files

Both were evaluated. Decision: **Google Drive**, using existing Workspace
storage quota (~500GB free at design time), because it has no incremental
per-GB cost, unlike Cloud Storage (~$0.02/GB/month + egress). Accepted
trade-off: Drive has a fixed quota ceiling; if previews approach or exceed
available space, the Workspace plan will be upgraded (e.g. 2TB → 5TB) rather
than switching backends. This was an explicit, informed choice given the
cost comparison — GCS remains the documented fallback in this project if
Drive quota becomes unmanageable and the team doesn't want to upgrade the
plan.

## Scope boundary

This design does **not** modify `scanner.cjs`'s existing behavior for the
`TK-2026` archive (full video → GCS). It adds a new, separate script that
targets the new archive location and follows a different (preview → Drive)
path, sharing common libraries but not the video-upload logic.

---

## Component 1: Local preview generation

- **Input:** A root directory (the new archive's location, containing
  year-based subfolders), passed as a CLI argument — no hardcoded default,
  since this is a one-off archive location distinct from `TK-2026`.
- **File selection:** Recursive scan for `.mov`/`.mp4` (case-insensitive).
  Files already ending in `_preview.mp4` are excluded from being treated as
  scan targets themselves.
- **Transcode command:**
  ```
  ffmpeg -i <original> -vf scale=-2:480 -c:v h264_videotoolbox -b:v 1500k \
         -c:a aac -b:a 96k <same-dir>/<basename>_preview.mp4
  ```
  Full duration preserved (no trimming), hardware-accelerated H.264 via
  VideoToolbox (confirmed available: Apple M2).
- **Resume/idempotency:** Before transcoding, skip if `<basename>_preview.mp4`
  already exists in the same folder. Running the script again after new
  files are added to the archive only processes the new files.
- **Parallelism:** Up to 3 concurrent ffmpeg processes (process pool).
- **Error handling:** A failed transcode (corrupt file, unreadable, etc.) is
  logged and does not stop the batch.
- **Logging:** A CSV log (`preview_log.csv`) records, per file: path,
  outcome (processed/skipped/failed), timestamp, error message if any.

## Component 2: Drive upload and folder mirroring

- **Auth:** Reuses the existing Drive API service-account credentials
  already configured for `scannerDrive.cjs` — no new OAuth setup.
- **Destination structure:** A dedicated root Drive folder (e.g.
  `TK Archive Previews/`) mirrors the local archive's year/subfolder
  structure exactly, e.g. `TK Archive Previews/2023/CampaignX/video_preview.mp4`.
  Folders are created on demand (checked for existence before creating, to
  keep the script re-runnable).
- **Idempotency:** A preview is only uploaded if the corresponding Firestore
  file document does not already have a `previewDriveFileId`. Re-running the
  script does not re-upload existing previews.
- **Traceability:** Each uploaded Drive file's description field is set to
  the original file's full local path, so someone browsing Drive directly
  can identify the source file without opening TK_Archive.

## Component 3: Firestore / TK_Archive integration

- **New script:** `scannerLocalPreview.cjs`, sibling to `scanner.cjs` and
  `scannerDrive.cjs`. Reuses `lib/autoTags.cjs`, `lib/videoFrames.cjs`,
  `lib/searchTokens.cjs` unchanged. Does not modify `scanner.cjs`.
- **Firestore document shape:** Written to the same `files` collection,
  matching the existing schema (`source: 'local'`, `path`, hash, size,
  mimeType, auto-generated tags, search tokens), plus one new field:
  `previewDriveFileId: string`.
- **Frame extraction & tagging:** 5 frames extracted from the **original
  local file** (not the preview) via `lib/videoFrames.cjs`, feeding the
  existing Claude Vision tagging flow (`functions/tagNewFiles.js`)
  unchanged. Folder/filename-derived tags via `lib/autoTags.cjs` unchanged.
- **Playback:** `src/services/streamingService.ts` gains a check: if a file
  document has `previewDriveFileId` set, `getStreamUrl` returns
  `https://drive.google.com/file/d/<previewDriveFileId>/preview` (same
  iframe-embed approach already used for Drive-sourced files), regardless
  of the document's `source` value being `'local'`.
- **Result:** No new UI, no new app. These files appear in the existing
  gallery/search/tag interface at `tribal-tk-archive.web.app` alongside
  everything else, indistinguishable in the UI except that playback comes
  from the Drive-hosted preview instead of a GCS-hosted full copy.

---

## Operational notes

- **Estimated storage:** ~1.6 Mbps blended preview bitrate × mixed
  short/medium average duration ≈ 360–600GB total for ~10,000 previews,
  against ~500GB currently free in Drive. Plan upgrade (2TB → 5TB) is the
  accepted mitigation if this is exceeded.
- **Estimated processing time:** ~10,000 videos × ~5 min average ≈ 833
  hours of source content; at ~4x realtime hardware-encode speed with 3
  parallel jobs, full batch ≈ 2.5–3 days of continuous runtime on the M2
  Mac used for this work.
- **Re-run model:** The script is safe to run repeatedly (idempotent at
  both the local-file and Drive-upload level), supporting an initial batch
  pass followed by periodic re-runs as new files are added to the archive
  over time.

## Out of scope

- Uploading previews to both GCS and Drive (Drive only, per decision above).
- Modifying `scanner.cjs`'s existing TK-2026 behavior.
- A standalone viewer outside of TK_Archive.
- Automatic file-system watching (this is a rerunnable batch script, not a
  daemon).
