const functions = require('firebase-functions');
const fs = require('fs');
const path = require('path');

const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes'
];

function validatePath(filePath) {
  const normalized = path.normalize(filePath);
  return ALLOWED_PATHS.some(basePath => normalized.startsWith(basePath));
}

exports.download = functions.https.onRequest((req, res) => {
  try {
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
