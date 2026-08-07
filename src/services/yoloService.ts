import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface YOLOTag {
  name: string;
  confidence: number;
}

/**
 * Tag video frames using YOLO model via Cloud Function.
 * Sends frame data to tagNewFiles cloud function for batch processing.
 */
export async function tagFrames(frames: Array<{ frameData: string }>): Promise<string[]> {
  try {
    const functions = getFunctions();
    const tagFunction = httpsCallable(functions, 'tagNewFiles');

    const result = await tagFunction({
      frames: frames,
      mode: 'batch'
    });

    return (result.data as any).tags || [];
  } catch (err) {
    console.error('Frame tagging failed:', err);
    return [];
  }
}

/**
 * Tag a single file using YOLO model.
 * File must have videoPreviewFrames or will be extracted.
 */
export async function tagFile(fileId: string): Promise<string[]> {
  try {
    const functions = getFunctions();
    const tagFunction = httpsCallable(functions, 'tagNewFiles');

    const result = await tagFunction({
      fileId: fileId,
      mode: 'single'
    });

    return (result.data as any).tags || [];
  } catch (err) {
    console.error('File tagging failed:', err);
    throw err;
  }
}

/**
 * Batch tag all files marked with needs_tagging: true.
 * Returns count of tagged files.
 */
export async function tagBatch(): Promise<number> {
  try {
    const functions = getFunctions();
    const tagFunction = httpsCallable(functions, 'tagNewFiles');

    const result = await tagFunction({
      mode: 'batch'
    });

    return (result.data as any).taggedCount || 0;
  } catch (err) {
    console.error('Batch tagging failed:', err);
    throw err;
  }
}

/**
 * Check if user is authenticated before tagging.
 */
export function isUserAuthenticated(): boolean {
  const auth = getAuth();
  return !!auth.currentUser;
}
