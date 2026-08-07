# Task 4: Folder Browser and Navigation

## Overview
Build a breadcrumb navigation component that allows users to navigate the filesystem folder structure for local files. Clicking folder names navigates to that folder; a back button goes to parent directory.

## Files to Create/Modify

- **Create:** `src/components/dam/FolderBrowser.jsx` — breadcrumb navigation component
- **Modify:** `src/components/dam/FileDetail.jsx:1-20` — add import
- **Modify:** `src/components/dam/FileDetail.jsx:30-45` — add breadcrumb section

## Interfaces

**Consumes:**
- `DAMFile` type with: `path`, `source`
- `getParentDirectory(filePath: string)` → `string | null` from pathResolver service (Task 3)

**Produces:**
- `FolderBrowser` React component: `<FolderBrowser file={file} onNavigate={callback} />`

## Acceptance Criteria

- [ ] Shows breadcrumb trail for current file path (local files only)
- [ ] Each folder name is clickable and navigates to that folder
- [ ] Back button (↑) navigates to parent directory
- [ ] Google Drive files: component renders nothing (silent)
- [ ] Breadcrumb styling: subtle text color, hover underline
- [ ] Dark mode support
- [ ] Build runs with no TypeScript errors
- [ ] Integrates with FileDetail without breaking existing UI

## Implementation Steps

### Step 1: Write FolderBrowser component

**Create `src/components/dam/FolderBrowser.jsx`:**

```jsx
import { useMemo } from 'react';
import { getParentDirectory } from '../../services/pathResolver';

export default function FolderBrowser({ file, onNavigate }) {
  if (file?.source !== 'local') return null;

  const filePath = file?.path || '';

  const breadcrumbs = useMemo(() => {
    const parts = filePath.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: '/' + parts.slice(0, index + 1).join('/')
    }));
  }, [filePath]);

  const handleNavigateToParent = () => {
    const parent = getParentDirectory(filePath);
    if (parent) {
      onNavigate?.(parent);
    }
  };

  const handleNavigateTo = (path) => {
    onNavigate?.(path);
  };

  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1 flex-wrap">
      <button
        onClick={handleNavigateToParent}
        className="hover:text-slate-900 dark:hover:text-slate-200 transition"
        title="Parent directory"
      >
        ↑
      </button>

      {breadcrumbs.map((crumb, index) => (
        <div key={index} className="flex items-center gap-1">
          <span>/</span>
          <button
            onClick={() => handleNavigateTo(crumb.path)}
            className="hover:text-slate-900 dark:hover:text-slate-200 hover:underline transition"
          >
            {crumb.label}
          </button>
        </div>
      ))}
    </div>
  );
}
```

**Verify:** `npm run build` — expect no errors
**Commit:** `git add src/components/dam/FolderBrowser.jsx && git commit -m "feat: folder breadcrumb navigation component"`

### Step 2: Integrate FolderBrowser into FileDetail

**Modify `src/components/dam/FileDetail.jsx`:**
1. Add import at top: `import FolderBrowser from './FolderBrowser';`
2. Find the file header/title section
3. Add breadcrumb after file name (before metadata):
   ```jsx
   <FolderBrowser file={selectedFile} onNavigate={handleFolderNavigate} />
   ```
   Where `handleFolderNavigate` is a handler that filters FileGallery to show files in that folder
   (or searches for files matching the parent path)

**Verify:** `npm run build && npm run preview`
- Expected: Select local file → breadcrumb shows folder path
- Click folder name → (navigation behavior depends on FileDetail implementation)
- Click ↑ → navigate to parent
- Select Google Drive file → no breadcrumb shown

**Commit:** `git add src/components/dam/FileDetail.jsx && git commit -m "feat: integrate folder breadcrumb navigation into file detail"`

## Testing Checklist

- [ ] All 1 file created, 1 file modified without conflicts
- [ ] `npm run build` runs with 0 TypeScript errors
- [ ] `npm run preview` opens without errors
- [ ] Select local file → breadcrumb displays with correct path
- [ ] Click folder in breadcrumb → `onNavigate` callback fires with correct path
- [ ] Click ↑ button → navigates to parent directory
- [ ] Path with 5+ folders → breadcrumb wraps across multiple lines (flex-wrap)
- [ ] Select Google Drive file → no breadcrumb shown
- [ ] Dark mode: folder names visible, hover color correct

## Notes

- The `onNavigate` callback is passed the folder path. The parent component (FileDetail) decides what to do with it — typically filtering the file gallery or triggering a search.
- The breadcrumb is read-only navigation; it doesn't create or delete folders.
- Paths are split by `/` so Windows paths may not display correctly. This is acceptable since the scanner primarily uses Unix paths.
- The component uses `useMemo` to avoid recalculating breadcrumbs on every render.
- Styling uses Tailwind's hover and transition utilities for smooth interactions.

## Future Improvements (not in scope)

- Double-click file in FileGallery to enter folder
- Back/Forward browser buttons
- Folder history sidebar
