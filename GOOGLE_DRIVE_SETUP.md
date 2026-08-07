# Google Drive Scanner Setup

## Prerequisites

1. Google Cloud Project
2. Google Drive API enabled
3. OAuth 2.0 credentials
4. Node.js 18+

## Setup Steps

### 1. Create Google Cloud Project

```bash
# Go to Google Cloud Console
# https://console.cloud.google.com

# Create new project "TK Archive"
# Enable Google Drive API
```

### 2. Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select "TK Archive" project
3. APIs & Services > Credentials
4. Create OAuth 2.0 Desktop Application
5. Download JSON credentials
6. Save as: `functions/config/drive-credentials.json`

### 3. Authenticate Once

```bash
# First time only - opens browser for OAuth consent
npm run scan:drive:auth

# This creates `functions/config/drive-token.json`
# Token is reused for subsequent scans
```

### 4. Scan Google Drive

```bash
# Scan root (My Drive)
npm run scan:drive

# Scan specific folder
npm run scan:drive "FOLDER_ID" "Folder Name"

# Example:
npm run scan:drive "1aBc2DeF3GhI4JkL5MnO6PqR" "Campaign Assets"
```

## Finding Folder ID

1. Open Google Drive folder in browser
2. URL: `https://drive.google.com/drive/folders/FOLDER_ID`
3. Copy `FOLDER_ID` part

Example:
```
https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j
                                       ↑
                              Folder ID: 1a2b3c4d5e6f7g8h9i0j
```

## Output

Scanner will:
1. Create scan document in Firestore
2. Recursively list Google Drive files
3. Store file metadata in Firestore `files` collection
4. Update scan results with total count & size

Example output:
```
📂 Scanning Google Drive folder: Campaign Assets
🔄 Folder ID: 1a2b3c4d5e6f7g8h9i0j

✅ Created scan: QasM0rLSZEhPXpUG6OTU

🔍 Scanning Google Drive...
.................................................
📁 Found 234 files

💾 Writing to Firestore...
  Batch 1: 500 files written
✅ Wrote 234 total files to Firestore

✨ Scan completed!
⏱️  Duration: 8s
📊 Total files: 234
💾 Total size: 15.2 GB
```

## Features

- ✅ OAuth 2.0 authentication
- ✅ Recursive folder scanning
- ✅ File metadata extraction
- ✅ Thumbnail links
- ✅ Batch Firestore writes
- ✅ Error handling & reporting
- ✅ Progress logging

## Troubleshooting

**Error: Token not found**
- Run: `npm run scan:drive:auth` first
- This creates `functions/config/drive-token.json`

**Error: Credentials not found**
- Download OAuth credentials from Google Cloud Console
- Save to: `functions/config/drive-credentials.json`

**Permission denied**
- Check Google Drive API is enabled in Cloud Console
- Check OAuth scopes include Drive API
- Ensure user has access to Drive folder

**Rate limiting**
- Google Drive API has rate limits
- Scanner handles pagination automatically
- Reduce batch size if needed

## Security Notes

- OAuth tokens stored locally (not committed to git)
- `.gitignore` excludes credential files
- Use service account for production automation
- Never commit credentials to repository
