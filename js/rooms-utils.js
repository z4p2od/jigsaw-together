export function selectOpenRooms(roomsIndex) {
  const rooms = roomsIndex && typeof roomsIndex === 'object' ? roomsIndex : {};
  return Object.entries(rooms)
    .filter(([, r]) => (r?.status ?? 'active') !== 'done')
    .sort(([, a], [, b]) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0));
}

