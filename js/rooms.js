import { onRoomsIndex } from './firebase.js';

const listEl  = document.getElementById('rooms-list');
const emptyEl = document.getElementById('rooms-empty');

onRoomsIndex(rooms => {
  const active = Object.entries(rooms)
    .filter(([, r]) => r.status !== 'done')
    .sort(([, a], [, b]) => b.createdAt - a.createdAt); // newest first

  listEl.querySelectorAll('.room-row').forEach(el => el.remove());

  if (active.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  active.forEach(([roomId, room]) => {
    const row = document.createElement('div');
    row.className = 'room-row';

    const pct      = room.pieces > 0 ? Math.round((room.solvedCount / room.pieces) * 100) : 0;
    const players  = room.playerCount || 0;
    const creator  = room.creatorName || 'Someone';
    const modeTag  = room.hardMode ? '<span class="hard-badge" style="font-size:0.7rem">Hard 🔥</span>' : '';

    // Cloudinary URL transformation for thumbnail
    const thumbUrl = room.imageUrl.replace('/upload/', '/upload/w_80,h_60,c_fill,g_auto/');

    row.innerHTML = `
      <img class="room-thumbnail" src="${escapeHtml(thumbUrl)}" alt="" />
      <div class="room-info">
        <div class="room-meta">
          <span class="room-pieces">${room.pieces} pieces</span>
          ${modeTag}
          <span class="room-stat">👤 ${escapeHtml(creator)}</span>
        </div>
        <span class="room-stat">${players} playing · ${pct}% done</span>
      </div>
      <a href="/puzzle.html?id=${roomId}" class="btn" style="flex-shrink:0;padding:6px 14px;font-size:0.85rem">Join</a>
    `;
    listEl.appendChild(row);
  });
});

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
