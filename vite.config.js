import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Same allowlist as functions/download.js — the archive roots this app is
// permitted to read files from.
const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes/ArchiveStorage',
]

function isPathAllowed(filePath) {
  try {
    const realPath = fs.realpathSync(filePath)
    return ALLOWED_PATHS.some((basePath) => {
      try {
        const realBase = fs.realpathSync(basePath)
        return realPath === realBase || realPath.startsWith(realBase + path.sep)
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

const VIDEO_MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
}

// Dev-only local video streaming: FileDetail's <video> element requests
// /api/stream?path=<absolute path>, and native <video>/<audio> elements
// can't attach an Authorization header, so this can't reuse the
// token-gated `download` Cloud Function. Range-request support (206
// Partial Content) is what lets the browser seek instead of only ever
// playing from byte 0.
function localVideoStreamPlugin() {
  return {
    name: 'local-video-stream',
    configureServer(server) {
      server.middlewares.use('/api/stream', (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const filePath = url.searchParams.get('path')
        if (!filePath) {
          res.statusCode = 400
          res.end('Missing path parameter')
          return
        }

        if (!isPathAllowed(filePath) || !fs.existsSync(filePath)) {
          res.statusCode = 403
          res.end('Access denied')
          return
        }

        const stat = fs.statSync(filePath)
        const ext = path.extname(filePath).toLowerCase()
        const mimeType = VIDEO_MIME_TYPES[ext] || 'application/octet-stream'
        const range = req.headers.range

        if (range) {
          const match = /bytes=(\d+)-(\d*)/.exec(range)
          const start = match ? parseInt(match[1], 10) : 0
          const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1
          const chunkSize = end - start + 1

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mimeType,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
          })
          fs.createReadStream(filePath).pipe(res)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localVideoStreamPlugin()],
  server: {
    port: 5173,
  },
})
