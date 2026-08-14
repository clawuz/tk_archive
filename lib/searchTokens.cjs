// Firestore has no native full-text/substring search — matching "hug" against
// "HugeFan.mp4" client-side means downloading every raw document and testing
// each one, which is why free-text search was slow for rare terms (see
// damService.ts's old client-side filter). This precomputes, per file, every
// prefix of every word in the name and tags (lowercased), stored as a flat
// array. A search for "hug" then becomes `where('searchTokens',
// 'array-contains', 'hug')` — a real indexed query, not a full scan.
function wordsFrom(str) {
  return (str || '')
    .toLowerCase()
    .split(/[^a-z0-9çğıöşüâîû]+/i)
    .filter((w) => w.length >= 2);
}

function generateSearchTokens(name, tags) {
  const words = new Set();
  for (const w of wordsFrom(name)) words.add(w);
  for (const t of tags || []) {
    for (const w of wordsFrom(t.replace(/-/g, ' '))) words.add(w);
  }

  const tokens = new Set();
  for (const w of words) {
    for (let i = 2; i <= w.length; i++) {
      tokens.add(w.slice(0, i));
    }
  }
  return Array.from(tokens);
}

module.exports = { generateSearchTokens };
