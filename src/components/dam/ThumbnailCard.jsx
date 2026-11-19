import { useState, useEffect, useRef } from 'react';
import { resolveThumbnail } from '../../services/thumbnailService';
import { getFileTypeIcon, getFileTypeBadge } from '../../utils/fileIcons';
import { isFavorite, toggleFavorite } from '../../services/favoritesService';
import { StarIcon, FolderIcon, CloudIcon } from '../icons';

export default function ThumbnailCard({ file, onSelect, className = '', selectable = false, selected = false, onToggleSelect }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [favorite, setFavorite] = useState(() => isFavorite(file.fileId));
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
      className={`relative bg-white dark:bg-slate-800 rounded-lg overflow-hidden border cursor-pointer transition hover:shadow-lg ${
        selected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-slate-200 dark:border-slate-700'
      } ${className}`}
    >
      {/* Selection checkbox */}
      {selectable && (
        <label
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-2 z-10 flex items-center justify-center w-6 h-6 bg-white/90 dark:bg-slate-900/90 rounded shadow"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(file.fileId)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </label>
      )}

      {/* Favorite toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setFavorite(toggleFavorite(file.fileId))
        }}
        title={favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        className="absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 bg-white/90 dark:bg-slate-900/90 rounded-full shadow"
      >
        <span className={favorite ? 'text-red-600' : 'text-slate-400'}>
          <StarIcon filled={favorite} size={16} />
        </span>
      </button>

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
          <fileIcon.Icon size={48} className={fileIcon.color} />
        </div>
      )}

      {/* Type badge — small and always visible, not five buttons stacked on
          the card; brief explicitly wants this over a big colored banner. */}
      <span className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 text-[10px] font-mono font-semibold tracking-wide text-white bg-black/55 rounded">
        {getFileTypeBadge(file.mimeType)}
      </span>

      {/* File info overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition p-3 flex flex-col justify-end">
        <p className="text-white font-semibold text-sm truncate">{file.name}</p>
        <p className="text-white/80 text-xs flex items-center gap-1">
          {file.sizeFormatted} •
          {file.source === 'local' ? <FolderIcon size={12} /> : <CloudIcon size={12} />}
          {file.source === 'local' ? 'Yerel' : 'Drive'}
        </p>
      </div>
    </div>
  );
}
