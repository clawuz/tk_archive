// Run with: node --test migrateThumbnailsToStorage.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { planA, planB } = require('./migrateThumbnailsToStorage.cjs');

const DEL = { __delete: true };
const FieldValue = { delete: () => DEL };

test('A: inline thumbnail is picked up (base64 only), Drive https thumbnail is not', () => {
  assert.deepStrictEqual(planA({ thumbnail: { url: 'data:image/png;base64,QUJD' } }), { thumbnail: 'QUJD', frames: null });
  assert.deepStrictEqual(planA({ thumbnail: { url: 'https://lh3.googleusercontent.com/x' } }), { thumbnail: null, frames: null });
});

test('A: already staged documents are skipped (idempotent)', () => {
  const doc = {
    thumbnail: { url: 'data:image/png;base64,QUJD', storageUrl: 'https://s/t.webp' },
    videoPreviewFrames: [{ frameData: 'x', frameNumber: 1, timestamp: 1 }],
    videoPreviewFramesStorage: [{ url: 'https://s/f.jpg', frameNumber: 1, timestamp: 1 }],
  };
  assert.deepStrictEqual(planA(doc), { thumbnail: null, frames: null });
});

test('A: frames with frameData are collected, frames without are ignored', () => {
  const plan = planA({ videoPreviewFrames: [{ frameData: 'a', frameNumber: 1 }, { url: 'u', frameNumber: 2 }] });
  assert.strictEqual(plan.frames.length, 1);
  assert.strictEqual(plan.frames[0].frameData, 'a');
});

test('B: nothing staged -> nothing to do', () => {
  assert.strictEqual(planB({ thumbnail: { url: 'data:image/png;base64,QUJD' } }, FieldValue), null);
  assert.strictEqual(planB({}, FieldValue), null);
});

test('B: switches thumbnail.url to the staged URL and deletes the temp field', () => {
  const r = planB({ thumbnail: { storageUrl: 'https://s/t.webp' } }, FieldValue);
  assert.strictEqual(r.update['thumbnail.url'], 'https://s/t.webp');
  assert.strictEqual(r.update['thumbnail.storageUrl'], DEL);
  assert.deepStrictEqual(r.urls, ['https://s/t.webp']);
});

test('B: replaces frames with url-only entries (no frameData) and deletes the staging field', () => {
  const r = planB({ videoPreviewFramesStorage: [{ url: 'https://s/1.jpg', frameNumber: 1, timestamp: 3, junk: 1 }] }, FieldValue);
  assert.deepStrictEqual(r.update.videoPreviewFrames, [{ timestamp: 3, frameNumber: 1, url: 'https://s/1.jpg' }]);
  assert.strictEqual(r.update.videoPreviewFramesStorage, DEL);
  assert.strictEqual(r.update.frameData, undefined);
});

test('B: a partially staged frame set (any entry without url) is not switched', () => {
  const r = planB({ videoPreviewFramesStorage: [{ url: 'https://s/1.jpg', frameNumber: 1 }, { frameData: 'x', frameNumber: 2 }] }, FieldValue);
  assert.strictEqual(r, null);
});

test('B: never touches needs_tagging or other curation fields', () => {
  const r = planB({ thumbnail: { storageUrl: 'u' }, needs_tagging: true, tags: ['a'] }, FieldValue);
  assert.deepStrictEqual(Object.keys(r.update).sort(), ['thumbnail.storageUrl', 'thumbnail.url']);
});
