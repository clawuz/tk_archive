# TK Archive Scanner Setup

## Local Filesystem Scanning

Scanner, local filesystem'ı tarar ve Firestore'a dosya metadata yazır.

### Prerequisites

1. Firebase project credentials
2. Node.js 18+
3. Local filesystem access

### Setup

#### 1. Service Account Key

Firebase Console'dan service account key indir:

```bash
# Firebase Console > Project Settings > Service Accounts > Generate New Private Key
# File: functions/config/serviceAccountKey.json
```

Dosya yapısı:
```
TK_Archive/
  functions/
    config/
      serviceAccountKey.json  ← buraya koy
```

#### 2. Environment Variable (Alternative)

Service account key file yerine environment variable kullan:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
npm run scan
```

#### 3. Run Scanner

```bash
# Scan /Users/okilavuz/Desktop/Omer/TK-2026 (default path)
npm run scan

# Scan custom path
npm run scan /path/to/archive

# Force rescan (even if files exist)
npm run scan /path/to/archive --force
```

### Output

Scanner will:
1. Create scan document in Firestore
2. Recursively scan all files in directory
3. Calculate SHA256 hash for each file
4. Write file metadata to Firestore `files` collection
5. Update scan document with results

### Features

- ✅ Recursive directory scanning
- ✅ SHA256 hashing for all files
- ✅ MIME type detection
- ✅ Batch Firestore writes (efficient)
- ✅ Error handling & reporting
- ✅ Progress logging

### Example

```bash
$ npm run scan

📂 Scanning: /Users/okilavuz/Desktop/Omer/TK-2026
🔄 Force: false
✅ Created scan: C7x8kL9m0Np
🔍 Scanning directory...
📁 Found 1,247 files
💾 Writing to Firestore...
✅ Wrote 1,247 files to Firestore

✨ Scan completed!
⏱️  Duration: 42s
📊 Total files: 1,247
```

### Troubleshooting

**Error: ENOENT serviceAccountKey.json**
- Download service account key from Firebase Console
- Place in `functions/config/serviceAccountKey.json`
- Or set `GOOGLE_APPLICATION_CREDENTIALS` env var

**Error: Permission denied**
- Check filesystem permissions: `ls -la /path/to/archive`
- Run with appropriate user permissions

**Firestore write fails**
- Check Firestore security rules (should allow writes)
- Check project has Firestore database enabled
