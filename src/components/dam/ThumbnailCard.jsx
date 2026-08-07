import { useState, useEffect, useRef } from 'react';
import { resolveThumbnail } from '../../services/thumbnailService';
import { getFileTypeIcon } from '../../utils/fileIcons';

export default function ThumbnailCard({ file, onSelect, className = '' }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const imageRef = useRef(null);

  // Setup Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(imageRef.current);
        }
      },
      { rootMargin: '100px' }
    );

    if (imageRef.current) {
      observer.observe(imageRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Load thumbnail when visible
  useEffect(() => {
    if (!isVisible) return;

    (async () => {
      try {
        setLoading(true);
        const result = await resolveThumbnail(file);
        setThumbnail(result);
        if (!result.url) {
          setError(true);
        }
      } catch (err) {
        console.error('Thumbnail load error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [isVisible, file]);

  const fileIcon = getFileTypeIcon(file.mimeType);

  return (
    <div
      ref={imageRef}
      onClick={() => onSelect?.(file)}
      className={`relative bg-white dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer transition hover:shadow-lg ${className}`}
    >
      {/* Thumbnail or Fallback */}
      {loading ? (
        // Loading skeleton
        <div className="w-full h-48 bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-600 animate-pulse" />
      ) : thumbnail?.url && !error ? (
        <img
          src={thumbnail.url}
          alt={file.name}
          className="w-full h-48 object-cover"
          onError={() => setError(true)}
        />
      ) : (
        // File-type icon fallback
        <div className={`w-full h-48 flex items-center justify-center ${fileIcon.bg}`}>
          <span className="text-5xl">{fileIcon.icon}</span>
        </div>
      )}

      {/* File info overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition p-3 flex flex-col justify-end">
        <p className="text-white font-semibold text-sm truncate">{file.name}</p>
        <p className="text-white/80 text-xs">
          {file.sizeFormatted} • {file.source === 'local' ? '📂 Yerel' : '☁️ Drive'}
        </p>
      </div>
    </div>
  );
}
