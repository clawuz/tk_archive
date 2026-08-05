const fs = require('fs').promises;
const path = require('path');

/**
 * Simple local file scanner for archive inventory.
 * Recursively scans a directory and counts files by type.
 */
async function scanDirectory(archiveRoot) {
  const stats = {
    totalFiles: 0,
    totalSizeBytes: 0,
    filesByType: {},
    largestFiles: [],
  };

  async function walkDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          stats.totalFiles++;
          const fileStats = await fs.stat(fullPath);
          const size = fileStats.size;
          stats.totalSizeBytes += size;

          // Track by extension
          const ext = path.extname(entry.name).toLowerCase() || 'none';
          if (!stats.filesByType[ext]) {
            stats.filesByType[ext] = { count: 0, size: 0 };
          }
          stats.filesByType[ext].count++;
          stats.filesByType[ext].size += size;

          // Track largest files
          stats.largestFiles.push({
            name: entry.name,
            path: fullPath,
            size,
          });
          stats.largestFiles.sort((a, b) => b.size - a.size);
          if (stats.largestFiles.length > 10) {
            stats.largestFiles.pop();
          }
        }
      }
    } catch (err) {
      console.error(`Error scanning ${dir}:`, err.message);
    }
  }

  try {
    await walkDir(archiveRoot);
  } catch (err) {
    throw new Error(`Klasör taranamadı: ${archiveRoot} - ${err.message}`);
  }

  return stats;
}

/**
 * Generates a markdown report from scan results.
 */
function generateReport(stats, archiveRoot) {
  const sizeGB = (stats.totalSizeBytes / 1024 / 1024 / 1024).toFixed(2);

  const topTypes = Object.entries(stats.filesByType)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(
      ([ext, data]) =>
        `- ${ext || 'no extension'}: ${data.count} dosya (${(data.size / 1024 / 1024 / 1024).toFixed(2)} GB)`
    )
    .join('\n');

  const largestFiles = stats.largestFiles
    .slice(0, 5)
    .map((f) => `- ${f.name}: ${(f.size / 1024 / 1024 / 1024).toFixed(2)} GB`)
    .join('\n');

  return `# TK Archive Envanteri Raporu

## Özet
Tarama başarıyla tamamlandı. ${stats.totalFiles.toLocaleString()} dosya, ${sizeGB} GB toplam boyut analiz edildi.

### Klasör
${archiveRoot}

## Dosya Türleri
${topTypes}

### En Büyük Dosyalar
${largestFiles}

## Öneriler
Arşiv optimize edilebilir. Eski versiyon dosyalarını temizleyebilir, backup'ları dışarıya taşıyabilirsiniz.
`;
}

module.exports = {
  scanDirectory,
  generateReport,
};
