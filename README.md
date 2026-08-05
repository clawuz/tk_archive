# TK Archive — Digital Asset Management System

Modern Digital Asset Management (DAM) system for 50TB+ ad agency archive. Built with React, Firestore, and Cloud Functions.

## Features

- 📁 **Dual-source archiving**: Local filesystem + Google Drive
- 🔍 **Full-text search** with tag-based filtering
- 🏷️ **Metadata management**: Tags, rights, licenses, copyright info
- 📷 **Thumbnail previews** with lazy loading
- 📊 **Scan history** with change detection
- ⚡ **Incremental scanning** using SHA256 hashing
- 🔐 **Firebase authentication** + Firestore + Cloud Functions
- 🚀 **Production-ready** with CI/CD

## Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Firebase Cloud Functions (Node.js 20)
- **Database**: Firestore (structured metadata)
- **Deployment**: Firebase Hosting

## Development

### Install
```bash
npm install
cd functions && npm install
```

### Run locally
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Deploy
```bash
npm run deploy
```

## Project Structure

```
/src              # React frontend
  /components     # React components
    /dam          # DAM Dashboard + subcomponents
  /services       # Firestore operations
  /types          # TypeScript types
  /auth           # Firebase Auth integration
  /firebase.js    # Firebase SDK config

/functions        # Cloud Functions backend
  /lib            # Shared utilities
  /tests          # Integration tests

/firestore.rules  # Firestore security rules
firebase.json     # Firebase config
```

## Configuration

### Environment Variables

Create `.env.local`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
```

### Firebase Setup

1. Enable Firestore in Firebase Console
2. Set up Google OAuth credentials
3. Configure Cloud Functions environment:
```bash
firebase functions:config:set \
  google.client_id="..." \
  google.client_secret="..." \
  base_url="https://tk-archive-dam.web.app"
```

## Documentation

- [Scanner Infrastructure](docs/scanner/)
- [Firestore Schema](docs/schema.md)
- [Deployment Guide](docs/deployment.md)

---

Built with ❤️ for TK Archive by Claude
