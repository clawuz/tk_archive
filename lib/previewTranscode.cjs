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
  // Include the source extension so same-stem files with different
  // extensions (e.g. clip.mov and clip.mp4 in the same folder) don't
  // collide on the same preview filename — whichever was processed second
  // would otherwise see the first's preview already on disk and skip its
  // own transcode, ending up registered against the wrong video.
  const extTag = ext.slice(1).toLowerCase();
  return path.join(dir, `${base}_${extTag}_preview.mp4`);
}

async function generatePreviewIfNeeded(originalPath) {
  const outPath = previewPathFor(originalPath);
  if (fs.existsSync(outPath)) return outPath;

  // ffmpeg writes to a temp path and we only rename to the final outPath on
  // success, so a process kill mid-transcode never leaves a truncated file
  // at outPath for the existsSync() check above to mistake for "done" on
  // the next run.
  // Keep a .mp4 suffix on the temp path — ffmpeg picks its output muxer
  // from the file extension, so a bare ".part" suffix fails with "Unable
  // to choose an output format".
  const tmpPath = outPath.replace(/\.mp4$/i, '.part.mp4');
  const args = [
    '-y',
    '-i', originalPath,
    '-vf', 'scale=-2:480',
    '-c:v', 'h264_videotoolbox',
    '-b:v', '1500k',
    '-c:a', 'aac',
    '-b:a', '96k',
    tmpPath,
  ];
  try {
    await execFilePromise(FFMPEG_BIN, args, {
      maxBuffer: 1024 * 1024 * 10,
      // A corrupt source file or a stalled SMB read can hang ffmpeg
      // indefinitely, silently stalling one of the concurrent workers.
      // 30 minutes is generous even for a long raw clip at hardware-encode
      // speed.
      timeout: 30 * 60 * 1000,
      killSignal: 'SIGKILL',
    });
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (cleanupErr) {
      // Don't let a cleanup failure mask the original ffmpeg error.
    }
    throw err;
  }
  fs.renameSync(tmpPath, outPath);
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
