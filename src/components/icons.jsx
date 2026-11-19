// Shared line-icon set (~Feather/Tabler style) used across the DAM UI in
// place of emoji — emoji glyphs render inconsistently across OSes/browsers
// and read as dated next to the rest of the app's flat design. Every icon
// uses `currentColor` so it automatically follows whatever text color its
// container sets; default size is 16px but callers can override via props
// (className/style/width/height).

function Base({ children, size = 16, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function XIcon(props) {
  return (
    <Base {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  )
}

export function CloudIcon(props) {
  return (
    <Base {...props}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </Base>
  )
}

export function FolderIcon(props) {
  return (
    <Base {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </Base>
  )
}

export function TagIcon(props) {
  return (
    <Base {...props}>
      <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.29-8.29a1 1 0 0 0 0-1.41L12 2z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </Base>
  )
}

export function CalendarIcon(props) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Base>
  )
}

export function SparklesIcon(props) {
  return (
    <Base {...props}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 15l.7 1.9L21.6 17.6l-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" />
    </Base>
  )
}

export function ScaleIcon(props) {
  return (
    <Base {...props}>
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M5 8l-3 6a3.5 3.5 0 0 0 6 0z" />
      <path d="M19 8l-3 6a3.5 3.5 0 0 0 6 0z" />
      <line x1="6" y1="21" x2="18" y2="21" />
      <path d="M12 3l7 5M12 3l-7 5" />
    </Base>
  )
}

export function HourglassIcon(props) {
  return (
    <Base {...props}>
      <path d="M6 2h12M6 22h12" />
      <path d="M6 2v5a6 6 0 0 0 12 0V2M6 22v-5a6 6 0 0 1 12 0v5" />
    </Base>
  )
}

export function ImageIcon(props) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Base>
  )
}

export function FilmIcon(props) {
  return (
    <Base {...props}>
      <rect x="2.5" y="3" width="19" height="18" rx="2" />
      <line x1="7" y1="3" x2="7" y2="21" />
      <line x1="17" y1="3" x2="17" y2="21" />
      <line x1="2.5" y1="8" x2="7" y2="8" />
      <line x1="2.5" y1="16" x2="7" y2="16" />
      <line x1="17" y1="8" x2="21.5" y2="8" />
      <line x1="17" y1="16" x2="21.5" y2="16" />
    </Base>
  )
}

export function FileIcon(props) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Base>
  )
}

export function PackageIcon(props) {
  return (
    <Base {...props}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </Base>
  )
}

export function ClipboardIcon(props) {
  return (
    <Base {...props}>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
    </Base>
  )
}

export function CheckIcon(props) {
  return (
    <Base {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Base>
  )
}

export function AlertTriangleIcon(props) {
  return (
    <Base {...props}>
      <path d="M12 3l10 18H2z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="12" y1="17.5" x2="12" y2="17.5" />
    </Base>
  )
}

export function StarIcon({ filled, ...props }) {
  return (
    <Base {...props} fill={filled ? 'currentColor' : 'none'}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </Base>
  )
}

export function ClockIcon(props) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </Base>
  )
}

export function GridIcon(props) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Base>
  )
}

export function ListIcon(props) {
  return (
    <Base {...props}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3" y2="6" />
      <line x1="3" y1="12" x2="3" y2="12" />
      <line x1="3" y1="18" x2="3" y2="18" />
    </Base>
  )
}

export function BarChartIcon(props) {
  return (
    <Base {...props}>
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </Base>
  )
}

export function MapPinIcon(props) {
  return (
    <Base {...props}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </Base>
  )
}

export function LightbulbIcon(props) {
  return (
    <Base {...props}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 2z" />
    </Base>
  )
}

export function EyeIcon(props) {
  return (
    <Base {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  )
}

export function DownloadIcon(props) {
  return (
    <Base {...props}>
      <path d="M12 3v12" />
      <polyline points="7 11 12 16 17 11" />
      <path d="M5 21h14" />
    </Base>
  )
}

export function PencilIcon(props) {
  return (
    <Base {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Base>
  )
}

export function LogInIcon(props) {
  return (
    <Base {...props}>
      <path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </Base>
  )
}

export function LogOutIcon(props) {
  return (
    <Base {...props}>
      <path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <polyline points="15 17 20 12 15 7" />
      <line x1="20" y1="12" x2="7" y2="12" />
    </Base>
  )
}

export function UsersIcon(props) {
  return (
    <Base {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Base>
  )
}

export function TrashIcon(props) {
  return (
    <Base {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Base>
  )
}

export function PlusIcon(props) {
  return (
    <Base {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Base>
  )
}
