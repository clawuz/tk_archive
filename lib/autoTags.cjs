// Shared by scanner.cjs (local) and scannerDrive.cjs (Drive) — derives
// search tags from a file's folder/filename path components, so both
// sources get the same folder-and-name-derived tags without relying
// entirely on Claude Vision (which only sees a thumbnail, not the file's
// place in the archive's actual folder structure).

const TAG_STOPWORDS = new Set(['ve', 'ile', 'de', 'da', 'bir', 'the', 'and', 'for', 'of', 'a', 'an']);
const MAX_AUTO_TAGS = 10;

function slugify(text) {
  // Plain toLowerCase(), not Turkish locale: archive folder/file names mix
  // Turkish and English (e.g. "TK_OFFICIAL_STORE"), and tr-TR casing turns
  // the English "I" into dotless "ı" (official -> offıcıal), which is wrong
  // for the English words while barely helping the Turkish ones.
  // macOS (APFS/HFS+) returns filenames with decomposed Unicode (NFD) —
  // e.g. "ü" as "u" + combining diaeresis. Normalize to NFC first or the
  // combining marks get stripped by the \p{L} filter below, corrupting
  // Turkish characters (tüm -> tum, tişört -> tisort).
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[_]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Derives search tags from a file's path components — e.g.
// ['TKStore', 'TK_OFFICIAL_STORE_2026', 'B-Pamuk', 'Tüm Beyaz Tişört.png']
// yields ['tkstore', 'tk-official-store-2026', 'b-pamuk', 'tüm', 'beyaz',
// 'tişört']. This mirrors how the archive is actually organized (by
// client/campaign/project folder), unlike generic object-detection tags.
// `pathSegments` is folder names in order, then the filename last — for a
// local file this is the relative path split on path separators; for a
// Drive file (no real filesystem path) it's [driveFolderName, file.name].
function extractAutoTags(pathSegments) {
  const folderParts = pathSegments.slice(0, -1);
  const filenamePart = pathSegments[pathSegments.length - 1] || '';

  const tags = new Set();

  for (const folder of folderParts) {
    const slug = slugify(folder);
    if (slug.length >= 2 && !TAG_STOPWORDS.has(slug)) {
      tags.add(slug);
    }
  }

  const nameWithoutExt = filenamePart.replace(/\.[^.]+$/, '');
  const cleanedName = nameWithoutExt.replace(/\(\d+\)\s*$/, '').trim();
  const nameTokens = cleanedName.split(/[\s_-]+/);
  for (const token of nameTokens) {
    const slug = slugify(token);
    if (slug.length >= 3 && !TAG_STOPWORDS.has(slug) && !/^\d+$/.test(slug)) {
      tags.add(slug);
    }
  }

  return Array.from(tags).slice(0, MAX_AUTO_TAGS);
}

module.exports = { slugify, extractAutoTags };
