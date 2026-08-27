// Shared by authorizeDrivePreviews.cjs (one-time consent) and
// scannerLocalPreview.cjs (actual uploads). Uses drive.file scope — the
// narrowest scope that can create folders/files in the user's Drive — so
// this never requests broad read/write access to the account's existing
// files.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CLIENT_PATH = path.join(__dirname, '..', 'functions/config/driveOAuthClient.json');
const TOKEN_PATH = path.join(__dirname, '..', 'functions/config/drivePreviewToken.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function loadClientCredentials() {
  if (!fs.existsSync(CLIENT_PATH)) {
    throw new Error(
      `Drive OAuth client not found at ${CLIENT_PATH}\n` +
      'Create a Desktop app OAuth client in Google Cloud Console ' +
      '(project tk-archive-cd9d0 > APIs & Services > Credentials) and save the ' +
      'downloaded JSON there.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  return raw.installed || raw.web;
}

function createOAuth2Client() {
  const { client_id, client_secret, redirect_uris } = loadClientCredentials();
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

// Used only by authorizeDrivePreviews.cjs
function getAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
}

async function saveToken(oAuth2Client, code) {
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

// Used by scannerLocalPreview.cjs for actual uploads.
async function getDriveClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Drive token not found at ${TOKEN_PATH}\n` +
      'Run `node authorizeDrivePreviews.cjs` once first (one-time browser consent).'
    );
  }
  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  return oAuth2Client;
}

module.exports = { createOAuth2Client, getAuthUrl, saveToken, getDriveClient, SCOPES };
