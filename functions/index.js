const functions = require('firebase-functions');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const { google } = require('googleapis');
const admin = require('firebase-admin');

admin.initializeApp();
const firestore = admin.firestore();

const app = express();
const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
];

const BASE_URL = process.env.BASE_URL || `https://${process.env.GCLOUD_PROJECT}.web.app`;
const SESSION_SECRET = process.env.SESSION_KEY || 'tk-secret-key';

app.use(express.json());
app.use(cors({ origin: true }));
app.use(cookieSession({
  name: 'tk-archive-session',
  keys: [SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000
}));

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

  (file.parents || []).forEach((parent) => {
    if (parent) tags.add(parent);
  });
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
    tags: buildTags(file)
  };
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/api/auth/google/callback`
);

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

app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Kodu bulamadık.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Google kimlik doğrulama sırasında hata oluştu.');
  }
});

async function saveFiles(files) {
  const collection = firestore.collection('files');
  const batches = [];
  let batch = firestore.batch();
  let counter = 0;

  for (const file of files) {
    const ref = collection.doc(file.id);
    batch.set(ref, file, { merge: true });
    counter += 1;

    if (counter === 500) {
      batches.push(batch.commit());
      batch = firestore.batch();
      counter = 0;
    }
  }

  if (counter > 0) {
    batches.push(batch.commit());
  }

  await Promise.all(batches);
}

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

    const indexed = files.map(serializeFile);
    await saveFiles(indexed);

    res.json({ message: 'Drive tarandı ve indekslendi.', total: indexed.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Drive tarama sırasında hata oluştu.' });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const snapshot = await firestore.collection('files').get();
    const files = snapshot.docs.map((doc) => doc.data());
    res.json(files);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Dosyalar alınırken hata oluştu.' });
  }
});

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();

  try {
    const snapshot = await firestore.collection('files').get();
    const files = snapshot.docs.map((doc) => doc.data());
    if (!query) {
      return res.json(files);
    }

    const result = files.filter((item) => {
      const haystack = [item.name, item.mimeType, ...(item.tags || [])].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Arama sırasında hata oluştu.' });
  }
});

app.post('/api/tags', async (req, res) => {
  const { id, tags } = req.body;
  if (!id || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'id ve tags gereklidir.' });
  }

  try {
    const ref = firestore.collection('files').doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: 'Dosya bulunamadı.' });
    }

    const existing = snapshot.data();
    const mergedTags = Array.from(new Set([...(existing.tags || []), ...tags.map((t) => t.trim()).filter(Boolean)]));
    await ref.update({ tags: mergedTags });
    res.json({ message: 'Etiketler kaydedildi.', item: { ...existing, tags: mergedTags } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Etiket kaydı sırasında hata oluştu.' });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const snapshot = await firestore.collection('files').get();
    res.json({ fileCount: snapshot.size, authenticated: !!(req.session && req.session.tokens) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Durum alınırken hata oluştu.' });
  }
});

exports.api = functions.https.onRequest(app);
