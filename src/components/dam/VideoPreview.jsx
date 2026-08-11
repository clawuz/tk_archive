import { useState, useEffect } from 'react';
import { canStream, getStreamUrl, getFileSize, isFileTooLarge } from '../../services/streamingService';

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

  useEffect(() => {
    if (!file) return;

    try {
      if (!canStream(file)) {
        setCanPreview(false);
        return;
      }

      // Drive's own viewer streams the file — our bandwidth is never in the
      // loop, so the local size cap doesn't apply there.
      if (file.source !== 'drive' && isFileTooLarge(file.size)) {
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

  if (!file || (!canPreview && !error)) return null;

  const driveAspectRatio =
    file.videoWidth && file.videoHeight
      ? `${file.videoWidth} / ${file.videoHeight}`
      : DEFAULT_ASPECT_RATIO;

  return (
    // max-w-md caps how wide (and, via aspect-ratio, how tall) the box can
    // grow even in the wider column a video detail view gets — otherwise a
    // portrait video in a wide column would scale to an enormous height.
    // Below that cap the box still shrinks to fit narrower containers.
    <div className="bg-black rounded-lg overflow-hidden mb-4 max-w-md mx-auto">
      {error ? (
        <div className="h-96 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white">
          <div className="text-center">
            <p className="text-lg mb-2">⚠️ {error}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Size: {getFileSize(file.size)}</p>
          </div>
        </div>
      ) : file.source === 'drive' ? (
        // Google Drive's own embeddable viewer lays out its header/controls
        // chrome assuming the box matches the video's real orientation — a
        // portrait (9:16-ish) video squeezed into a 16:9 box came out
        // letterboxed with cut-off controls. file.videoWidth/videoHeight
        // come from Drive's own metadata (scannerDrive.cjs), no download
        // needed, so the box always matches the actual video shape.
        <div className="w-full" style={{ aspectRatio: driveAspectRatio }}>
          <iframe
            src={streamUrl}
            title={file.name}
            className="w-full h-full"
            allowFullScreen
          />
        </div>
      ) : (
        // Local file, served from our Cloud Storage bucket (streamingService.ts).
        // Real orientation isn't known until the browser reports it via
        // onLoadedMetadata, so the box starts at 16:9 and corrects itself
        // once the video's actual dimensions are available.
        <video
          src={streamUrl}
          controls
          className="w-full bg-black"
          style={{ aspectRatio: localAspectRatio }}
          controlsList="nodownload"
          onLoadedMetadata={(e) => {
            const { videoWidth, videoHeight } = e.currentTarget;
            if (videoWidth && videoHeight) setLocalAspectRatio(`${videoWidth} / ${videoHeight}`);
          }}
          onError={() => setError('Video oynatılamadı. Dosya bozuk olabilir veya tarayıcı bu codec\'i desteklemiyor olabilir.')}
        />
      )}

      {/* Video info */}
      <div className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white p-3 text-sm">
        <p className="font-mono text-xs text-slate-600 dark:text-slate-400">{file.mimeType}</p>
        <p className="text-slate-700 dark:text-slate-300">Size: {getFileSize(file.size)}</p>
      </div>
    </div>
  );
}
