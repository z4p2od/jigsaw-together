import { onVSIndex } from './firebase.js';

const listEl  = document.getElementById('rooms-list');
const emptyEl = document.getElementById('rooms-empty');

const THIRTY_MIN = 30 * 60 * 1000;

onVSIndex(rooms => {
  const now = Date.now();
  const open = Object.entries(rooms)
    .filter(([, r]) => r.status === 'waiting' && (now - r.createdAt) < THIRTY_MIN)
    .sort(([, a], [, b]) => b.createdAt - a.createdAt); // newest first

  // Remove old room rows (keep empty msg node)
  listEl.querySelectorAll('.vs-room-row').forEach(el => el.remove());

  if (open.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  open.forEach(([roomId, room]) => {
    const row = document.createElement('div');
    row.className = 'vs-room-row';

    const modeLabel = room.chaosMode ? 'Chaos ⚡' : room.hardMode ? 'Hard 🔥' : 'Casual';
    const creator   = room.creatorName || 'Someone';
    const ago       = Math.floor((now - room.createdAt) / 60000);
    const agoLabel  = ago < 1 ? 'just now' : `${ago}m ago`;

    row.innerHTML = `
      <div class="vs-room-info">
        <span class="vs-room-pieces">${room.pieces} pieces</span>
        <span class="vs-room-mode">${modeLabel}</span>
        <span class="vs-room-creator">👤 ${escapeHtml(creator)}</span>
        <span class="vs-room-age">${agoLabel}</span>
      </div>
      <a href="/vs.html?room=${roomId}" class="btn vs-room-join">Join</a>
    `;
    listEl.appendChild(row);
  });
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
