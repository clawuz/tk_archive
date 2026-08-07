/**
 * Cloud Function: tagNewFiles
 *
 * Callable cloud function for YOLO-based tagging of video frames and images.
 * Supports two modes:
 * - single: Tag a specific file by fileId
 * - batch: Tag all files where needs_tagging === true
 *
 * In production, this would call a local YOLO model via Python subprocess or
 * Node YOLO wrapper. For MVP, the function returns a framework with placeholder
 * tags. Actual YOLO integration is a future step.
 *
 * Requires Firebase Auth.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

exports.tagNewFiles = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { fileId, mode, frames } = data;

  try {
    if (mode === 'single' && fileId) {
      // Tag single file
      const fileDoc = await db.collection('files').doc(fileId).get();
      if (!fileDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'File not found');
      }

      const file = fileDoc.data();
      const tags = await generateTagsFromFrames(file.videoPreviewFrames || []);

      // Merge with existing tags (avoid duplicates)
      const allTags = Array.from(new Set([...(file.tags || []), ...tags]));

      await db.collection('files').doc(fileId).update({
        tags: allTags,
        needs_tagging: false,
        taggedAt: admin.firestore.FieldValue.serverTimestamp(),
        tagSource: 'yolo-local',
        taggedBy: context.auth.uid
      });

      return {
        success: true,
        tags,
        fileId,
        message: `Tagged file with ${tags.length} tags`
      };
    }

    if (mode === 'batch') {
      // Batch mode: tag all files with needs_tagging: true
      const untagged = await db.collection('files')
        .where('needs_tagging', '==', true)
        .limit(100)
        .get();

      let taggedCount = 0;
      const batchErrors = [];

      for (const doc of untagged.docs) {
        try {
          const file = doc.data();
          const tags = await generateTagsFromFrames(file.videoPreviewFrames || []);

          if (tags.length > 0) {
            const allTags = Array.from(new Set([...(file.tags || []), ...tags]));
            await doc.ref.update({
              tags: allTags,
              needs_tagging: false,
              taggedAt: admin.firestore.FieldValue.serverTimestamp(),
              tagSource: 'yolo-local',
              taggedBy: context.auth.uid
            });
            taggedCount++;
          }
        } catch (fileErr) {
          batchErrors.push({
            fileId: doc.id,
            error: fileErr.message
          });
        }
      }

      return {
        success: true,
        taggedCount,
        totalProcessed: untagged.docs.length,
        errors: batchErrors,
        message: `Tagged ${taggedCount} of ${untagged.docs.length} files`
      };
    }

    throw new functions.https.HttpsError(
      'invalid-argument',
      'mode must be "single" or "batch"'
    );
  } catch (err) {
    console.error('Tagging failed:', err);
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    throw new functions.https.HttpsError('internal', err.message);
  }
});

/**
 * Generate tags from video frames using YOLO model.
 *
 * MVP placeholder: Returns empty array
 * Production: Would call local YOLO model and extract object class names
 *
 * Example production implementation:
 * ```
 * const YOLO = require('yolov8-node');
 * const yolo = new YOLO('yolov8n.pt');
 * for (const frame of frames) {
 *   const results = await yolo.predict(Buffer.from(frame.frameData, 'base64'));
 *   results.forEach(obj => allTags.add(obj.class_name.toLowerCase().replace(' ', '-')));
 * }
 * ```
 *
 * @param {Array} frames Array of frame objects with frameData (base64)
 * @returns {Promise<string[]>} Array of detected tags
 */
async function generateTagsFromFrames(frames) {
  // Placeholder for YOLO model inference
  const allTags = new Set();

  // In production:
  // 1. Initialize YOLO model (cached between requests)
  // 2. Process each frame through model
  // 3. Extract object class names and confidence scores
  // 4. Filter by confidence threshold
  // 5. Normalize tags (lowercase, replace spaces with hyphens)

  // Example tags that would come from YOLO:
  // - From image: 'person', 'car', 'building', 'dog', 'phone'
  // - From screenshot: 'computer', 'monitor', 'keyboard', 'mouse'
  // - Scene detection: 'outdoor', 'indoor', 'office', 'nature'

  // MVP: Return empty array (no actual tagging yet)
  return Array.from(allTags);
}
