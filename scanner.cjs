#!/usr/bin/env node

/**
 * TK Archive Local Scanner
 * Scans local filesystem and populates Firestore with file metadata
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

console.log('📦 Loading firebase-admin...');
let admin;
try {
  admin = require('firebase-admin');
  console.log('✅ firebase-admin loaded');
} catch (err) {
  console.error('❌ Failed to load firebase-admin:', err.message);
  process.exit(1);
}

// Initialize Firebase Admin
const keyPath = path.join(__dirname, 'functions/config/serviceAccountKey.json');

if (!fs.existsSync(keyPath)) {
  console.error('❌ Firebase service account key not found!');
  console.error(`\nExpected: ${keyPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'tk-archive-cd9d0'
});

const db = admin.firestore();

// Configuration
const ARCHIVE_ROOT = process.argv[2] || '/Users/okilavuz/Desktop/Omer/TK-2026';
const FORCE_SCAN = process.argv[3] === '--force';

console.log(`📂 Scanning: ${ARCHIVE_ROOT}`);
console.log(`🔄 Force: ${FORCE_SCAN}\n`);

async function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

async function scanDirectory(dirPath, scanId) {
  const files = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip hidden files and system files
      if (entry.name.startsWith('.')) continue;

      try {
        if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          const ext = path.extname(entry.name).toLowerCase().slice(1);

          // Get MIME type (basic)
          const mimeType = getMimeType(ext);

          // Calculate hash
          const hash = await calculateHash(fullPath);

          // Deterministic fileId based on file path — same file always
          // gets the same ID, so re-scans update the existing document
          // instead of creating duplicates.
          const fileId = crypto.createHash('sha256').update(`local:${fullPath}`).digest('hex').slice(0, 32);

          // Extract video frames if video file
          let videoPreviewFrames = null;
          if (isVideoFile(fullPath)) {
            videoPreviewFrames = await extractVideoFrames(fullPath, fileId);
            if (videoPreviewFrames) {
              console.log(`\n✅ Extracted ${videoPreviewFrames.length} frames from ${entry.name}`);
            }
          }

          // Generate a Quick Look thumbnail for images/documents/PDFs
          let thumbnail = null;
          if (!isVideoFile(fullPath) && canGenerateThumbnail(fullPath)) {
            const thumbData = await generateThumbnail(fullPath, fileId);
            if (thumbData) {
              thumbnail = {
                url: `data:image/png;base64,${thumbData}`,
                generated: true,
                generatedAt: Date.now()
              };
            }
          }

          const fileDoc = {
            fileId,
            name: entry.name,
            path: fullPath,
            source: 'local',
            extension: ext,
            mimeType,
            type: mimeType,
            size: stat.size,
            hash,
            tags: [],
            videoPreviewFrames: videoPreviewFrames || null,
            thumbnail: thumbnail || null,
            needs_tagging: !!videoPreviewFrames,
            createdAt: stat.birthtime.getTime(),
            modifiedAt: stat.mtime.getTime(),
            uploadedAt: Date.now(),
            scanId,
            lastScanAt: Date.now(),
            copyright: {
              owner: 'TK',
              year: new Date().getFullYear()
            },
            license: {
              type: 'commercial',
              name: 'Commercial Use'
            },
            status: 'active',
            isDeleted: false
          };

          files.push(fileDoc);
          process.stdout.write('.');
        } else if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subDirFiles = await scanDirectory(fullPath, scanId);
          files.push(...subDirFiles);
        }
      } catch (err) {
        console.error(`\n⚠️  Error processing ${fullPath}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`\n❌ Error reading directory ${dirPath}:`, err.message);
  }

  return files;
}

function getMimeType(ext) {
  const mimeTypes = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    mts: 'video/mp2t',
    m2ts: 'video/mp2t',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    psd: 'image/vnd.adobe.photoshop',
    ai: 'application/postscript',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed'
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'mts', 'm2ts'].includes(ext);
}

// File types macOS Quick Look can render a preview for. Covers images,
// documents, PDFs, and Office files without needing per-format libraries.
const THUMBNAIL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'bmp', 'heic',
  'pdf', 'psd', 'ai', 'eps',
  'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'key', 'numbers',
]);

function canGenerateThumbnail(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return THUMBNAIL_EXTENSIONS.has(ext);
}

async function generateThumbnail(filePath, fileId) {
  const tmpDir = path.join(os.tmpdir(), `thumb-${fileId}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    await execFilePromise('qlmanage', ['-t', '-s', '240', '-o', tmpDir, filePath], { timeout: 15000 });

    const outputFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png'));
    if (outputFiles.length === 0) return null;

    const thumbData = fs.readFileSync(path.join(tmpDir, outputFiles[0])).toString('base64');
    return thumbData;
  } catch (err) {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function getVideoDuration(videoPath) {
  try {
    const cmd = `/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout } = await execPromise(cmd);
    const duration = parseFloat(stdout.trim());
    if (duration > 0) {
      console.log(`  ⏱️  Duration: ${Math.round(duration)}s`);
      return duration;
    }
    return null;
  } catch (err) {
    console.error(`\n⚠️  Could not get duration for ${path.basename(videoPath)}: ${err.message}`);
    return null;
  }
}

async function extractVideoFrames(videoPath, scanId) {
  try {
    if (!isVideoFile(videoPath)) return null;

    const duration = await getVideoDuration(videoPath);
    if (!duration) return null;

    // Extract frames at 10%, 30%, 50%, 70%, 90%
    const timestamps = [
      duration * 0.10,
      duration * 0.30,
      duration * 0.50,
      duration * 0.70,
      duration * 0.90
    ];

    const frames = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const frameFile = `/tmp/frame-${scanId}-${i}.jpg`;

      try {
        await execPromise(
          `ffmpeg -i "${videoPath}" -ss ${timestamp} -vframes 1 -q:v 8 -vf scale=320:-1 "${frameFile}" -y 2>/dev/null`
        );

        const frameData = fs.readFileSync(frameFile, 'base64');
        const frameSizeKB = (frameData.length / 1024).toFixed(2);
        frames.push({
          timestamp: Math.round(timestamp),
          frameData: frameData,
          frameNumber: i + 1
        });
        console.log(`    Frame ${i + 1}: ${frameSizeKB} KB`);

        fs.unlinkSync(frameFile);
      } catch (err) {
        console.error(`⚠️  Frame extraction failed for ${videoPath} at ${timestamp}s`);
      }
    }

    return frames.length > 0 ? frames : null;
  } catch (err) {
    console.error(`⚠️  Error extracting frames from ${videoPath}:`, err.message);
    return null;
  }
}

async function run() {
  const startTime = Date.now();

  try {
    // Create scan document
    const scanRef = db.collection('scans').doc();
    const scanId = scanRef.id;

    await scanRef.set({
      scanId,
      source: 'local',
      archivePath: ARCHIVE_ROOT,
      status: 'running',
      startedAt: admin.firestore.Timestamp.now(),
      userId: 'scanner-cli',
      triggerType: 'manual',
      errors: []
    });

    console.log(`\n✅ Created scan: ${scanId}\n`);

    // Scan directory
    console.log(`🔍 Scanning directory...`);
    const files = await scanDirectory(ARCHIVE_ROOT, scanId);
    console.log(`\n📁 Found ${files.length} files\n`);

    // Write files to Firestore (direct writes with detailed logging)
    if (files.length > 0) {
      console.log(`💾 Writing to Firestore...`);
      let totalWritten = 0;
      let failedCount = 0;
      const videoWrites = [];

      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        try {
          const fileRef = db.collection('files').doc(file.fileId);

          if (file.videoPreviewFrames) {
            const docSizeKB = (JSON.stringify(file).length / 1024).toFixed(2);
            console.log(`  📝 [${idx+1}/${files.length}] ${file.name.substring(0,40)}: ${docSizeKB} KB, ${file.videoPreviewFrames.length} frames`);
            videoWrites.push({ fileId: file.fileId, name: file.name });
          }

          await fileRef.set(file);
          totalWritten++;
        } catch (writeErr) {
          console.error(`  ❌ [${idx+1}] Failed to write ${file.name}:`, writeErr.code, writeErr.message);
          failedCount++;
        }
      }

      const filesWithFrames = files.filter(f => f.videoPreviewFrames).length;
      console.log(`✅ Wrote ${totalWritten} files to Firestore${failedCount > 0 ? ` (${failedCount} failed)` : ''}`);
      console.log(`📸 Files with videoPreviewFrames: ${filesWithFrames}`);

      // TEST: Verify one video file was written
      if (filesWithFrames > 0) {
        console.log(`\n📋 Verifying write...`);
        const videoFile = files.find(f => f.videoPreviewFrames);
        const verifyRef = await db.collection('files').doc(videoFile.fileId).get();
        if (verifyRef.exists) {
          const data = verifyRef.data();
          console.log(`  ✅ Found ${data.name}`);
          console.log(`     Has videoPreviewFrames: ${!!data.videoPreviewFrames}`);
        } else {
          console.log(`  ❌ Document not found!`);
        }
      }
      console.log('');
    }

    // Update scan with results
    const duration = Date.now() - startTime;
    const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

    await scanRef.update({
      status: 'completed',
      completedAt: admin.firestore.Timestamp.now(),
      duration,
      results: {
        totalFiles: files.length,
        totalSizeBytes,
        totalSizeGB: Math.round(totalSizeBytes / 1024 / 1024 / 1024 * 100) / 100,
        newFiles: files.length,
        deletedFiles: 0,
        modifiedFiles: 0,
        unchangedFiles: 0,
        fileTypes: {}
      }
    });

    console.log(`✨ Scan completed!`);
    console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
    console.log(`📊 Total files: ${files.length}`);
    console.log(`💾 Total size: ${Math.round(totalSizeBytes / 1024 / 1024 / 1024 * 100) / 100} GB\n`);

    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Scan failed:`, error.message);
    console.error(error);
    process.exit(1);
  }
}

run();
