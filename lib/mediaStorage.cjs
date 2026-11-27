// Stores thumbnails and video preview frames in Cloud Storage instead of
// inline base64 in the Firestore document. Shared by scanner.cjs and
// scannerLocalPreview.cjs.
//
// Objects live in the same public bucket as the videos:
//   thumbs/{fileId}-{hash}.webp   (240px thumbnail, WebP quality 82)
//   frames/{fileId}/{n}-{hash}.jpg (video preview frames)
// The content hash in the name means a changed file gets a new URL, so the
// year-long immutable cache header never serves a stale image.
//
// Every function degrades to the legacy inline form if the upload fails, so
// a Storage hiccup never loses the preview — the document is just bigger.

const crypto = require('crypto');
const sharp = require('sharp');

const MEDIA_BUCKET = 'tk-archive-cd9d0-videos';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const WEBP_QUALITY = 82;

const shortHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const publicUrl = (bucketName, objectName) =>
  `https://storage.googleapis.com/${bucketName}/${objectName}`;

async function saveObject(bucket, objectName, buffer, contentType) {
  await bucket.file(objectName).save(buffer, {
    resumable: false,
    metadata: { contentType, cacheControl: CACHE_CONTROL },
  });
  return publicUrl(bucket.name || MEDIA_BUCKET, objectName);
}

/**
 * Uploads a thumbnail and returns its public https URL. WebP at quality 82
 * (sRGB); if WebP would be larger than the source PNG (tiny flat images) the
 * PNG is kept. Falls back to the legacy `data:` URL if the upload fails.
 */
async function uploadThumbnail(bucket, fileId, pngBase64) {
  const png = Buffer.from(pngBase64, 'base64');
  try {
    const webp = await sharp(png)
      .toColourspace('srgb')
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();
    const useWebp = webp.length <= png.length;
    const body = useWebp ? webp : png;
    const ext = useWebp ? 'webp' : 'png';
    const type = useWebp ? 'image/webp' : 'image/png';
    return await saveObject(bucket, `thumbs/${fileId}-${shortHash(body)}.${ext}`, body, type);
  } catch (err) {
    console.error(`⚠️  Thumbnail upload failed for ${fileId}, keeping inline: ${err.message}`);
    return `data:image/png;base64,${pngBase64}`;
  }
}

/**
 * Uploads video preview frames (as produced by extractVideoFrames:
 * { timestamp, frameNumber, frameData(base64 JPEG) }) and returns
 * { timestamp, frameNumber, url } entries. A frame whose upload fails is kept
 * inline so no frame is lost.
 */
async function uploadFrames(bucket, fileId, frames) {
  if (!frames || frames.length === 0) return frames;
  return Promise.all(
    frames.map(async (frame) => {
      try {
        const jpg = Buffer.from(frame.frameData, 'base64');
        const url = await saveObject(
          bucket,
          `frames/${fileId}/${frame.frameNumber}-${shortHash(jpg)}.jpg`,
          jpg,
          'image/jpeg'
        );
        return { timestamp: frame.timestamp, frameNumber: frame.frameNumber, url };
      } catch (err) {
        console.error(`⚠️  Frame ${frame.frameNumber} upload failed for ${fileId}, keeping inline: ${err.message}`);
        return frame;
      }
    })
  );
}

module.exports = { MEDIA_BUCKET, uploadThumbnail, uploadFrames, publicUrl };
