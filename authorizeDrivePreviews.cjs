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

  // A Google Cloud Console "Desktop app" OAuth client's redirect_uris is
  // just `http://localhost` with no fixed port (Google validates loopback
  // redirects by host, not exact port, for Desktop clients). So we bind an
  // ephemeral port ourselves, then build the real redirect URI from
  // whatever port the OS assigns, and use that same URI for both the auth
  // URL and the token exchange.
  let redirectUri;
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, redirectUri);
      const code = reqUrl.searchParams.get('code');
      const errorParam = reqUrl.searchParams.get('error');
      if (!code) {
        res.writeHead(400);
        res.end('Authorization failed. You can close this tab.');
        server.close();
        reject(new Error(errorParam || 'No code in redirect.'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. You can close this tab and return to the terminal.');
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    server.listen(0, () => {
      const assignedPort = server.address().port;
      redirectUri = `http://localhost:${assignedPort}`;

      const authUrl = getAuthUrl(oAuth2Client, redirectUri);
      console.log('\nOpen this URL in your browser and approve access:\n');
      console.log(authUrl, '\n');
      console.log(`Waiting for redirect on ${redirectUri} ...`);
    });
  });

  await saveToken(oAuth2Client, code, redirectUri);
  console.log('\n✅ Saved functions/config/drivePreviewToken.json — future scans will use this token.\n');
}

main().catch((err) => {
  console.error('❌ Authorization failed:', err.message);
  process.exit(1);
});
