import { useState, useEffect, useRef } from 'react';
import { resolveThumbnail } from '../../services/thumbnailService';
import { getFileTypeIcon } from '../../utils/fileIcons';

export default function FileListRow({ file, onSelect, selectable = false, selected = false, onToggleSelect }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(rowRef.current);
        }
      },
      { rootMargin: '200px' }
    );
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    (async () => {
      try {
        setLoading(true);
        const result = await resolveThumbnail(file);
        setThumbnail(result);
        if (!result.url) setError(true);
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
      ref={rowRef}
      onClick={() => onSelect?.(file)}
      className={`flex items-center gap-4 px-3 py-2 bg-white dark:bg-slate-800 border rounded-lg cursor-pointer transition hover:shadow-md ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-500'
          : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700'
      }`}
    >
      {/* Selection checkbox */}
      {selectable && (
        <label
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 flex items-center justify-center w-5 h-5 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(file.fileId)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </label>
      )}

      {/* Thumbnail */}
      <div className="w-14 h-14 flex-shrink-0 rounded overflow-hidden bg-slate-100 dark:bg-slate-700">
        {loading ? (
          <div className="w-full h-full bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-600 animate-pulse" />
        ) : thumbnail?.url && !error ? (
          <img
            src={thumbnail.url}
            alt={file.name}
            className="w-full h-full object-cover"
            onError={() => setError(true)}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${fileIcon.bg}`}>
            <span className="text-xl">{fileIcon.icon}</span>
          </div>
        )}
      </div>

      {/* Name + tags */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-900 dark:text-white truncate">
          {file.name}
        </p>
        {file.tags?.length > 0 && (
          <div className="flex gap-1 mt-1 overflow-hidden">
            {file.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
            {file.tags.length > 4 && (
              <span className="text-[10px] text-slate-400">+{file.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* Source */}
      <div className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 w-20 flex-shrink-0">
        {file.source === 'local' ? '📂 Yerel' : '☁️ Drive'}
      </div>

      {/* Size */}
      <div className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 w-20 flex-shrink-0 text-right">
        {file.sizeFormatted}
      </div>

      {/* Date */}
      <div className="hidden md:block text-xs text-slate-500 dark:text-slate-400 w-24 flex-shrink-0 text-right">
        {file.dateFormatted}
      </div>
    </div>
  );
}
