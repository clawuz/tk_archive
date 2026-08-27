#!/usr/bin/env node

// One-time setup: run this once, logged into the Google account whose
// Drive should receive the preview files. Opens a browser for consent,
// catches the redirect on a local loopback server, and saves the resulting
// refresh token to functions/config/drivePreviewToken.json.

const http = require('http');
const { URL } = require('url');
const { createOAuth2Client, getAuthUrl, saveToken } = require('./lib/driveOAuth.cjs');

async function main() {
  const oAuth2Client = createOAuth2Client();
  const redirectUri = new URL(oAuth2Client.redirectUri);
  const port = Number(redirectUri.port) || 80;

  const authUrl = getAuthUrl(oAuth2Client);
  console.log('\nOpen this URL in your browser and approve access:\n');
  console.log(authUrl, '\n');
  console.log(`Waiting for redirect on ${oAuth2Client.redirectUri} ...`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('No code in redirect.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. You can close this tab and return to the terminal.');
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    server.listen(port);
  });

  await saveToken(oAuth2Client, code);
  console.log('\n✅ Saved functions/config/drivePreviewToken.json — future scans will use this token.\n');
}

main().catch((err) => {
  console.error('❌ Authorization failed:', err.message);
  process.exit(1);
});
