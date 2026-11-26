/**
 * Image `src` for a video preview frame. Frames are either stored in Cloud
 * Storage (`url`, new) or inline as base64 JPEG (`frameData`, legacy) — the
 * dashboard must handle both while documents are being migrated.
 */
export function frameSrc(frame?: { url?: string; frameData?: string } | null): string {
  if (!frame) return ''
  if (frame.url) return frame.url
  if (frame.frameData) return `data:image/jpeg;base64,${frame.frameData}`
  return ''
}
