const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

function previewPathFor(originalPath) {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  return path.join(dir, `${base}_preview.mp4`);
}

async function generatePreviewIfNeeded(originalPath) {
  const outPath = previewPathFor(originalPath);
  if (fs.existsSync(outPath)) return outPath;

  const args = [
    '-y',
    '-i', originalPath,
    '-vf', 'scale=-2:480',
    '-c:v', 'h264_videotoolbox',
    '-b:v', '1500k',
    '-c:a', 'aac',
    '-b:a', '96k',
    outPath,
  ];
  await execFilePromise(FFMPEG_BIN, args, { maxBuffer: 1024 * 1024 * 10 });
  return outPath;
}

// Runs `worker` over `items` with at most `limit` in flight at once.
async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(workers);
}

module.exports = { previewPathFor, generatePreviewIfNeeded, runWithConcurrency };
