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

  const escapedName = name.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });

  let folderId;
  if (list.data.files.length > 0) {
    folderId = list.data.files[0].id;
  } else {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    folderId = created.data.id;
  }

  folderIdCache.set(cacheKey, folderId);
  return folderId;
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

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId], description },
    media: { mimeType: 'video/mp4', body: fs.createReadStream(localFilePath) },
    fields: 'id',
  });

  return created.data.id;
}

module.exports = { uploadPreview };
