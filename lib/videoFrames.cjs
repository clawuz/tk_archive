// Shared by scanner.cjs (local) and scannerDrive.cjs (Drive) — extracts 5
// frames spread across a video's duration via ffmpeg/ffprobe, so Claude
// Vision tagging (functions/tagNewFiles.js) sees the video's actual content
// instead of one arbitrary/misleading static thumbnail.

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execPromise = promisify(exec);

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'mts', 'm2ts'];

function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return VIDEO_EXTENSIONS.includes(ext);
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

// videoPath must be a real file on disk (scannerDrive.cjs downloads to a
// temp path first, extracts, then deletes it — frames never require
// keeping the video itself around).
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

module.exports = { isVideoFile, getVideoDuration, extractVideoFrames };
