import { useState, useEffect } from 'react';
import { canStream, getStreamUrl, getFileSize, isFileTooLarge } from '../../services/streamingService';
import { AlertTriangleIcon } from '../icons';
import damService from '../../services/damService';

// Falls back to 16:9 only when the real orientation isn't known yet (older
// Drive scans predating videoWidth/videoHeight, or a local file before its
// <video> element has reported loadedmetadata) — never a fixed guess once
// the real dimensions are available.
const DEFAULT_ASPECT_RATIO = '16 / 9';

export default function VideoPreview({ file }) {
  const [canPreview, setCanPreview] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState(null);
  // Local files: the real orientation is only known once the browser's own
  // <video> element loads metadata, since we never probe local files ahead
  // of time. Drive files know it upfront from file.videoWidth/videoHeight
  // (Drive's own metadata, fetched at scan time — see scannerDrive.cjs).
  const [localAspectRatio, setLocalAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  // Drive files scanned by scannerDrive.cjs carry real videoWidth/videoHeight
  // up front. A local file's Drive-hosted preview (scannerLocalPreview.cjs)
  // never gets that metadata; the extracted preview frame is the same shape
  // as the source video, so it's a reliable stand-in for the box's ratio on
  // desktop/tablet, where the iframe embed is still used (see isMobile).
  const [driveAspectRatio, setDriveAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  // The Drive /preview iframe's own overlay controls double up with the
  // underlying native <video>'s controls specifically on mobile WebKit —
  // unusable there, but fine on desktop/tablet where it keeps the richer
  // inline-preview experience instead of bouncing out to a new tab.
  const [isMobile, setIsMobile] = useState(false);
  // Light-scanned local videos aren't in the streaming bucket yet — the
  // viewer asks for an upload (enrich.cjs on the Mac does it) and we watch
  // the doc until videoUploaded flips.
  const [uploadAsked, setUploadAsked] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);

  useEffect(() => {
    setUploadAsked(false);
    setUploadDone(false);
    setUploadErr(null);
  }, [file?.fileId]);

  const needsUpload =
    !!file &&
    file.source === 'local' &&
    !file.driveFileId &&
    file.mimeType?.startsWith('video/') &&
    file.videoUploaded === false &&
    !uploadDone;
  const uploading = needsUpload && (uploadAsked || file.upload_requested === true);

  useEffect(() => {
    if (!needsUpload || !uploading) return;
    return damService.watchFile(file.fileId, (d) => {
      if (d.videoUploaded) {
        setUploadDone(true);
      } else if (!d.upload_requested && d.uploadError) {
        setUploadErr(d.uploadError);
        setUploadAsked(false);
      }
    });
  }, [needsUpload, uploading, file?.fileId]);

  async function handleRequestUpload() {
    setUploadErr(null);
    setUploadAsked(true);
    try {
      await damService.requestVideoUpload(file.fileId);
    } catch (e) {
      setUploadAsked(false);
      setUploadErr('İstek gönderilemedi: ' + (e.message || e));
    }
  }

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!file) return;

    if (file.videoWidth && file.videoHeight) {
      setDriveAspectRatio(`${file.videoWidth} / ${file.videoHeight}`);
    } else {
      const frame = file.videoPreviewFrames?.[0]?.frameData;
      if (frame) {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight) {
            setDriveAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
          }
        };
        img.onerror = () => setDriveAspectRatio(DEFAULT_ASPECT_RATIO);
        img.src = `data:image/jpeg;base64,${frame}`;
      } else {
        setDriveAspectRatio(DEFAULT_ASPECT_RATIO);
      }
    }

    try {
      if (!canStream(file)) {
        setCanPreview(false);
        return;
      }

      // Drive's own viewer streams the file — our bandwidth is never in the
      // loop, so the local size cap doesn't apply there. Gate on driveFileId
      // (not file.source) since local files with a Drive-hosted preview
      // (scannerLocalPreview.cjs) also stream from Drive and file.size still
      // reflects the multi-GB original, not the small preview.
      if (!file.driveFileId && isFileTooLarge(file.size)) {
        setError(`File too large (${getFileSize(file.size)}). Download to play locally.`);
        setCanPreview(false);
        return;
      }

      const url = getStreamUrl(file);
      setStreamUrl(url);
      setCanPreview(true);
      setError(null);
      setLocalAspectRatio(DEFAULT_ASPECT_RATIO);
    } catch (err) {
      setError('Unable to preview this video');
      console.error('VideoPreview error:', err);
    }
  }, [file]);

  if (needsUpload && !error && !isFileTooLarge(file.size)) {
    const poster = file.videoPreviewFrames?.[0]?.frameData;
    return (
      <div className="bg-black rounded-lg overflow-hidden mb-4">
        <div
          className="relative w-full aspect-video flex items-center justify-center"
          style={
            poster
              ? { backgroundImage: `url(data:image/jpeg;base64,${poster})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative text-center text-white px-4">
            {uploading ? (
              <>
                <p className="text-sm font-medium">Yükleniyor… ({getFileSize(file.size)})</p>
                <p className="text-xs text-white/70 mt-1">Dosya sunucudan kopyalanıyor, birkaç dakika sürebilir. Bitince burada otomatik açılır.</p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleRequestUpload}
                  className="px-4 py-2 rounded-lg bg-white/90 text-slate-900 text-sm font-medium hover:bg-white transition"
                >
                  Oynatmak için yükle
                </button>
                <p className="text-xs text-white/70 mt-2">Bu video henüz akış için hazır değil ({getFileSize(file.size)}).</p>
              </>
            )}
            {uploadErr && <p className="text-xs text-red-300 mt-2">{uploadErr}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!file || (!canPreview && !error)) return null;

  // Drive embed vs. local <video> is decided by whether a Drive-hosted
  // preview exists, not by file.source — local files scanned by
  // scannerLocalPreview.cjs also have source: 'local' but stream from
  // Drive's embed viewer via their driveFileId.
  const isDriveEmbed = !!file.driveFileId;

  return (
    // Width comes entirely from the surrounding layout: the narrow
    // FileDetail sidebar for local videos (native controls scale fine at
    // any width), or the lightbox's max-w-4xl for Drive videos (routed
    // there instead of rendering inline — see isDriveVideo in
    // FileDetail.jsx, since Drive's embedded controls need real width).
    <div className="bg-black rounded-lg overflow-hidden mb-4">
      {error ? (
        <div className="h-96 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white">
          <div className="text-center">
            <p className="text-lg mb-2 flex items-center justify-center gap-2"><AlertTriangleIcon size={20} /> {error}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Size: {getFileSize(file.size)}</p>
          </div>
        </div>
      ) : isDriveEmbed && !isMobile ? (
        // Google Drive's own embeddable viewer lays out its header/controls
        // chrome assuming the box matches the video's real orientation — a
        // portrait video squeezed into a 16:9 box came out letterboxed.
        // driveAspectRatio comes from file.videoWidth/videoHeight when
        // available (scannerDrive.cjs), otherwise the extracted preview
        // frame's own pixel shape (see the effect above).
        //
        // The aspect-ratio has to live on this wrapper, not the iframe:
        // an <iframe> is a replaced element that doesn't reliably resolve
        // `aspect-ratio` against `width/height: auto` the way a normal box
        // does — it fell back to the browser's intrinsic ~300px default
        // instead. Setting the ratio here and letting the iframe fill
        // 100%/100% of it is the sizing that actually holds.
        <div
          className="w-full mx-auto"
          style={{ aspectRatio: driveAspectRatio, maxWidth: '100%', maxHeight: '80vh' }}
        >
          <iframe
            src={streamUrl}
            title={file.name}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            allowFullScreen
          />
        </div>
      ) : isDriveEmbed ? (
        // Mobile-only fallback: Drive's /preview iframe layers its own
        // overlay controls on top of the underlying native <video>
        // element's own controls — on mobile WebKit that showed up as two
        // half-visible, misaligned control bars (one stuck at the top,
        // one fading in and out mid-video), unusable for actually
        // pausing/seeking. Neither matching the box to the real aspect
        // ratio nor shrinking the box changed it, because it isn't a
        // sizing problem — it's Drive's own cross-origin content, which
        // isn't ours to restyle. Desktop/tablet don't show this behavior,
        // so they keep the inline iframe above. Opening Drive's real /view
        // page in a new tab instead runs its player in the environment it
        // was actually built for, sidestepping the embedding problem
        // entirely.
        <button
          type="button"
          onClick={() =>
            window.open(`https://drive.google.com/file/d/${file.driveFileId}/view`, '_blank', 'noopener,noreferrer')
          }
          className="relative w-full aspect-video flex items-center justify-center group"
          style={
            file.videoPreviewFrames?.[0]?.frameData
              ? {
                  backgroundImage: `url(data:image/jpeg;base64,${file.videoPreviewFrames[0].frameData})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition" />
          <span className="relative flex flex-col items-center gap-2 text-white">
            <span className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-105 transition">
              <svg className="w-6 h-6 text-slate-900 ml-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 4l12 6-12 6V4z" />
              </svg>
            </span>
            <span className="text-sm font-medium">Drive'da izle</span>
          </span>
        </button>
      ) : (
        // Local file, served from our Cloud Storage bucket (streamingService.ts).
        // Real orientation isn't known until the browser reports it via
        // onLoadedMetadata, so the box starts at 16:9 and corrects itself
        // once the video's actual dimensions are available.
        //
        // w-full (fill the container's width unconditionally) was wrong
        // for a portrait video: aspect-ratio was already set correctly
        // (e.g. "2160 / 3840"), but forcing full width made the computed
        // height far taller than the lightbox's max-h-[90vh], and that
        // wrapper's overflow-hidden then clipped the excess — the video
        // was rendered oversized and cropped, not actually "not fitting".
        // max-w-full + max-height (no forced width) lets the browser pick
        // whichever dimension is actually the binding constraint: width
        // for landscape video, height for portrait — both fit on screen
        // with nothing clipped. Real example (2026-10-02): DSC_3865.MOV,
        // a 2160x3840 portrait video, showed as a zoomed-in crop until
        // this changed.
        <video
          src={streamUrl}
          controls
          className="max-w-full bg-black mx-auto block"
          style={{ aspectRatio: localAspectRatio, maxHeight: '80vh' }}
          controlsList="nodownload"
          onLoadedMetadata={(e) => {
            const { videoWidth, videoHeight } = e.currentTarget;
            if (videoWidth && videoHeight) setLocalAspectRatio(`${videoWidth} / ${videoHeight}`);
          }}
          onError={() => setError('Video oynatılamadı. Dosya bozuk olabilir veya tarayıcı bu codec\'i desteklemiyor olabilir.')}
        />
      )}
    </div>
  );
}
