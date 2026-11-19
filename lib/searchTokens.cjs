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

// The local AI worker (tk-ai-engine/sprint3/ai_worker.py) also reads the text
// burned into the video ("FLYING CHEFS ON BOARD") and writes a description.
// Both go into the token set so they are searchable. Capped so one wordy
// description cannot blow up the doc's index-entry count.
const MAX_AI_WORDS = 300;
const MAX_AI_WORD_LEN = 24;

function aiSearchText(ai) {
  if (!ai) return '';
  const parts = [ai.description];
  if (Array.isArray(ai.onScreenText)) parts.push(...ai.onScreenText);
  return parts.filter((p) => typeof p === 'string').join(' ');
}

function generateSearchTokens(name, tags, extraText) {
  const words = new Set();
  for (const w of wordsFrom(name)) words.add(w);
  for (const t of tags || []) {
    for (const w of wordsFrom(t.replace(/-/g, ' '))) words.add(w);
  }
  let aiWords = 0;
  for (const w of wordsFrom(extraText)) {
    if (w.length > MAX_AI_WORD_LEN || words.has(w)) continue;
    words.add(w);
    if (++aiWords >= MAX_AI_WORDS) break;
  }

  const tokens = new Set();
  for (const w of words) {
    for (let i = 2; i <= w.length; i++) {
      tokens.add(w.slice(0, i));
    }
  }
  return Array.from(tokens);
}

module.exports = { generateSearchTokens, aiSearchText };
