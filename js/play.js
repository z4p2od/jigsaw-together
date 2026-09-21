import { formatPuzzleDifficulty } from './puzzle-grid.js';

const grid      = document.getElementById('image-grid');
const loading   = document.getElementById('images-loading');
const startBtn  = document.getElementById('start-btn');
const statusEl  = document.getElementById('play-status');
const publicHint = document.getElementById('public-hint');

let selectedCatalogId = null;

async function loadCatalog() {
  let data;
  try {
    const res = await fetch('/api/catalog');
    data = await res.json();
  } catch {
    loading.textContent = 'Failed to load puzzles.';
    return;
  }

  const puzzles = data.puzzles || [];
  if (!puzzles.length) {
    loading.textContent = 'No puzzles in the catalog yet.';
    return;
  }

  loading.style.display = 'none';
  grid.style.display = '';

  puzzles.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'play-image-card';
    const el = document.createElement('img');
    el.src = p.imageUrl;
    el.alt = formatPuzzleDifficulty(p.pieces, p.hardMode);
    el.loading = 'lazy';
    card.appendChild(el);
    const badge = document.createElement('span');
    badge.className = 'catalog-badge';
    badge.textContent = formatPuzzleDifficulty(p.pieces, p.hardMode);
    card.appendChild(badge);
    card.addEventListener('click', () => {
      document.querySelectorAll('.play-image-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCatalogId = p.id;
      startBtn.disabled = false;
    });
    grid.appendChild(card);
  });
}

document.querySelectorAll('input[name="play-visibility"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    publicHint.style.display = radio.value === 'public' ? '' : 'none';
  });
});

startBtn.addEventListener('click', async () => {
  if (!selectedCatalogId) return;

  startBtn.disabled = true;
  statusEl.textContent = 'Creating puzzle…';
  statusEl.className = 'status';

  const isPublic = document.querySelector('input[name="play-visibility"]:checked').value === 'public';
  const params = new URLSearchParams({ catalog: selectedCatalogId, public: isPublic });

  try {
    const res = await fetch(`/api/room-create?${params}`);
    const data = await res.json();
    if (!res.ok || !data.puzzleId) throw new Error(data.error || 'Failed to create puzzle');
    location.href = `/?id=${encodeURIComponent(data.puzzleId)}`;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'status error';
    startBtn.disabled = false;
  }
});

loadCatalog();
