const connectBtn = document.getElementById('connectBtn');
const scanBtn = document.getElementById('scanBtn');
const statusBtn = document.getElementById('statusBtn');
const statusText = document.getElementById('statusText');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const results = document.getElementById('results');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    credentials: 'same-origin'
  });
  return response.json();
}

async function updateStatus() {
  const data = await fetchJson('/api/status');
  statusText.textContent = data.authenticated
    ? `Bağlandı. ${data.fileCount} içerik indekslendi.`
    : 'Google hesabına bağlanılmadı.';
  scanBtn.disabled = !data.authenticated;
}

async function connectGoogle() {
  const data = await fetchJson('/api/auth/url');
  window.location.href = data.url;
}

async function scanDrive() {
  scanBtn.disabled = true;
  statusText.textContent = 'Taranıyor...';
  const data = await fetchJson('/api/scan', { method: 'POST' });
  statusText.textContent = `${data.message} Toplam: ${data.total}`;
  scanBtn.disabled = false;
}

function renderResults(items) {
  if (!items.length) {
    results.innerHTML = '<div class="empty">Sonuç yok. Lütfen önce tarama yapın veya farklı bir anahtar kelime deneyin.</div>';
    return;
  }

  results.innerHTML = items
    .map((item) => {
      const preview = item.thumbnailLink
        ? `<img src="${item.thumbnailLink}" alt="${item.name}" />`
        : `<div class="preview-icon">${item.mimeType.split('/')[0] || 'F'}</div>`;
      const tags = (item.tags || []).map((tag) => `<span class="tag">${tag}</span>`).join(' ');
      return `
        <article class="result-card">
          <a class="preview" href="${item.webViewLink}" target="_blank" rel="noreferrer">${preview}</a>
          <div class="details">
            <h3><a href="${item.webViewLink}" target="_blank" rel="noreferrer">${item.name}</a></h3>
            <div class="meta">${item.mimeType} • ${new Date(item.modifiedTime).toLocaleString()}</div>
            <div class="tags">${tags}</div>
          </div>
        </article>`;
    })
    .join('');
}

async function searchFiles() {
  const query = searchInput.value.trim();
  const url = query ? `/api/search?q=${encodeURIComponent(query)}` : '/api/files';
  const data = await fetchJson(url);
  renderResults(data);
}

connectBtn.addEventListener('click', connectGoogle);
scanBtn.addEventListener('click', scanDrive);
searchBtn.addEventListener('click', searchFiles);
statusBtn.addEventListener('click', updateStatus);
window.addEventListener('load', () => {
  updateStatus();
  searchFiles();
});
