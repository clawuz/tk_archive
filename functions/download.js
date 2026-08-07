const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes/ArchiveStorage'
];

function validatePath(filePath) {
  try {
    const realPath = fs.realpathSync(filePath); // Resolves symlinks

    return ALLOWED_PATHS.some(basePath => {
      const realBase = fs.realpathSync(basePath);
      // Check if realPath is exactly under basePath (not just prefix match)
      return realPath === realBase ||
             realPath.startsWith(realBase + path.sep);
    });
  } catch (err) {
    return false; // File doesn't exist or symlink broken
  }
}

exports.download = functions.https.onRequest(async (req, res) => {
  try {
    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(403).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    // User authenticated - continue with download logic
    const { fileId, path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    if (!validatePath(decodeURIComponent(filePath))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const decodedPath = decodeURIComponent(filePath);

    if (!fs.existsSync(decodedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(decodedPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(decodedPath)}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const stream = fs.createReadStream(decodedPath);
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});
