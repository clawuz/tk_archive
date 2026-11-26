// Run with: node --test lib/mediaStorage.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { uploadThumbnail, uploadFrames } = require('./mediaStorage.cjs');

function fakeBucket({ failOn } = {}) {
  const saved = new Map();
  return {
    name: 'test-bucket',
    saved,
    file(name) {
      return {
        async save(buf, opts) {
          if (failOn && failOn(name)) throw new Error('boom');
          saved.set(name, { buf, opts });
        },
      };
    },
  };
}

async function photoPngBase64() {
  // Photo-like image: smooth gradients with soft shapes (compresses far better
  // as WebP than as PNG, like a real thumbnail).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
    <defs><radialGradient id="g" cx="35%" cy="40%" r="75%"><stop offset="0" stop-color="#f4d6a0"/><stop offset="0.5" stop-color="#4a7fa8"/><stop offset="1" stop-color="#1b2a3c"/></radialGradient></defs>
    <rect width="240" height="160" fill="url(#g)"/>
    <circle cx="170" cy="60" r="38" fill="#c7503a" opacity="0.7"/><ellipse cx="80" cy="115" rx="60" ry="22" fill="#2f6b4f" opacity="0.8"/></svg>`;
  const png = await sharp(Buffer.from(svg)).blur(0.8).png().toBuffer();
  return png.toString('base64');
}

test('thumbnail is stored as WebP with immutable cache headers and a hashed public URL', async () => {
  const bucket = fakeBucket();
  const b64 = await photoPngBase64();
  const url = await uploadThumbnail(bucket, 'abc123', b64);
  assert.match(url, /^https:\/\/storage\.googleapis\.com\/test-bucket\/thumbs\/abc123-[0-9a-f]{10}\.webp$/);
  const [[name, obj]] = [...bucket.saved];
  assert.ok(name.endsWith('.webp'));
  assert.strictEqual(obj.opts.metadata.contentType, 'image/webp');
  assert.match(obj.opts.metadata.cacheControl, /immutable/);
  assert.ok(obj.buf.length < Buffer.from(b64, 'base64').length, 'WebP should be smaller than the PNG');
  assert.strictEqual((await sharp(obj.buf).metadata()).format, 'webp');
});

test('same content gives the same URL, changed content gives a new one', async () => {
  const b = fakeBucket();
  const a = await photoPngBase64();
  const u1 = await uploadThumbnail(b, 'f', a);
  const u2 = await uploadThumbnail(b, 'f', a);
  const other = (await sharp({ create: { width: 240, height: 160, channels: 3, background: '#336699' } }).png().toBuffer()).toString('base64');
  const u3 = await uploadThumbnail(b, 'f', other);
  assert.strictEqual(u1, u2);
  assert.notStrictEqual(u1, u3);
});

test('thumbnail falls back to an inline data URL when the upload fails', async () => {
  const bucket = fakeBucket({ failOn: () => true });
  const b64 = await photoPngBase64();
  assert.strictEqual(await uploadThumbnail(bucket, 'x', b64), `data:image/png;base64,${b64}`);
});

test('frames become { timestamp, frameNumber, url } with no frameData', async () => {
  const bucket = fakeBucket();
  const jpg = (await sharp({ create: { width: 320, height: 180, channels: 3, background: '#aa5533' } }).jpeg().toBuffer()).toString('base64');
  const out = await uploadFrames(bucket, 'vid1', [
    { timestamp: 3, frameNumber: 1, frameData: jpg },
    { timestamp: 9, frameNumber: 2, frameData: jpg },
  ]);
  assert.strictEqual(out.length, 2);
  for (const f of out) {
    assert.ok(f.url.startsWith('https://storage.googleapis.com/test-bucket/frames/vid1/'));
    assert.strictEqual(f.frameData, undefined);
  }
  assert.deepStrictEqual(out.map((f) => f.timestamp), [3, 9]);
  assert.strictEqual([...bucket.saved.values()][0].opts.metadata.contentType, 'image/jpeg');
});

test('a frame whose upload fails stays inline, the others are uploaded', async () => {
  const bucket = fakeBucket({ failOn: (n) => n.includes('/2-') });
  const jpg = (await sharp({ create: { width: 320, height: 180, channels: 3, background: '#223344' } }).jpeg().toBuffer()).toString('base64');
  const out = await uploadFrames(bucket, 'v', [
    { timestamp: 1, frameNumber: 1, frameData: jpg },
    { timestamp: 2, frameNumber: 2, frameData: jpg },
  ]);
  assert.ok(out[0].url && !out[0].frameData);
  assert.ok(!out[1].url && out[1].frameData === jpg);
});

test('null/empty frames pass through unchanged', async () => {
  const bucket = fakeBucket();
  assert.strictEqual(await uploadFrames(bucket, 'v', null), null);
  assert.deepStrictEqual(await uploadFrames(bucket, 'v', []), []);
});

test('tiny flat images keep the PNG when WebP would be larger', async () => {
  const bucket = fakeBucket();
  const noise = Buffer.alloc(240 * 160 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7 + ((i / 3) | 0) * 13) & 255;
  const b64 = (await sharp(noise, { raw: { width: 240, height: 160, channels: 3 } }).png().toBuffer()).toString('base64');
  const url = await uploadThumbnail(bucket, 'n', b64);
  assert.ok(url.endsWith('.png'), url);
  assert.strictEqual([...bucket.saved.values()][0].opts.metadata.contentType, 'image/png');
});
