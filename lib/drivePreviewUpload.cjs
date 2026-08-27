// Mirrors a file's path (relative to the TRIBAL share root) into a
// "TK Archive Previews/..." folder tree in the target Drive, creating
// folders on demand, then uploads the preview file into the deepest one.
// Folder lookups are cached in-process so a batch run doesn't re-query
// Drive for the same folder path once per file in it.

const fs = require('fs');
const { google } = require('googleapis');

const ROOT_FOLDER_NAME = 'TK Archive Previews';
const folderIdCache = new Map(); // key: parentId + '/' + name

async function findOrCreateFolder(drive, parentId, name) {
  const cacheKey = `${parentId}/${name}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey);

  const promise = (async () => {
    const escapedName = name.replace(/'/g, "\\'");
    const q = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const list = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });

    if (list.data.files.length > 0) {
      return list.data.files[0].id;
    }
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    return created.data.id;
  })();

  folderIdCache.set(cacheKey, promise);
  // Evict on failure so a transient API error doesn't poison this cache key
  // (and everything under it) for the rest of the run — a later call can
  // retry instead of inheriting the same stale rejection forever. This
  // catch is only for cache cleanup; the promise returned below is
  // unchanged, so the original rejection still propagates to the caller.
  promise.catch(() => folderIdCache.delete(cacheKey));
  return promise;
}

async function ensureFolderPath(drive, segments) {
  let parentId = 'root';
  for (const segment of segments) {
    parentId = await findOrCreateFolder(drive, parentId, segment);
  }
  return parentId;
}

// shareRelativeDir: e.g. "THY/ACCOUNT/2026/TK_STOCK" (no leading/trailing slash)
async function uploadPreview(oAuth2Client, { shareRelativeDir, fileName, localFilePath, description }) {
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  const segments = [ROOT_FOLDER_NAME, ...shareRelativeDir.split('/').filter(Boolean)];
  const parentId = await ensureFolderPath(drive, segments);

  // fs.createReadStream emits 'error' asynchronously (e.g. the file
  // disappears, or an SMB read drops mid-stream) — if nothing has consumed
  // the stream yet when that fires, it's an unhandled EventEmitter error
  // and crashes the whole Node process, taking down the entire batch over
  // one flaky file. Racing an explicit listener against the upload call
  // turns that into a normal, catchable rejection instead.
  const body = fs.createReadStream(localFilePath);
  const streamError = new Promise((_, reject) => {
    body.on('error', reject);
  });

  const uploadPromise = drive.files.create({
    requestBody: { name: fileName, parents: [parentId], description },
    media: { mimeType: 'video/mp4', body },
    fields: 'id',
  });

  const created = await Promise.race([uploadPromise, streamError]);
  return created.data.id;
}

module.exports = { uploadPreview };
