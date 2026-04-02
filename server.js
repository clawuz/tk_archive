import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieSession from 'cookie-session';
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_PATH = path.resolve('./data/db.json');

app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use(cookieSession({
  name: 'tk-archive-session',
  keys: [process.env.SESSION_KEY || 'tk-secret-key'],
  maxAge: 24 * 60 * 60 * 1000
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/google/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];

async function loadDb() {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return { files: [] };
  }
}

async function saveDb(db) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function buildTags(file) {
  const tags = new Set();
  const name = (file.name || '').toLowerCase();
  const mime = file.mimeType || '';

  if (mime.startsWith('image/')) tags.add('görsel');
  if (mime.startsWith('video/')) tags.add('video');
  if (mime === 'application/pdf') tags.add('pdf');
  if (mime.includes('presentation')) tags.add('sunum');
  if (mime.includes('spreadsheet')) tags.add('tablo');
  if (mime.includes('document')) tags.add('dokuman');
  if (mime.includes('psd')) tags.add('psd');
  if (name.includes('business')) tags.add('business');
  if (name.includes('business class')) tags.add('business class');
  if (name.includes('air to air') || name.includes('air-to-air') || name.includes('airtoair')) tags.add('air to air');
  if (name.includes('project') || name.includes('proje')) tags.add('proje');
  if (name.includes('promo') || name.includes('marketing')) tags.add('promo');
  if (name.includes('ticket') || name.includes('boarding')) tags.add('boarding pass');

  const folderNames = (file.parents || []).map(String);
  folderNames.forEach((folder) => tags.add(folder));

  if (file.mimeType === 'application/vnd.google-apps.folder') tags.add('klasor');

  return Array.from(tags).filter(Boolean);
}

function serializeFile(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    thumbnailLink: file.thumbnailLink || file.iconLink || null,
    parents: file.parents || [],
    tags: buildTags(file),
    raw: file
  };
}

function isAuthenticated(req, res, next) {
  if (!req.session || !req.session.tokens) {
    return res.status(401).json({ error: 'Google hesabına bağlanmanız gerekiyor.' });
  }
  next();
}

app.get('/api/auth/url', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.json({ url });
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Kodu bulamadık.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Google kimlik doğrulama sırasında hata oluştu.');
  }
});

app.get('/api/me', (req, res) => {
  const authenticated = !!(req.session && req.session.tokens);
  res.json({ authenticated });
});

app.post('/api/scan', isAuthenticated, async (req, res) => {
  try {
    oauth2Client.setCredentials(req.session.tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const files = [];
    let nextPageToken = null;

    do {
      const response = await drive.files.list({
        pageSize: 500,
        fields: 'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, thumbnailLink, createdTime, modifiedTime, parents)',
        q: "trashed = false",
        pageToken: nextPageToken
      });

      const pageFiles = response.data.files || [];
      files.push(...pageFiles);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    const db = await loadDb();
    const indexed = files.map(serializeFile);
    db.files = indexed;
    await saveDb(db);

    res.json({ message: 'Drive tarandı ve indekslendi.', total: indexed.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Drive tarama sırasında hata oluştu.' });
  }
});

app.get('/api/files', async (req, res) => {
  const db = await loadDb();
  res.json(db.files);
});

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();
  const db = await loadDb();
  if (!query) {
    return res.json(db.files);
  }

  const result = db.files.filter((item) => {
    const haystack = [item.name, item.mimeType, ...(item.tags || [])].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  res.json(result);
});

app.post('/api/tags', async (req, res) => {
  const { id, tags } = req.body;
  if (!id || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'id ve tags gereklidir.' });
  }

  const db = await loadDb();
  const item = db.files.find((file) => file.id === id);
  if (!item) {
    return res.status(404).json({ error: 'Dosya bulunamadı.' });
  }

  item.tags = Array.from(new Set([...(item.tags || []), ...tags.map((t) => t.trim()).filter(Boolean)]));
  await saveDb(db);
  res.json({ message: 'Etiketler kaydedildi.', item });
});

app.get('/api/status', async (req, res) => {
  const db = await loadDb();
  res.json({ fileCount: db.files.length, authenticated: !!(req.session && req.session.tokens) });
});

app.get('*', (req, res) => {
  res.sendFile(path.resolve('public/index.html'));
});

app.listen(PORT, () => {
  console.log(`TK Archive backend çalışıyor: http://localhost:${PORT}`);
});
