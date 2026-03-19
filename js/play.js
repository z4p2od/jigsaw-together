const grid      = document.getElementById('image-grid');
const loading   = document.getElementById('images-loading');
const startBtn  = document.getElementById('start-btn');
const statusEl  = document.getElementById('play-status');
const publicHint = document.getElementById('public-hint');

let selectedImage = null; // { url, width, height }

// ── Load images ───────────────────────────────────────────────────────────────

async function loadImages() {
  let images;
  try {
    const res = await fetch('/api/room-images');
    images = await res.json();
  } catch {
    loading.textContent = 'Failed to load images.';
    return;
  }

  if (!images.length) {
    loading.textContent = 'No images available.';
    return;
  }

  loading.style.display = 'none';
  grid.style.display = '';

  images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'play-image-card';

    const el = document.createElement('img');
    el.src = img.url;
    el.alt = '';
    el.loading = 'lazy';
    card.appendChild(el);

    card.addEventListener('click', () => {
      document.querySelectorAll('.play-image-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedImage = img;
      startBtn.disabled = false;
    });

    grid.appendChild(card);
  });
}

// ── Visibility hint ───────────────────────────────────────────────────────────

document.querySelectorAll('input[name="play-visibility"]').forEach(radio => {
  radio.addEventListener('change', () => {
    publicHint.style.display = radio.value === 'public' ? '' : 'none';
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  if (!selectedImage) return;

  startBtn.disabled = true;
  statusEl.textContent = 'Creating puzzle…';
  statusEl.className = 'status';

  const pieces     = document.querySelector('input[name="play-pieces"]:checked').value;
  const hard       = document.querySelector('input[name="play-mode"]:checked').value === 'hard';
  const isPublic   = document.querySelector('input[name="play-visibility"]:checked').value === 'public';

  const params = new URLSearchParams({
    pieces,
    hard:   hard,
    public: isPublic,
    image:  selectedImage.url,
    w:      selectedImage.width,
    h:      selectedImage.height,
  });

  try {
    const res  = await fetch(`/api/room-create?${params}`);
    const data = await res.json();
    if (!res.ok || !data.puzzleId) throw new Error(data.error || 'Failed to create puzzle');
    location.href = `/puzzle.html?id=${data.puzzleId}`;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'status error';
    startBtn.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadImages();
