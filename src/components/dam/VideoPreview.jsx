import { useState, useEffect } from 'react';
import { canStream, getStreamUrl, getFileSize, isFileTooLarge } from '../../services/streamingService';

export default function VideoPreview({ file }) {
  const [canPreview, setCanPreview] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState(null);

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
    } catch (err) {
      setError('Unable to preview this video');
      console.error('VideoPreview error:', err);
    }
  }, [file]);

  if (!file || (!canPreview && !error)) return null;

  return (
    <div className="bg-black rounded-lg overflow-hidden mb-4">
      {error ? (
        <div className="h-96 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white">
          <div className="text-center">
            <p className="text-lg mb-2">⚠️ {error}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">Size: {getFileSize(file.size)}</p>
          </div>
        </div>
      ) : file.source === 'drive' ? (
        // Google Drive's own embeddable viewer — no download/re-upload.
        <iframe
          src={streamUrl}
          title={file.name}
          className="w-full h-96"
          allowFullScreen
        />
      ) : (
        // Local file, served from our Cloud Storage bucket (streamingService.ts).
        <video
          src={streamUrl}
          controls
          className="w-full h-96 bg-black"
          controlsList="nodownload"
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
