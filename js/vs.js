import {
  loadVSRoom, joinVSRoom, setVSReady, onVSRoom,
  initVSPieces, getVSPiecesOnce, onVSPieces, onVSOpponentPieces,
  updateVSGroupPosition, lockVSGroup, unlockVSGroup,
  writeVSSnap, updateVSPieceRotation,
  updateVSGroupRotationAndPositions, solveVSGroup,
  setVSPlaying, setVSWinner, setVSWinnerTeam, setVSFinished, setVSRematch, offerVSRematch,
  getPlayerColor, getVSIndexCreatorPlayerId,
  setVSTeamId, renameVSTeam,
  sendChatMessage, onChatMessages,
  writeVSPowerupEarned, writeVSEffect, onVSEffects, onVSPowerups, writeVSShufflePositions,
} from './firebase.js';
import { getLobbySlotPids } from './vs-lobby-slots.js';
import { cutPiece, getPad } from './jigsaw.js';

const BOARD_W   = 900;
const BOARD_H   = 650;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;

const roomId   = new URLSearchParams(location.search).get('room');
const playerId = getOrCreatePlayerId();

let playerName  = sessionStorage.getItem('playerName') || null;
let meta        = null;
let pieceEls    = [];
let pieceStates = [];
let solvedCount = 0;
let totalPieces = 0;
let startedAt   = null;
let timerInterval = null;
let unsubRoom   = null;
let unsubPieces = null;
let unsubOpp    = null;
let gameStarted = false;
let winnerDeclared = false;
let rematchOffered = false;

// Team mode state
let myTeamId      = null;   // 'A' | 'B'
let oppTeamId     = null;   // 'A' | 'B'
let myBoardKey    = playerId;  // teamId (team mode) | playerId (1v1)
let oppBoardKey   = null;      // teamId (team mode) | oppPlayerId (1v1)
let amTeamLeader  = false;     // deterministic first player on my team (for shared writes)
let creatorPlayerId = null;    // who created the room
let canStartRematch = false;
let currentRematchRoomId = null;
let latestPlayers = {};        // latest snapshot from handleRoomUpdate

const groups    = {};
const pieceGroup = [];
let dragging    = null;
/** After touch + preventDefault, ignore delayed compatibility mousedown. */
let suppressMouseDownPickUntil = 0;
let scale       = 1;
let pinch       = null;
let lastTap     = { time: 0, el: null };

// Chat
let chatUnread = 0;
let chatOpen   = false;

// Chaos mode powerups
let powerupPieces    = {};        // { pieceIndex: 'bw'|'invert'|'scramble' }
const powerupMarkerEls = [];      // DOM marker elements per piece index
const oppPowerupMarkerEls = [];
const earnedPowerups = new Set(); // indices already triggered
let invertActive     = false;
const faceDownPieces = new Set(); // indices currently face-down
const activeEffects  = {};        // timers
let unsubEffects     = null;
let oppId            = null;      // 1v1 opponent playerId — set during startGame

// Win counter (persisted in sessionStorage for rematch series)
// key: sorted pair of playerIds joined by '|'
function winsKey(oppId) {
  return 'vsWins:' + [playerId, oppId].sort().join('|');
}
function getWins(oppId) {
  const raw = sessionStorage.getItem(winsKey(oppId));
  return raw ? JSON.parse(raw) : { [playerId]: 0, [oppId]: 0 };
}
function recordWin(winnerId, oppId) {
  const wins = getWins(oppId);
  wins[winnerId] = (wins[winnerId] ?? 0) + 1;
  sessionStorage.setItem(winsKey(oppId), JSON.stringify(wins));
  return wins;
}

// Opponent board (read-only)
const oppPieceEls    = [];
const oppPieceStates = [];
const oppGroups      = {};
const oppPieceGroup  = [];

// DOM refs
const loadingEl      = document.getElementById('loading-overlay');
const loadingText    = document.getElementById('loading-text');
const nameModal      = document.getElementById('name-modal');
const nameInput      = document.getElementById('name-input');
const nameSubmit     = document.getElementById('name-submit');
const helpModal      = document.getElementById('help-modal');
const helpList       = document.getElementById('help-list');
const helpClose      = document.getElementById('help-close');
const helpBtn        = document.getElementById('help-btn');
const peekBtn        = document.getElementById('peek-btn');
const boxCover       = document.getElementById('box-cover');
const boxCoverImg    = document.getElementById('box-cover-img');
const vsLobby        = document.getElementById('vs-lobby');
const vsTeamLobby    = document.getElementById('vs-team-lobby');
const vsReadyBtn     = document.getElementById('vs-ready-btn');
const vsShareUrl     = document.getElementById('vs-share-url');
const vsCopyBtn      = document.getElementById('vs-copy-btn');
const vsLobbyStatus  = document.getElementById('vs-lobby-status');
const vsTeamLobbyStatus = document.getElementById('vs-team-lobby-status');
const vsTeamReadyBtn    = document.getElementById('vs-team-ready-btn');
const vsTeamStartBtn    = document.getElementById('vs-team-start-btn');
const myBoardLabelEl    = document.getElementById('my-board-label');
const vsBoardAvatarsMe  = document.getElementById('vs-board-avatars-me');
const vsBoardAvatarsOpp = document.getElementById('vs-board-avatars-opp');
const vsCountdown    = document.getElementById('vs-countdown');
const vsCountNum     = document.getElementById('vs-countdown-num');
const vsResult       = document.getElementById('vs-result');
const vsResultTitle  = document.getElementById('vs-result-title');
const vsResultTimes  = document.getElementById('vs-result-times');
const vsRematchBtn   = document.getElementById('vs-rematch-btn');
const vsScoreBoard   = document.getElementById('vs-score-board');
const vsScoreMe      = document.getElementById('vs-score-me');
const vsScoreOpp     = document.getElementById('vs-score-opp');
const vsGame         = document.getElementById('vs-game');
const board          = document.getElementById('puzzle-board');
const oppBoard       = document.getElementById('puzzle-board-opp');
const oppBoardLabel  = document.getElementById('opp-board-label');
const chatBtn        = document.getElementById('chat-btn');
const chatPanel      = document.getElementById('chat-panel');
const chatClose      = document.getElementById('chat-close');
const chatMessages   = document.getElementById('chat-messages');
const chatInput      = document.getElementById('chat-input');
const chatSendBtn    = document.getElementById('chat-send');
const timerEl        = document.getElementById('timer-display');
const vspMeName      = document.getElementById('vsp-me-name');
const vspMeFill      = document.getElementById('vsp-me-fill');
const vspMePct       = document.getElementById('vsp-me-pct');
const vspOppName     = document.getElementById('vsp-opp-name');
const vspOppFill     = document.getElementById('vsp-opp-fill');
const vspOppPct      = document.getElementById('vsp-opp-pct');

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!roomId) { location.href = '/'; }
else { askNameThenInit(); }

async function askNameThenInit() {
  if (!playerName) {
    playerName = await showNameModal();
    sessionStorage.setItem('playerName', playerName);
  }
  nameModal.style.display = 'none';
  initVS();
}

function showNameModal() {
  return new Promise(resolve => {
    nameModal.style.display = 'flex';
    nameInput.focus();
    const submit = () => {
      const name = nameInput.value.trim() || 'Anonymous';
      resolve(name);
    };
    nameSubmit.addEventListener('click', submit);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });
}

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('playerId');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('playerId', id); }
  return id;
}

// ── Seeded scatter (same seed = same positions for both players) ──────────────

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function scatterFromSeed(seed, count, dispW, dispH, hardMode) {
  const rand = seededRandom(seed);
  const ROTS = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x: rand() * (BOARD_W - dispW),
    y: rand() * (BOARD_H - dispH),
    rotation: hardMode ? ROTS[Math.floor(rand() * 4)] : 0,
  }));
}

function pickPowerupPieces(seed, totalPieces, cols, rows) {
  // Only pick interior pieces — those with all 4 neighbours present
  const interior = [];
  for (let i = 0; i < totalPieces; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (col > 0 && col < cols - 1 && row > 0 && row < rows - 1) interior.push(i);
  }
  if (interior.length === 0) return {}; // tiny puzzle fallback

  // Use a separate seeded RNG — multiply seed by large prime to get different sequence
  const rand = seededRandom((seed * 1000003) & 0xffffffff);
  const TYPES = ['bw', 'invert', 'scramble', 'flip', 'shake', 'shuffle'];
  const picked = new Set();
  const excluded = new Set(); // picked indices + their direct neighbours
  const assignments = {};
  const count = Math.min(5, Math.floor(interior.length / 3));
  let attempts = 0;
  while (picked.size < count && attempts < 1000) {
    attempts++;
    const idx = interior[Math.floor(rand() * interior.length)];
    if (picked.has(idx) || excluded.has(idx)) continue;
    assignments[idx] = TYPES[picked.size % TYPES.length];
    picked.add(idx);
    // Exclude this piece and all its direct neighbours from future picks
    excluded.add(idx);
    const col = idx % cols, row = Math.floor(idx / cols);
    if (row > 0)          excluded.add((row - 1) * cols + col);
    if (row < rows - 1)   excluded.add((row + 1) * cols + col);
    if (col > 0)          excluded.add(row * cols + (col - 1));
    if (col < cols - 1)   excluded.add(row * cols + (col + 1));
  }
  return assignments;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function initVS() {
  try {
    loadingText.textContent = 'Loading room…';
    const room = await loadVSRoom(roomId);
    meta = room.meta;

    creatorPlayerId = await getVSIndexCreatorPlayerId(roomId);

    const color = getPlayerColor(playerId);
    await joinVSRoom(roomId, playerId, playerName, color);

    // Re-fetch creatorPlayerId in case we just became creator
    if (!creatorPlayerId) creatorPlayerId = await getVSIndexCreatorPlayerId(roomId);

    if (meta.teamMode) {
      // ── Team lobby setup ──────────────────────────────────────────────────
      // Hide 1v1 lobby, show team lobby
      vsLobby.style.display = 'none';

      // Share link
      const shareUrlEl = document.getElementById('vs-team-share-url');
      if (shareUrlEl) shareUrlEl.textContent = location.href;
      const copyBtn2 = document.getElementById('vs-team-copy-btn');
      if (copyBtn2) {
        copyBtn2.addEventListener('click', () => {
          navigator.clipboard.writeText(location.href).then(() => {
            copyBtn2.textContent = 'Copied!';
            setTimeout(() => (copyBtn2.textContent = 'Copy Link'), 2000);
          });
        });
      }

      // Team join buttons
      ['A', 'B'].forEach(tid => {
        const btn = document.getElementById(`team-join-${tid}`);
        if (btn) {
          btn.addEventListener('click', () => joinTeam(tid));
        }
        // Rename button
        const renBtn = document.getElementById(`team-rename-${tid}`);
        if (renBtn) {
          renBtn.addEventListener('click', () => promptTeamRename(tid));
        }
      });

      // Wire up action buttons once — visibility is driven by updateTeamLobbyUI
      if (vsTeamStartBtn) {
        vsTeamStartBtn.addEventListener('click', () => {
          if (vsTeamStartBtn.disabled) return;
          vsTeamStartBtn.disabled = true;
          vsTeamStartBtn.textContent = 'Starting…';
          setVSPlaying(roomId);
        });
      }
      if (vsTeamReadyBtn) {
        vsTeamReadyBtn.disabled = true;
        vsTeamReadyBtn.addEventListener('click', () => {
          if (vsTeamReadyBtn.disabled) return;
          vsTeamReadyBtn.disabled = true;
          vsTeamReadyBtn.textContent = '✓ Ready!';
          setVSReady(roomId, playerId);
        });
      }

      // Do NOT auto-join a team — let the player choose
      if (room.meta.status === 'playing') {
        vsTeamLobby.style.display = 'none';
      } else {
        vsTeamLobby.style.display = 'flex';
      }
    } else {
      // ── 1v1 lobby setup ──────────────────────────────────────────────────
      if (room.meta.status === 'playing') vsLobby.style.display = 'none';

      vsShareUrl.textContent = location.href;
      vsCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(location.href).then(() => {
          vsCopyBtn.textContent = 'Copied!';
          setTimeout(() => (vsCopyBtn.textContent = 'Copy Link'), 2000);
        });
      });

      vsReadyBtn.disabled = false;
      vsReadyBtn.addEventListener('click', () => {
        vsReadyBtn.disabled = true;
        vsReadyBtn.textContent = 'Waiting…';
        setVSReady(roomId, playerId);
      });
    }

    vsRematchBtn.addEventListener('click', handleRematchButtonClick);

    loadingEl.style.display = 'none';

    // Subscribe to room — drives all state transitions
    unsubRoom = onVSRoom(roomId, handleRoomUpdate);
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Room not found.';
  }
}

async function joinTeam(teamId) {
  await setVSTeamId(roomId, playerId, teamId);
}

async function promptTeamRename(teamId) {
  // Only creator can rename Team A; any member of Team B can rename Team B
  const room = await loadVSRoom(roomId);
  const players = room.players || {};
  const isCreator = creatorPlayerId === playerId;
  const isOnTeam  = players[playerId]?.teamId === teamId;

  if (teamId === 'A' && !isCreator) return;
  if (teamId === 'B' && !isOnTeam) return;

  const current = room.meta?.teamNames?.[teamId] || `Team ${teamId}`;
  const newName  = window.prompt(`Rename team:`, current);
  if (newName && newName.trim()) {
    await renameVSTeam(roomId, teamId, newName.trim().slice(0, 20));
  }
}

let prevStatus = null;

function handleRoomUpdate(room) {
  if (!room) return;
  const { meta: m, players = {} } = room;
  latestPlayers = players;

  if (m.teamMode) {
    updateTeamLobbyUI(players, m);
  } else {
    updateLobbyUI(players);
  }

  if (m.status === 'waiting' || m.status === 'ready') {
    if (!m.teamMode) {
      // 1v1: both ready → auto-start
      const playerList = Object.values(players);
      if (playerList.length === 2 && playerList.every(p => p.ready) && prevStatus !== 'playing' && prevStatus !== 'done') {
        const ids = Object.keys(players).sort();
        if (ids[0] === playerId) setVSPlaying(roomId);
      }
    }
    // Team mode: creator manually starts via vsTeamStartBtn
  }

  if (m.status === 'playing' && !gameStarted) {
    if (m.teamMode && !players[playerId]?.teamId) {
      // Player never picked a team — show a message and keep them on the lobby screen
      if (vsTeamLobbyStatus) vsTeamLobbyStatus.textContent = 'Match has started — you were not assigned to a team.';
      if (vsTeamReadyBtn) { vsTeamReadyBtn.disabled = true; vsTeamReadyBtn.textContent = 'Match in progress'; }
      return;
    }
    gameStarted = true;
    startedAt = m.startedAt;
    startCountdown(m.teamMode).then(() => startGame(room));
  }

  if (m.status === 'done' && prevStatus !== 'done') {
    showResult(room);
  }

  // Rematch state
  if (m.status === 'done') {
    currentRematchRoomId = m.rematchRoomId || null;
    if (m.rematchRoomId) {
      const isTeam = Boolean(m.teamMode);
      if (!isTeam) {
        location.href = `/vs.html?room=${m.rematchRoomId}`;
        return;
      }
      const offers = m.rematchOffers || {};
      if (offers[playerId]) {
        location.href = `/vs.html?room=${m.rematchRoomId}`;
        return;
      }
      updateRematchUI(m.rematchOffers || {}, players);
      return;
    }
    currentRematchRoomId = null;
    updateRematchUI(m.rematchOffers || {}, players);
  }

  prevStatus = m.status;
}

function updateLobbyUI(players) {
  const ids = Object.keys(players || {});
  const [slot0Pid, slot1Pid] = getLobbySlotPids(players, playerId);
  const slotPids = [slot0Pid, slot1Pid];

  for (let slot = 0; slot < 2; slot++) {
    const pid  = slotPids[slot];
    const p    = pid ? players[pid] : null;
    const avatarEl = document.getElementById(`vs-avatar-${slot}`);
    const nameEl   = document.getElementById(`vs-name-${slot}`);
    const readyEl  = document.getElementById(`vs-ready-${slot}`);
    if (p) {
      avatarEl.textContent    = getAvatarText(p.name);
      avatarEl.style.background = p.color;
      nameEl.textContent      = pid === playerId ? `${p.name} (you)` : p.name;
      readyEl.textContent     = p.ready ? '✓ Ready' : '';
      readyEl.style.color     = p.ready ? '#34d399' : '';
    } else {
      avatarEl.textContent    = '?';
      avatarEl.style.background = 'var(--surface2)';
      nameEl.textContent      = 'Waiting…';
      readyEl.textContent     = '';
    }
  }
  if (ids.length < 2) {
    vsLobbyStatus.textContent = 'Waiting for opponent to join…';
  } else {
    const allReady = Object.values(players).every(p => p.ready);
    vsLobbyStatus.textContent = allReady ? 'Starting…' : 'Both players must click Ready!';
    vsReadyBtn.style.display = '';
  }
  // Show my name in progress bar
  const me = players[playerId];
  if (me) vspMeName.textContent = me.name + ' (you)';
  const oppId = slot1Pid;
  if (oppId) vspOppName.textContent = players[oppId]?.name ?? '';
}

function updateTeamLobbyUI(players, m) {
  // Progress bar labels — update even while game is running
  const me = players[playerId];
  if (me?.teamId) {
    const teamName = m.teamNames?.[me.teamId] || `Team ${me.teamId}`;
    if (vspMeName) vspMeName.textContent = teamName + ' (your team)';
  }

  // Only update lobby widgets when lobby is visible
  if (vsTeamLobby.style.display === 'none') return;

  const myTeamInLobby = players[playerId]?.teamId || null;
  const isCreator     = creatorPlayerId === playerId;
  const teamAPlayers  = Object.values(players).filter(p => p.teamId === 'A');
  const teamBPlayers  = Object.values(players).filter(p => p.teamId === 'B');

  // Team name labels
  ['A', 'B'].forEach(tid => {
    const nameEl = document.getElementById(`team-name-${tid}`);
    if (nameEl) nameEl.textContent = m.teamNames?.[tid] || `Team ${tid}`;
  });

  // Player chips per team
  ['A', 'B'].forEach(tid => {
    const container = document.getElementById(`team-avatars-${tid}`);
    if (!container) return;
    container.innerHTML = '';
    Object.entries(players).forEach(([pid, p]) => {
      if (p.teamId !== tid) return;
      const chip = document.createElement('div');
      chip.className = 'team-player-chip';
      const readyMark = p.ready ? ' ✓' : '';
      chip.innerHTML = `<div class="team-player-circle" style="background:${p.color}">${getAvatarText(p.name)}</div>
        <span class="team-player-name">${pid === playerId ? `${p.name} (you)` : p.name}${readyMark}</span>`;
      container.appendChild(chip);
    });
  });

  // Join buttons — hide for my current team, show both when unassigned
  const btnA = document.getElementById('team-join-A');
  const btnB = document.getElementById('team-join-B');
  if (btnA) btnA.style.display = myTeamInLobby === 'A' ? 'none' : '';
  if (btnB) btnB.style.display = myTeamInLobby === 'B' ? 'none' : '';

  // Rename buttons — creator can rename A; any Team B member can rename B
  const renBtnA = document.getElementById('team-rename-A');
  const renBtnB = document.getElementById('team-rename-B');
  if (renBtnA) renBtnA.style.display = isCreator ? '' : 'none';
  if (renBtnB) renBtnB.style.display = myTeamInLobby === 'B' ? '' : 'none';

  // Show Start (creator) or Ready (non-creator) — never both
  if (isCreator) {
    if (vsTeamReadyBtn) vsTeamReadyBtn.style.display = 'none';
    if (vsTeamStartBtn) {
      vsTeamStartBtn.style.display = '';
      const canStart = teamAPlayers.length >= 1 && teamBPlayers.length >= 1;
      vsTeamStartBtn.disabled = !canStart;
      vsTeamStartBtn.textContent = canStart ? 'Start Match' : 'Need at least 1 player per team';
    }
  } else {
    if (vsTeamStartBtn) vsTeamStartBtn.style.display = 'none';
    if (vsTeamReadyBtn) {
      vsTeamReadyBtn.style.display = '';
      const alreadyReady = players[playerId]?.ready;
      if (alreadyReady) {
        vsTeamReadyBtn.disabled = true;
        vsTeamReadyBtn.textContent = '✓ Ready!';
      } else if (myTeamInLobby) {
        vsTeamReadyBtn.disabled = false;
        vsTeamReadyBtn.textContent = 'Ready';
      } else {
        vsTeamReadyBtn.disabled = true;
        vsTeamReadyBtn.textContent = 'Join a team first';
      }
    }
  }

  // Status label
  if (vsTeamLobbyStatus) {
    if (!myTeamInLobby) {
      vsTeamLobbyStatus.textContent = 'Pick a team to join!';
    } else {
      const total = Object.keys(players).length;
      vsTeamLobbyStatus.textContent = `${total} player${total !== 1 ? 's' : ''} joined (${teamAPlayers.length}v${teamBPlayers.length})`;
    }
  }
}

function startCountdown(teamMode) {
  return new Promise(resolve => {
    if (teamMode) {
      vsTeamLobby.style.display = 'none';
    } else {
      vsLobby.style.display = 'none';
    }
    vsCountdown.style.display = 'flex';
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    const tick = () => {
      vsCountNum.textContent = steps[i];
      i++;
      if (i < steps.length) setTimeout(tick, 800);
      else setTimeout(() => { vsCountdown.style.display = 'none'; resolve(); }, 600);
    };
    tick();
  });
}

async function startGame(room) {
  const { meta: m, pieces: existingPieces = {}, players = {} } = room;
  meta = m;
  latestPlayers = players;

  vsGame.style.display = '';
  scale = computeSplitScale();

  const count     = m.cols * m.rows;
  totalPieces     = count;
  const scattered = scatterFromSeed(m.seed, count, m.displayW, m.displayH, m.hardMode);

  if (m.teamMode) {
    // ── Team mode board setup ────────────────────────────────────────────────
    myTeamId  = players[playerId]?.teamId || 'A';
    oppTeamId = myTeamId === 'A' ? 'B' : 'A';
    myBoardKey  = myTeamId;
    oppBoardKey = oppTeamId;

    // Deterministic team leader: alphabetically first player on my team
    const teammates = Object.keys(players)
      .filter(pid => (players[pid].teamId || 'A') === myTeamId)
      .sort();
    amTeamLeader = teammates[0] === playerId;

    // Only team leader initialises the board if it doesn't exist yet
    const existingTeamPieces = existingPieces[myBoardKey] || await getVSPiecesOnce(roomId, myBoardKey);
    if (!existingTeamPieces && amTeamLeader) {
      await initVSPieces(roomId, myBoardKey, scattered);
    }

    // Short wait for Firebase write to propagate if we just inited
    const freshPieces = existingTeamPieces || (await getVSPiecesOnce(roomId, myBoardKey));
    pieceStates = freshPieces
      ? Object.values(freshPieces)
      : scattered.map(p => ({ ...p, solved: false }));

    // Board label row
    const myTeamName  = m.teamNames?.[myTeamId]  || `Team ${myTeamId}`;
    const oppTeamName = m.teamNames?.[oppTeamId] || `Team ${oppTeamId}`;
    if (myBoardLabelEl) myBoardLabelEl.textContent = `${myTeamName} (your team)`;
    if (oppBoardLabel)  oppBoardLabel.textContent  = oppTeamName;
    if (vspMeName)      vspMeName.textContent      = myTeamName + ' (your team)';
    if (vspOppName)     vspOppName.textContent     = oppTeamName;

    renderBoardAvatars(players);
  } else {
    // ── 1v1 board setup ──────────────────────────────────────────────────────
    myBoardKey = playerId;
    amTeamLeader = true;

    if (!existingPieces[playerId]) {
      await initVSPieces(roomId, playerId, scattered);
    }

    pieceStates = (existingPieces[playerId]
      ? Object.values(existingPieces[playerId])
      : scattered.map(p => ({ ...p, solved: false })));

    oppId = Object.keys(players).find(id => id !== playerId) ?? null;
    oppBoardKey = oppId;
  }

  solvedCount = pieceStates.filter(p => p.solved).length;

  // Chaos mode setup
  if (m.chaosMode) {
    powerupPieces = pickPowerupPieces(m.seed, count, m.cols, m.rows);
  }

  setupBoard();
  await renderAllPieces();
  reconstructGroups();
  setupHelp();
  setupPeek();
  setupChat();
  attachDragListeners();
  if (m.hardMode) attachRotateListeners();

  // Timer
  if (startedAt) {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = formatTime(secs);
    startTimer();
  }

  updateMyProgress();

  // Subscribe to my board changes (handles both teammates and solo)
  unsubPieces = onVSPieces(roomId, myBoardKey, applyRemoteUpdate);

  // Set up opponent board
  if (oppBoardKey) {
    if (!m.teamMode) {
      const oppName = players[oppId]?.name || 'Opponent';
      if (oppBoardLabel) oppBoardLabel.textContent = oppName;
      vspOppName.textContent = oppName;
    }

    setupOppBoard();
    const rawOppPieces = existingPieces[oppBoardKey] || await getVSPiecesOnce(roomId, oppBoardKey);
    const initialOppPieces = rawOppPieces
      ? Object.values(rawOppPieces)
      : scattered.map(p => ({ ...p, solved: false }));
    await renderOppPieces(initialOppPieces);

    unsubOpp = onVSOpponentPieces(roomId, oppBoardKey, applyOppUpdate);

    if (m.chaosMode) {
      renderOppPowerupMarkers();
    }
  }

  // Subscribe to incoming powerup effects (chaos mode)
  // In team mode, effects are keyed by teamId so all team members receive them
  if (m.chaosMode) {
    const effectKey = m.teamMode ? myTeamId : playerId;
    unsubEffects = onVSEffects(roomId, effectKey, effect => {
      applyEffect(effect);
    });
  }

  window.addEventListener('beforeunload', cleanup);
}

function renderBoardAvatars(players) {
  if (!vsBoardAvatarsMe || !vsBoardAvatarsOpp) return;
  vsBoardAvatarsMe.innerHTML  = '';
  vsBoardAvatarsOpp.innerHTML = '';
  Object.entries(players).forEach(([pid, p]) => {
    const tid = p.teamId || 'A';
    const circle = document.createElement('div');
    circle.className = 'vs-board-avatar';
    circle.style.background = p.color;
    circle.title = p.name;
    circle.textContent = getAvatarText(p.name);
    if (tid === myTeamId) {
      vsBoardAvatarsMe.appendChild(circle);
    } else {
      vsBoardAvatarsOpp.appendChild(circle);
    }
  });
}

// ── Board + Rendering ─────────────────────────────────────────────────────────

function computeSplitScale() {
  const headerH  = 120; // progress bar + header
  const availW   = (window.innerWidth  / 2) - 12;
  const availH   = window.innerHeight  - headerH;
  return Math.min(availW / BOARD_W, availH / BOARD_H, 1);
}

function setupBoard() {
  board.style.width           = BOARD_W + 'px';
  board.style.height          = BOARD_H + 'px';
  board.style.transformOrigin = 'top left';
  applyScale(scale);
}

function setupOppBoard() {
  oppBoard.style.width           = BOARD_W + 'px';
  oppBoard.style.height          = BOARD_H + 'px';
  oppBoard.style.transformOrigin = 'top left';
  oppBoard.style.position        = 'relative';
  applyOppScale(scale);
}

function renderPiece(index, dataUrl, x, y, solved, elW, elH) {
  const el     = document.createElement('img');
  el.src       = dataUrl;
  el.className = 'piece' + (solved ? ' solved' : '');
  el.dataset.index = index;
  el.style.width   = elW + 'px';
  el.style.height  = elH + 'px';
  el.draggable     = false;
  movePieceEl(index, x, y, el);
  board.appendChild(el);
  pieceEls[index] = el;
  updatePieceZIndex(index);

  // Chaos mode: powerup glow + marker
  if (powerupPieces[index] !== undefined && !solved) {
    el.classList.add(`powerup-glow-${powerupPieces[index]}`);
    const marker = createPowerupMarker(index, powerupPieces[index], x, y);
    board.appendChild(marker);
    powerupMarkerEls[index] = marker;
  }
}

function movePieceEl(index, x, y, el) {
  const pad = meta?._pad ?? 0;
  const e   = el ?? pieceEls[index];
  if (!e) return;
  const rot = pieceStates[index]?.rotation ?? 0;
  e.style.left = '0';
  e.style.top  = '0';
  e.style.transform = rot
    ? `translate(${x - pad}px, ${y - pad}px) rotate(${rot}deg)`
    : `translate(${x - pad}px, ${y - pad}px)`;
  // Move powerup marker with piece
  if (!el && powerupMarkerEls[index]) {
    powerupMarkerEls[index].style.left = x + 'px';
    powerupMarkerEls[index].style.top  = y + 'px';
  }
}

function updatePieceZIndex(index) {
  const e = pieceEls[index];
  if (!e || e.classList.contains('dragging')) return;
  const edges = meta?.edges?.[index];
  if (!edges || !meta.cols || !meta.rows) return;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  let z = (meta.cols - col) + (meta.rows - row);
  if (edges.right > 0) z += meta.rows;
  if (edges.bottom > 0) z += meta.cols;
  e.style.zIndex = z;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Opponent board rendering ───────────────────────────────────────────────────

// _cachedImg is set during renderAllPieces so opp rendering can reuse it
let _cachedImg = null;

async function renderAllPieces() {
  const src = meta.imageUrl;
  _cachedImg = await loadImage(src);
  const img = _cachedImg;
  const { cols, rows, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = getPad(displayW, displayH);
  meta._displayW = displayW;
  meta._displayH = displayH;
  meta._pad      = pad;

  const BATCH = 50;
  for (let start = 0; start < totalPieces; start += BATCH) {
    await new Promise(r => setTimeout(r, 0));
    const end = Math.min(start + BATCH, totalPieces);
    for (let i = start; i < end; i++) {
      const col     = i % cols;
      const row     = Math.floor(i / cols);
      const dataUrl = cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges[i]);
      const p       = pieceStates[i];
      renderPiece(i, dataUrl, p.x, p.y, p.solved, displayW + pad * 2, displayH + pad * 2);
    }
    loadingText.textContent = `Cutting pieces... ${Math.min(end, totalPieces)} / ${totalPieces}`;
  }
}

async function renderOppPieces(states) {
  const img = _cachedImg;
  if (!img) return;
  const { cols, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = meta._pad;
  const elW = displayW + pad * 2;
  const elH = displayH + pad * 2;

  for (let i = 0; i < states.length; i++) {
    oppPieceStates[i] = states[i] ?? { x: 0, y: 0, rotation: 0, solved: false };
    const col     = i % cols;
    const row     = Math.floor(i / cols);
    const dataUrl = cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges[i]);
    const el      = document.createElement('img');
    el.src        = dataUrl;
    const glowCls = (meta.chaosMode && powerupPieces[i] !== undefined && !oppPieceStates[i].solved)
      ? ` powerup-glow-${powerupPieces[i]}` : '';
    el.className  = 'piece' + (oppPieceStates[i].solved ? ' solved' : '') + glowCls;
    el.draggable  = false;
    el.style.width  = elW + 'px';
    el.style.height = elH + 'px';
    moveOppPieceEl(i, oppPieceStates[i].x, oppPieceStates[i].y, el);
    oppBoard.appendChild(el);
    oppPieceEls[i] = el;
  }
}

function moveOppPieceEl(index, x, y, el) {
  const pad = meta?._pad ?? 0;
  const e   = el ?? oppPieceEls[index];
  if (!e) return;
  const rot = oppPieceStates[index]?.rotation ?? 0;
  e.style.left = '0';
  e.style.top  = '0';
  e.style.transform = rot
    ? `translate(${x - pad}px, ${y - pad}px) rotate(${rot}deg)`
    : `translate(${x - pad}px, ${y - pad}px)`;
}

function applyOppUpdate(allPieces) {
  if (!allPieces) return;
  const entries = Object.entries(allPieces);

  // Update progress bar
  const oppTotal   = entries.length;
  const oppSolved  = entries.filter(([, p]) => p.solved).length;
  const oppGrouped = entries.filter(([, p]) => p.groupId).length;
  const oppPlaced  = Math.max(oppSolved, oppGrouped);
  const pct = oppTotal > 0 ? Math.round(oppPlaced / oppTotal * 100) : 0;
  vspOppFill.style.width = pct + '%';
  vspOppPct.textContent  = pct + '%';

  // Update each opponent piece element
  entries.forEach(([key, p]) => {
    const i = Number(key);
    if (!oppPieceEls[i]) return;
    oppPieceStates[i] = { ...(oppPieceStates[i] ?? {}), ...p };
    moveOppPieceEl(i, p.x, p.y);
    if (p.solved) {
      oppPieceEls[i].classList.add('solved');
      if (oppPowerupMarkerEls[i]) oppPowerupMarkerEls[i].style.display = 'none';
    }
    // Move opp powerup marker
    if (oppPowerupMarkerEls[i] && !p.solved) {
      oppPowerupMarkerEls[i].style.left = p.x + 'px';
      oppPowerupMarkerEls[i].style.top  = p.y + 'px';
    }
  });
}

function applyOppScale(s) {
  oppBoard.style.transform   = s === 1 ? '' : `scale(${s})`;
  oppBoard.style.marginRight  = s > 1 ? BOARD_W * (s - 1) + 'px' : '';
  oppBoard.style.marginBottom = s > 1 ? BOARD_H * (s - 1) + 'px' : '';
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function resolvePiecePickVs(target, clientX, clientY) {
  let node = target;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  let el = node?.nodeType === 1 ? node.closest('.piece') : null;
  if (!el && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    el = document.elementFromPoint(clientX, clientY)?.closest('.piece');
  }
  return el;
}

// Fake cursor for invert effect
let fakeCursor = null;

function getOrCreateFakeCursor() {
  if (fakeCursor) return fakeCursor;
  fakeCursor = document.createElement('div');
  fakeCursor.id = 'fake-cursor';
  fakeCursor.style.cssText = 'position:fixed;width:24px;height:24px;pointer-events:none;z-index:9999;display:none';
  fakeCursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 3 C9 2 10 1 11 1 C12 1 13 2 13 3 L13 10 L14.5 8.5 C15 8 16 8 16.5 8.5 C17 9 17 10 16.5 10.5 L14 13 C14 13 14 17 12 19 C10.5 20.5 8 21 6 19.5 C4 18 4 15 4 13 L4 8 C4 7 5 6 6 6 C7 6 8 7 8 8 L8 3 C8 2 8.5 1.5 9 1.5 Z" fill="white" stroke="black" stroke-width="1" stroke-linejoin="round"/></svg>';
  document.body.appendChild(fakeCursor);
  return fakeCursor;
}

function mirrorCoords(clientX, clientY) {
  if (!invertActive) return { clientX, clientY };
  const wrap = board.parentElement;
  const rect = wrap.getBoundingClientRect();
  // Mirror around the center of the board wrap
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;
  return {
    clientX: 2 * cx - clientX,
    clientY: 2 * cy - clientY,
  };
}

function updateFakeCursor(clientX, clientY) {
  const fc = getOrCreateFakeCursor();
  if (!invertActive) {
    syncCursorVisibility();
    return;
  }
  const { clientX: mx, clientY: my } = mirrorCoords(clientX, clientY);
  fc.style.left = (mx - 9) + 'px';
  fc.style.top  = (my - 1) + 'px';
  syncCursorVisibility();
}

function syncCursorVisibility() {
  const fc = getOrCreateFakeCursor();
  if (invertActive) {
    fc.style.display = 'block';
    board.parentElement.style.cursor = 'none';
  } else {
    fc.style.display = 'none';
    board.parentElement.style.cursor = '';
  }
}

function attachDragListeners() {
  board.addEventListener('mousedown',   onMouseDown);
  if (typeof PointerEvent === 'function') {
    board.addEventListener('pointerdown', onBoardPointerDownPickVs, { passive: false });
  }
  board.addEventListener('dragstart', e => e.preventDefault(), true);
  window.addEventListener('mousemove',  onMouseMove);
  window.addEventListener('mouseup',    onMouseUp);
  const wrap = board.parentElement;
  wrap.addEventListener('mousemove', e => updateFakeCursor(e.clientX, e.clientY));
  wrap.addEventListener('mouseleave', () => {
    if (fakeCursor) fakeCursor.style.display = 'none';
    if (!invertActive) board.parentElement.style.cursor = '';
  });
  wrap.addEventListener('touchstart', onTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  onTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   onTouchEnd);
}

function onBoardPointerDownPickVs(e) {
  if (!e.isPrimary) return;
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  onMouseDown({ clientX: e.clientX, clientY: e.clientY, target: e.target, button: 0 });
  if (dragging) {
    e.preventDefault();
    suppressMouseDownPickUntil = Date.now() + 650;
  }
}

function attachRotateListeners() {
  board.addEventListener('contextmenu', onContextMenu);
  board.addEventListener('touchend',    onDoubleTap);
}

function onContextMenu(e) {
  e.preventDefault();
  const el = e.target.closest('.piece');
  if (!el) return;
  const index = Number(el.dataset.index);
  if (pieceStates[index]?.lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function onDoubleTap(e) {
  const touch = e.changedTouches[0];
  const el    = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.piece');
  if (!el) return;
  const now  = Date.now();
  const same = lastTap.el === el && (now - lastTap.time) < 300;
  lastTap    = { time: now, el };
  if (!same) return;
  e.preventDefault();
  const index = Number(el.dataset.index);
  if (pieceStates[index]?.lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function rotateAtIndex(index) {
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];
  const newRot  = ((pieceStates[index].rotation ?? 0) + 90) % 360;
  const { _displayW: dW, _displayH: dH } = meta;

  if (indices.length === 1) {
    pieceStates[index].rotation = newRot;
    movePieceEl(index, pieceStates[index].x, pieceStates[index].y);
    updateVSPieceRotation(roomId, myBoardKey, index, newRot);
    return;
  }

  const cx = indices.reduce((s, i) => s + pieceStates[i].x + dW / 2, 0) / indices.length;
  const cy = indices.reduce((s, i) => s + pieceStates[i].y + dH / 2, 0) / indices.length;
  const positions = [];
  indices.forEach(i => {
    const px   = pieceStates[i].x + dW / 2;
    const py   = pieceStates[i].y + dH / 2;
    const newX = cx - (py - cy) - dW / 2;
    const newY = cy + (px - cx) - dH / 2;
    pieceStates[i].x        = newX;
    pieceStates[i].y        = newY;
    pieceStates[i].rotation = newRot;
    movePieceEl(i, newX, newY);
    positions.push({ index: i, x: newX, y: newY });
  });
  updateVSGroupRotationAndPositions(roomId, myBoardKey, positions, newRot);
}

function onMouseDown(e) {
  if (Date.now() < suppressMouseDownPickUntil) return;
  let el;
  if (invertActive) {
    const { clientX, clientY } = mirrorCoords(e.clientX, e.clientY);
    el = document.elementFromPoint(clientX, clientY)?.closest('.piece');
  } else {
    el = resolvePiecePickVs(e.target, e.clientX, e.clientY);
  }
  if (!el || el.classList.contains('solved')) return;
  const index = Number(el.dataset.index);

  if (faceDownPieces.has(index)) {
    setFaceDown(index, false);
    return;
  }
  const state = pieceStates[index];
  if (state.lockedBy && state.lockedBy !== playerId) return;
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];
  if (indices.some(i => pieceStates[i].lockedBy && pieceStates[i].lockedBy !== playerId)) return;
  const boardRect = board.getBoundingClientRect();
  const anchorX   = pieceStates[index].x;
  const anchorY   = pieceStates[index].y;
  const relOffsets = {};
  indices.forEach(i => {
    relOffsets[i] = { dx: pieceStates[i].x - anchorX, dy: pieceStates[i].y - anchorY };
  });
  const rawX0 = (clientX - boardRect.left) / scale;
  const rawY0 = (clientY - boardRect.top)  / scale;
  dragging = { indices, anchorIndex: index, relOffsets, locked: false,
    invertAnchorX: anchorX, invertAnchorY: anchorY, invertLastX: rawX0, invertLastY: rawY0 };
}

function onMouseMove(e) {
  if (!dragging) return;
  const { indices, relOffsets } = dragging;
  if (!dragging.locked) {
    dragging.locked = true;
    lockVSGroup(roomId, myBoardKey, indices, playerId);
    indices.forEach(i => { pieceStates[i].lockedBy = playerId; });
    indices.forEach(i => {
      pieceEls[i]?.classList.add('dragging');
      if (pieceEls[i]) pieceEls[i].style.zIndex = 1000;
    });
  }
  const boardRect = board.getBoundingClientRect();
  const { clientX: cx, clientY: cy } = mirrorCoords(e.clientX, e.clientY);
  const rawX = (cx - boardRect.left) / scale;
  const rawY = (cy - boardRect.top)  / scale;
  const dx = rawX - dragging.invertLastX;
  const dy = rawY - dragging.invertLastY;
  dragging.invertAnchorX += dx;
  dragging.invertAnchorY += dy;
  dragging.invertLastX = rawX;
  dragging.invertLastY = rawY;
  const anchorX = dragging.invertAnchorX;
  const anchorY = dragging.invertAnchorY;
  const positions = [];
  indices.forEach(i => {
    const x = anchorX + relOffsets[i].dx;
    const y = anchorY + relOffsets[i].dy;
    pieceStates[i].x = x;
    pieceStates[i].y = y;
    movePieceEl(i, x, y);
    positions.push({ index: i, x, y });
  });
  updateVSGroupPosition(roomId, myBoardKey, positions);
}

async function onMouseUp(e) {
  if (!dragging) return;
  const { indices, anchorIndex, locked } = dragging;
  dragging = null;
  indices.forEach(i => {
    pieceEls[i]?.classList.remove('dragging');
    if (pieceEls[i]) pieceEls[i].style.zIndex = '';
  });
  if (!locked) return;
  const snap = findNeighbourSnap(indices);
  if (snap) {
    const { cols, _displayW: dW, _displayH: dH } = meta;
    const neighbourGroupIndices = pieceGroup[snap.neighbourIndex]
      ? [...groups[pieceGroup[snap.neighbourIndex]]]
      : [snap.neighbourIndex];
    const allIndices = [...new Set([...indices, ...neighbourGroupIndices])];
    const anchorIdx = snap.neighbourIndex;
    const anchorCol = anchorIdx % cols;
    const anchorRow = Math.floor(anchorIdx / cols);
    const aX = pieceStates[anchorIdx].x;
    const aY = pieceStates[anchorIdx].y;
    const rot = pieceStates[snap.neighbourIndex].rotation ?? 0;
    const positions = [];
    allIndices.forEach(i => {
      const iCol = i % cols, iRow = Math.floor(i / cols);
      const dcI = iCol - anchorCol, drI = iRow - anchorRow;
      let ox, oy;
      if (rot === 0)        { ox =  dcI * dW; oy =  drI * dH; }
      else if (rot === 90)  { ox = -drI * dH; oy =  dcI * dW; }
      else if (rot === 180) { ox = -dcI * dW; oy = -drI * dH; }
      else                  { ox =  drI * dH; oy = -dcI * dW; }
      const x = aX + ox, y = aY + oy;
      pieceStates[i] = { ...pieceStates[i], x, y, lockedBy: null };
      movePieceEl(i, x, y);
      positions.push({ index: i, x, y });
    });
    mergeGroups(allIndices);
    const gid = pieceGroup[allIndices[0]];
    await writeVSSnap(roomId, myBoardKey, positions, gid);
    checkSolvedState();
    checkPowerupTrigger(allIndices);
    updateMyProgress();
    checkCompletion();
  } else {
    await unlockVSGroup(roomId, myBoardKey, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    if (dragging) {
      if (dragging.locked) unlockVSGroup(roomId, myBoardKey, dragging.indices);
      dragging.indices.forEach(i => { pieceEls[i]?.classList.remove('dragging'); if (pieceEls[i]) pieceEls[i].style.zIndex = ''; });
      dragging = null;
    }
    pinch = { dist0: touchDist(e.touches), scale0: scale };
    e.preventDefault(); return;
  }
  if (pinch) return;
  if (typeof PointerEvent === 'function' && dragging) {
    e.preventDefault();
    return;
  }
  const touch = e.touches[0];
  const root = touch.target?.nodeType === Node.TEXT_NODE ? touch.target.parentElement : touch.target;
  onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, target: root, button: 0 });
  if (dragging) {
    e.preventDefault();
    suppressMouseDownPickUntil = Date.now() + 650;
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const raw = pinch.scale0 * (touchDist(e.touches) / pinch.dist0);
    applyScale(Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw))); return;
  }
  if (!dragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchEnd(e) {
  if (pinch && e.touches.length < 2) { pinch = null; return; }
  if (!dragging) return;
  const touch = e.changedTouches[0];
  onMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
}

function touchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function applyScale(s) {
  scale = s;
  board.style.transform = scale === 1 ? '' : `scale(${scale})`;
  board.style.marginRight  = scale > 1 ? BOARD_W * (scale - 1) + 'px' : '';
  board.style.marginBottom = scale > 1 ? BOARD_H * (scale - 1) + 'px' : '';
}

// ── Chaos mode powerups ───────────────────────────────────────────────────────

function createPowerupMarker(index, type, x, y) {
  const ICONS = { bw: '👁', invert: '🔄', scramble: '💥' };
  const marker = document.createElement('div');
  marker.className = `powerup-marker powerup-${type}`;
  marker.dataset.index = index;
  marker.textContent = ICONS[type] ?? '⚡';
  marker.style.left = x + 'px';
  marker.style.top  = y + 'px';
  return marker;
}

function renderOppPowerupMarkers() {
  if (!oppBoard) return;
  Object.entries(powerupPieces).forEach(([idxStr, type]) => {
    const i = Number(idxStr);
    if (oppPieceStates[i]?.solved) return;
    const state = oppPieceStates[i];
    if (!state) return;
    const marker = createPowerupMarker(i, type, state.x, state.y);
    marker.className = `powerup-marker powerup-${type} opp-powerup-marker`;
    oppBoard.appendChild(marker);
    oppPowerupMarkerEls[i] = marker;
  });
}

function getNeighbours(idx) {
  const { cols, rows } = meta;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  return [
    row > 0          ? (row - 1) * cols + col : -1, // top
    row < rows - 1   ? (row + 1) * cols + col : -1, // bottom
    col > 0          ? row * cols + (col - 1) : -1, // left
    col < cols - 1   ? row * cols + (col + 1) : -1, // right
  ];
}

function checkPowerupTrigger(mergedIndices) {
  if (!meta.chaosMode) return;
  mergedIndices.forEach(idx => {
    if (powerupPieces[idx] === undefined) return;
    if (earnedPowerups.has(idx)) return;
    // Check all 4 neighbours are in the same group as this piece
    const myGroup = pieceGroup[idx];
    if (!myGroup) return;
    const neighbours = getNeighbours(idx);
    const allNeighboursSnapped = neighbours.every(n => {
      if (n === -1) return true; // board edge counts as satisfied
      return pieceGroup[n] === myGroup || pieceStates[n]?.solved;
    });
    if (!allNeighboursSnapped) return;
    earnedPowerups.add(idx);
    firePowerup(powerupPieces[idx], idx);
  });
}

async function firePowerup(type, pieceIndex) {
  const targetKey = meta.teamMode ? oppTeamId : oppId;
  if (!targetKey) return;
  const effect = { type, fromPlayer: playerId };

  effect.sentAt = Date.now();
  if (type === 'bw' || type === 'invert' || type === 'flip') {
    effect.expiresAt = Date.now() + 20000;
  }
  if (type === 'shake') {
    effect.expiresAt = Date.now() + 10000;
  }

  if (type === 'scramble') {
    const targets = Object.keys(oppPieceStates)
      .map(Number)
      .filter(i => !oppPieceStates[i]?.solved && !oppPieceStates[i]?.groupId);
    const positions = {};
    targets.forEach(i => {
      positions[i] = {
        x: Math.random() * (BOARD_W - meta._displayW),
        y: Math.random() * (BOARD_H - meta._displayH),
      };
    });
    effect.positions = positions;
  }

  if (type === 'shuffle') {
    const groupSizes = {};
    Object.values(oppPieceStates).forEach(p => {
      if (p?.groupId) groupSizes[p.groupId] = (groupSizes[p.groupId] ?? 0) + 1;
    });
    const grouped = Object.keys(oppPieceStates)
      .map(Number)
      .filter(i => {
        const p = oppPieceStates[i];
        return p?.groupId && !p?.solved && (groupSizes[p.groupId] ?? 0) > 1;
      });
    const positions = {};
    grouped.forEach(i => {
      positions[i] = {
        x: Math.random() * (BOARD_W - meta._displayW),
        y: Math.random() * (BOARD_H - meta._displayH),
      };
    });
    effect.positions = positions;
  }

  await writeVSPowerupEarned(roomId, myBoardKey, pieceIndex);
  await writeVSEffect(roomId, targetKey, effect);

  const SENT_NAMES = { bw: 'Grayscale', invert: 'Invert', scramble: 'Scramble', flip: 'Flip', shake: 'Shake', shuffle: 'Shuffle' };
  showPowerupToast(`🎉 ${SENT_NAMES[type] ?? type} sent!`, false);

  // Sender sees the effect on opponent's board for visual feedback
  if (oppBoard) {
    if (type === 'bw')   { oppBoard.classList.add('board-grayscale');              setTimeout(() => oppBoard.classList.remove('board-grayscale'), 20000); }
    if (type === 'flip') { oppBoard.classList.add('board-flip');                   setTimeout(() => oppBoard.classList.remove('board-flip'),      20000); }
    if (type === 'shake'){ oppBoard.parentElement.classList.add('board-shake');    setTimeout(() => oppBoard.parentElement.classList.remove('board-shake'), 10000); }
  }

  // Hide my marker + glow
  if (powerupMarkerEls[pieceIndex]) powerupMarkerEls[pieceIndex].style.display = 'none';
  if (pieceEls[pieceIndex]) pieceEls[pieceIndex].classList.remove(`powerup-glow-${type}`);
  // Hide opp's marker + glow on their view
  if (oppPowerupMarkerEls[pieceIndex]) oppPowerupMarkerEls[pieceIndex].style.display = 'none';
  if (oppPieceEls[pieceIndex]) oppPieceEls[pieceIndex].classList.remove(`powerup-glow-${type}`);
}

function applyEffect(effect) {
  if (!effect?.type) return;
  // Ignore effects sent before this game started (onChildAdded replays old data)
  if (effect.sentAt && startedAt && effect.sentAt < startedAt) return;
  const NAMES = { bw: 'Grayscale', invert: 'Inverted Controls', scramble: 'Scramble', flip: 'Flipped!', shake: 'Shake!', shuffle: 'Shuffled!' };
  showPowerupToast(`😱 ${NAMES[effect.type] ?? effect.type}${effect.expiresAt ? ' — 30s!' : '!'}`, true);

  if (effect.type === 'bw') {
    // Extend if already active — always use the furthest expiry
    const expiresAt = Math.max(effect.expiresAt, activeEffects.bwExpiresAt ?? 0);
    activeEffects.bwExpiresAt = expiresAt;
    board.classList.add('board-grayscale');
    clearTimeout(activeEffects.bwTimer);
    activeEffects.bwTimer = setTimeout(() => {
      board.classList.remove('board-grayscale');
      activeEffects.bwExpiresAt = 0; updateEffectTimers();
    }, Math.max(0, expiresAt - Date.now()));
  }

  if (effect.type === 'invert') {
    // Extend if already active — always use the furthest expiry
    const expiresAt = Math.max(effect.expiresAt, activeEffects.invertExpiresAt ?? 0);
    activeEffects.invertExpiresAt = expiresAt;
    invertActive = true;
    syncCursorVisibility();
    clearTimeout(activeEffects.invertTimer);
    activeEffects.invertTimer = setTimeout(() => {
      invertActive = false;
      activeEffects.invertExpiresAt = 0;
      syncCursorVisibility();
      updateEffectTimers();
    }, Math.max(0, expiresAt - Date.now()));
  }

  if (effect.type === 'scramble' && effect.positions) {
    const batchPositions = [];
    Object.entries(effect.positions).forEach(([idxStr, pos]) => {
      const i = Number(idxStr);
      if (pieceStates[i]?.solved || pieceStates[i]?.groupId) return;
      pieceStates[i].x = pos.x;
      pieceStates[i].y = pos.y;
      movePieceEl(i, pos.x, pos.y);
      setFaceDown(i, true);
      batchPositions.push({ index: i, x: pos.x, y: pos.y });
    });
    if (batchPositions.length && amTeamLeader) updateVSGroupPosition(roomId, myBoardKey, batchPositions);
  }

  if (effect.type === 'flip') {
    const expiresAt = Math.max(effect.expiresAt, activeEffects.flipExpiresAt ?? 0);
    activeEffects.flipExpiresAt = expiresAt;
    board.classList.add('board-flip');
    clearTimeout(activeEffects.flipTimer);
    activeEffects.flipTimer = setTimeout(() => {
      board.classList.remove('board-flip');
      activeEffects.flipExpiresAt = 0;
      updateEffectTimers();
    }, Math.max(0, expiresAt - Date.now()));
  }

  if (effect.type === 'shake') {
    const expiresAt = Math.max(effect.expiresAt, activeEffects.shakeExpiresAt ?? 0);
    activeEffects.shakeExpiresAt = expiresAt;
    board.parentElement.classList.add('board-shake');
    clearTimeout(activeEffects.shakeTimer);
    activeEffects.shakeTimer = setTimeout(() => {
      board.parentElement.classList.remove('board-shake');
      activeEffects.shakeExpiresAt = 0;
      updateEffectTimers();
    }, Math.max(0, expiresAt - Date.now()));
  }

  if (effect.type === 'shuffle' && effect.positions) {
    const batchPositions = [];
    Object.entries(effect.positions).forEach(([idxStr, pos]) => {
      const i = Number(idxStr);
      if (pieceStates[i]?.solved) return;
      const oldGroup = pieceGroup[i];
      if (oldGroup && groups[oldGroup]) {
        groups[oldGroup].delete(i);
        if (groups[oldGroup].size === 0) delete groups[oldGroup];
      }
      pieceGroup[i] = null;
      pieceStates[i] = { ...pieceStates[i], x: pos.x, y: pos.y, groupId: null, lockedBy: null };
      movePieceEl(i, pos.x, pos.y);
      batchPositions.push({ index: i, x: pos.x, y: pos.y });
    });
    if (batchPositions.length && amTeamLeader) writeVSShufflePositions(roomId, myBoardKey, batchPositions);
  }

  updateEffectTimers();
}

function setFaceDown(index, faceDown) {
  const el = pieceEls[index];
  if (!el) return;
  if (faceDown) {
    faceDownPieces.add(index);
    el.classList.add('face-down');
  } else {
    faceDownPieces.delete(index);
    el.classList.remove('face-down');
  }
}

const powerupToastEl  = document.getElementById('powerup-toast');
const effectTimersEl  = document.getElementById('vs-effect-timers');
let toastTimer = null;

const EFFECT_TIMER_DEFS = [
  { key: 'bw',     label: 'Grayscale',  color: '#6b7280', bar: '#9ca3af', duration: 20000 },
  { key: 'invert', label: 'Invert',     color: '#7c3aed', bar: '#a78bfa', duration: 20000 },
  { key: 'flip',   label: 'Flip',       color: '#ef4444', bar: '#f87171', duration: 20000 },
  { key: 'shake',  label: 'Shake',      color: '#ea580c', bar: '#fb923c', duration: 10000 },
];

function updateEffectTimers() {
  if (!effectTimersEl) return;
  const now    = Date.now();
  const active = EFFECT_TIMER_DEFS.filter(d => (activeEffects[d.key + 'ExpiresAt'] ?? 0) > now);
  effectTimersEl.style.display = active.length ? '' : 'none';
  EFFECT_TIMER_DEFS.forEach(d => { document.getElementById('vset-' + d.key)?.remove(); });
  active.forEach(d => {
    const item = document.createElement('div');
    item.className = 'vs-effect-item';
    item.id = 'vset-' + d.key;
    item.innerHTML = `<div class="vs-effect-dot" style="background:${d.color}"></div>`
      + `<span>${d.label}</span>`
      + `<div class="vs-effect-track"><div class="vs-effect-fill" id="vsef-${d.key}" style="background:${d.bar}"></div></div>`
      + `<span class="vs-effect-time" id="vset-time-${d.key}"></span>`;
    effectTimersEl.appendChild(item);
  });
}

setInterval(() => {
  if (!effectTimersEl) return;
  const now = Date.now();
  EFFECT_TIMER_DEFS.forEach(d => {
    const expiresAt = activeEffects[d.key + 'ExpiresAt'] ?? 0;
    const fillEl = document.getElementById('vsef-' + d.key);
    const timeEl = document.getElementById('vset-time-' + d.key);
    if (!fillEl || !timeEl) return;
    const ms = Math.max(0, expiresAt - now);
    fillEl.style.width = Math.min(100, (ms / d.duration) * 100) + '%';
    timeEl.textContent = Math.ceil(ms / 1000) + 's';
  });
}, 200);

function showPowerupToast(msg, isReceived) {
  if (!powerupToastEl) return;
  powerupToastEl.textContent = msg;
  powerupToastEl.style.display = '';
  powerupToastEl.style.background = isReceived ? 'rgba(185,28,28,0.9)' : 'rgba(5,150,105,0.9)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { powerupToastEl.style.display = 'none'; }, 2500);
}

// ── Snap / merge ──────────────────────────────────────────────────────────────

function findNeighbourSnap(dragIndices) {
  const { cols, rows, _displayW: dW, _displayH: dH, edges } = meta;
  const threshold = Math.max(40, Math.min(dW, dH) * 0.4);
  const dragSet   = new Set(dragIndices);

  const checks = [
    { dc:  0, dr: -1, myEdge: 'idTop',    neighbourEdge: 'idBottom' },
    { dc:  0, dr:  1, myEdge: 'idBottom', neighbourEdge: 'idTop'    },
    { dc: -1, dr:  0, myEdge: 'idLeft',   neighbourEdge: 'idRight'  },
    { dc:  1, dr:  0, myEdge: 'idRight',  neighbourEdge: 'idLeft'   },
  ];

  for (const i of dragIndices) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const eI  = edges[i];

    for (const { dc, dr, myEdge, neighbourEdge } of checks) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;

      const nIdx = nRow * cols + nCol;
      if (dragSet.has(nIdx)) continue;

      const eN = edges[nIdx];
      if (eI[myEdge] === 0 || eI[myEdge] !== eN[neighbourEdge]) continue;

      const rot = pieceStates[i].rotation ?? 0;
      if (rot !== (pieceStates[nIdx].rotation ?? 0)) continue;

      const actualDx = pieceStates[i].x - pieceStates[nIdx].x;
      const actualDy = pieceStates[i].y - pieceStates[nIdx].y;

      let expectedDx, expectedDy;
      if (rot === 0)        { expectedDx = -dc * dW;  expectedDy = -dr * dH; }
      else if (rot === 90)  { expectedDx =  dr * dH;  expectedDy = -dc * dW; }
      else if (rot === 180) { expectedDx =  dc * dW;  expectedDy =  dr * dH; }
      else                  { expectedDx = -dr * dH;  expectedDy =  dc * dW; }

      const dist = Math.hypot(actualDx - expectedDx, actualDy - expectedDy);
      if (dist <= threshold) {
        return {
          dragIndex:      i,
          neighbourIndex: nIdx,
          targetX:        pieceStates[nIdx].x + expectedDx,
          targetY:        pieceStates[nIdx].y + expectedDy,
        };
      }
    }
  }
  return null;
}

function checkSolvedState() {
  for (let i = 0; i < totalPieces; i++) {
    const gid = pieceGroup[i];
    if (!gid) continue;
    if (groups[gid]?.size === totalPieces) {
      const updates = {};
      groups[gid].forEach(j => {
        pieceStates[j] = { ...pieceStates[j], solved: true, lockedBy: null };
        pieceEls[j]?.classList.add('solved');
        updates[j] = { x: pieceStates[j].x, y: pieceStates[j].y };
      });
      solvedCount = totalPieces;
      solveVSGroup(roomId, myBoardKey, updates);
      return;
    }
    return;
  }
}

function mergeGroups(indices) {
  const existingIds = [...new Set(indices.map(i => pieceGroup[i]).filter(Boolean))];
  const keepId = existingIds[0] ?? crypto.randomUUID();
  if (!groups[keepId]) groups[keepId] = new Set();
  indices.forEach(i => {
    const oldId = pieceGroup[i];
    if (oldId && oldId !== keepId && groups[oldId]) {
      groups[oldId].forEach(j => { groups[keepId].add(j); pieceGroup[j] = keepId; });
      delete groups[oldId];
    } else {
      groups[keepId].add(i);
      pieceGroup[i] = keepId;
    }
  });
}

function reconstructGroups() {
  pieceStates.forEach((p, i) => {
    if (p.groupId) {
      if (!groups[p.groupId]) groups[p.groupId] = new Set();
      groups[p.groupId].add(i);
      pieceGroup[i] = p.groupId;
    }
  });
}

// ── Remote updates ────────────────────────────────────────────────────────────

function applyRemoteUpdate(index, data) {
  if (dragging && dragging.indices.includes(index)) return;

  const wasGroupId = pieceStates[index]?.groupId;
  const lockedBy   = Object.prototype.hasOwnProperty.call(data, 'lockedBy')
    ? data.lockedBy : null;
  const incoming = { ...data, lockedBy };
  if (incoming.lockedBy === playerId && !dragging?.indices.includes(index)) {
    delete incoming.lockedBy;
  }
  pieceStates[index] = { ...pieceStates[index], ...incoming };
  movePieceEl(index, data.x, data.y);

  if (data.groupId && data.groupId !== wasGroupId) {
    const groupMembers = pieceStates
      .map((p, i) => p.groupId === data.groupId ? i : -1)
      .filter(i => i >= 0);
    if (groupMembers.length > 1) mergeGroups(groupMembers);
    updateMyProgress();
  }

  if (data.solved) {
    pieceEls[index]?.classList.add('solved');
    if (faceDownPieces.has(index)) setFaceDown(index, false);
    solvedCount = pieceStates.filter(p => p.solved).length;
    updateMyProgress();
    checkCompletion();
  }
}

// ── Progress / completion ─────────────────────────────────────────────────────

function updateMyProgress() {
  const placed = pieceStates.filter((p, i) => pieceGroup[i] || p.solved).length;
  const pct = totalPieces > 0 ? Math.round(placed / totalPieces * 100) : 0;
  vspMeFill.style.width = pct + '%';
  vspMePct.textContent  = pct + '%';
}

function checkCompletion() {
  const done = solvedCount >= totalPieces ||
    (() => {
      const gids = new Set(pieceGroup.filter(Boolean));
      return gids.size === 1 && groups[[...gids][0]]?.size === totalPieces;
    })();
  if (!done || winnerDeclared) return;
  winnerDeclared = true;

  stopTimer();
  const finishedAt = Date.now();
  const secs = Math.floor((finishedAt - startedAt) / 1000);
  setVSFinished(roomId, playerId, finishedAt);
  if (meta.teamMode && myTeamId) {
    setVSWinnerTeam(roomId, myTeamId, secs);
  } else {
    setVSWinner(roomId, playerId, secs);
  }
}

function showResult(room) {
  stopTimer();
  const { meta: m, players = {} } = room;

  vsResult.style.display = 'flex';
  vsGame.style.opacity   = '0.4';

  if (m.teamMode && m.winnerTeamId) {
    // Team mode result
    const myT   = players[playerId]?.teamId || myTeamId || 'A';
    const iWon  = myT === m.winnerTeamId;
    const winnerName = m.teamNames?.[m.winnerTeamId] || `Team ${m.winnerTeamId}`;
    const loserTeam  = m.winnerTeamId === 'A' ? 'B' : 'A';
    const loserName  = m.teamNames?.[loserTeam] || `Team ${loserTeam}`;

    vsResultTitle.textContent = iWon ? `🏆 ${winnerName} Won!` : `😔 ${loserName} Lost`;
    const secs = m.winnerSecs;
    vsResultTimes.textContent = secs
      ? `${winnerName} finished in ${formatTime(secs)}`
      : `${winnerName} finished first!`;
    vsScoreBoard.style.display = 'none';
  } else {
    // 1v1 result
    const winnerId = m.winner;
    const iWon     = winnerId === playerId;
    const oppIdRes = Object.keys(players).find(id => id !== playerId);

    vsResultTitle.textContent = iWon ? '🏆 You Won!' : '😔 You Lost';

    const lines = [];
    Object.entries(players).forEach(([pid, p]) => {
      if (p.finishedAt && startedAt) {
        const s = Math.floor((p.finishedAt - startedAt) / 1000);
        lines.push(`${pid === playerId ? '⭐ ' : ''}${p.name}: ${formatTime(s)}`);
      }
    });
    vsResultTimes.textContent = lines.join('  ·  ');

    if (oppIdRes) {
      const wins = recordWin(winnerId, oppIdRes);
      vsScoreMe.textContent  = wins[playerId]   ?? 0;
      vsScoreOpp.textContent = wins[oppIdRes]   ?? 0;
      vsScoreBoard.style.display = '';
    }
  }
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = formatTime(secs);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Help / Peek ───────────────────────────────────────────────────────────────

function setupHelp() {
  const controls = [
    { key: 'Drag',           desc: 'Move a piece or connected group' },
    { key: 'Drop near edge', desc: 'Pieces snap together automatically' },
    { key: 'Pinch (mobile)', desc: 'Zoom in / out' },
    { key: 'Scroll',         desc: 'Pan the board' },
  ];
  helpList.innerHTML = controls.map(c =>
    `<li><strong>${c.key}</strong> — ${c.desc}</li>`
  ).join('');
  helpBtn.addEventListener('click', () => { helpModal.style.display = 'flex'; });
  helpClose.addEventListener('click', () => { helpModal.style.display = 'none'; });
  helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.style.display = 'none'; });
}

function setupPeek() {
  boxCoverImg.src = meta.imageUrl;
  const toggle = () => boxCover.classList.toggle('show');
  const hide   = () => boxCover.classList.remove('show');
  peekBtn.addEventListener('click', toggle);
  boxCover.addEventListener('click', hide);
}

// ── Rematch ───────────────────────────────────────────────────────────────────

function isTeamModeRoom() { return Boolean(meta?.teamMode); }

async function handleRematchButtonClick() {
  if (isTeamModeRoom()) {
    if (creatorPlayerId && creatorPlayerId === playerId) {
      if (!canStartRematch || vsRematchBtn.disabled) return;
      vsRematchBtn.disabled = true;
      vsRematchBtn.textContent = 'Creating rematch…';
      await createRematchRoomTeam();
    } else {
      await handleRematchClickTeam();
    }
  } else {
    await handleRematchClick1v1();
  }
}

function updateRematchUI(rematchOffers, players) {
  if (isTeamModeRoom()) return updateRematchUITeam(rematchOffers, players);
  return updateRematchUI1v1(rematchOffers, players);
}

// ── 1v1 rematch ───────────────────────────────────────────────────────────────

async function handleRematchClick1v1() {
  if (rematchOffered) return;
  rematchOffered = true;
  vsRematchBtn.disabled = true;
  vsRematchBtn.textContent = 'Waiting for opponent…';
  await offerVSRematch(roomId, playerId);
}

function updateRematchUI1v1(rematchOffers, players) {
  if (!vsRematchBtn) return;

  const iOffered    = !!rematchOffers[playerId];
  const oppIdR      = Object.keys(players).find(id => id !== playerId);
  const oppOffered  = oppIdR ? !!rematchOffers[oppIdR] : false;
  const bothOffered = iOffered && oppOffered;

  if (bothOffered && !rematchOffered) rematchOffered = true;

  if (bothOffered) {
    vsRematchBtn.disabled = true;
    vsRematchBtn.textContent = 'Creating rematch…';
    vsRematchBtn.classList.remove('rematch-accept');
    const ids = Object.keys(players).sort();
    if (ids[0] === playerId && !createRematchRoom1v1._called) {
      createRematchRoom1v1._called = true;
      createRematchRoom1v1();
    }
    return;
  }

  if (iOffered) {
    vsRematchBtn.disabled = true;
    vsRematchBtn.textContent = 'Waiting for opponent…';
    vsRematchBtn.classList.remove('rematch-accept');
    return;
  }

  if (oppOffered) {
    vsRematchBtn.disabled = false;
    vsRematchBtn.textContent = '✅ Accept Rematch!';
    vsRematchBtn.classList.add('rematch-accept');
    return;
  }

  vsRematchBtn.disabled = false;
  vsRematchBtn.textContent = '⚡ Rematch';
  vsRematchBtn.classList.remove('rematch-accept');
}

async function createRematchRoom1v1() {
  const pieces = meta?.pieces ?? 100;
  const hard   = meta?.hardMode ?? false;
  const chaos  = meta?.chaosMode ?? false;
  try {
    const res = await fetch(`/api/vs-create?pieces=${pieces}&hard=${hard}&chaos=${chaos}&json=1`);
    const { roomId: newRoom } = await res.json();
    if (!newRoom) return;

    const snap = await loadVSRoom(roomId);
    const currentPlayers = snap.players || {};
    await Promise.all(Object.entries(currentPlayers).map(([pid, p]) =>
      joinVSRoom(newRoom, pid, p.name, p.color).then(() => setVSReady(newRoom, pid))
    ));
    await setVSPlaying(newRoom);
    await setVSRematch(roomId, newRoom);
  } catch {
    vsRematchBtn.disabled = false;
    vsRematchBtn.textContent = '⚡ Rematch';
    rematchOffered = false;
  }
}

// ── Team rematch (opt-in + creator-only start) ────────────────────────────────

async function handleRematchClickTeam() {
  if (creatorPlayerId && creatorPlayerId === playerId) return;
  if (rematchOffered) return;
  rematchOffered = true;
  vsRematchBtn.disabled = true;
  vsRematchBtn.textContent = '✅ Rematch Requested';
  await offerVSRematch(roomId, playerId);
}

function updateRematchUITeam(rematchOffers, players) {
  if (!vsRematchBtn) return;

  const iOffered   = !!rematchOffers[playerId];
  rematchOffered   = iOffered;
  const presentIds = Object.keys(players || {});
  const isCreator  = creatorPlayerId && creatorPlayerId === playerId;
  const optedIn    = presentIds.filter(pid => !!rematchOffers[pid]);
  const optedInOthers = optedIn.filter(pid => pid !== creatorPlayerId);

  canStartRematch = Boolean(isCreator && presentIds.length >= 2 && optedInOthers.length >= 1);

  if (currentRematchRoomId) {
    vsRematchBtn.disabled = true;
    vsRematchBtn.textContent = '⚡ Rematch in progress';
    vsRematchBtn.classList.remove('rematch-accept');
    return;
  }

  if (presentIds.length < 2) {
    vsRematchBtn.disabled = true;
    vsRematchBtn.textContent = 'Waiting for opponent…';
    vsRematchBtn.classList.remove('rematch-accept');
    return;
  }

  if (isCreator) {
    vsRematchBtn.disabled = !canStartRematch;
    vsRematchBtn.textContent = canStartRematch ? '⚡ Start Rematch' : 'Waiting for rematch requests…';
    vsRematchBtn.classList.remove('rematch-accept');
    return;
  }

  if (iOffered) {
    vsRematchBtn.disabled = true;
    vsRematchBtn.textContent = '✅ Rematch Requested';
    vsRematchBtn.classList.remove('rematch-accept');
    return;
  }

  vsRematchBtn.disabled = false;
  vsRematchBtn.textContent = '⚡ Request Rematch';
  vsRematchBtn.classList.remove('rematch-accept');
}

async function createRematchRoomTeam() {
  const pieces   = meta?.pieces ?? 100;
  const hard     = meta?.hardMode ?? false;
  const chaos    = meta?.chaosMode ?? false;
  const teamMode = true;
  try {
    const res = await fetch(`/api/vs-create?pieces=${pieces}&hard=${hard}&chaos=${chaos}&teamMode=${teamMode}&json=1`);
    const { roomId: newRoom } = await res.json();
    if (!newRoom) return;

    const snap = await loadVSRoom(roomId);
    const currentPlayers = snap.players || {};
    const offers = snap.meta?.rematchOffers || {};
    const optedIn = Object.keys(currentPlayers).filter(pid => !!offers[pid]);
    if (creatorPlayerId && !optedIn.includes(creatorPlayerId)) optedIn.push(creatorPlayerId);
    if (optedIn.length < 2) return;

    optedIn.sort((a, b) => {
      if (a === creatorPlayerId) return -1;
      if (b === creatorPlayerId) return 1;
      return a.localeCompare(b);
    });

    await Promise.all(optedIn.map(pid => {
      const p = currentPlayers[pid];
      return joinVSRoom(newRoom, pid, p.name, p.color)
        .then(() => p.teamId ? setVSTeamId(newRoom, pid, p.teamId) : Promise.resolve())
        .then(() => setVSReady(newRoom, pid));
    }));
    await setVSPlaying(newRoom);
    await setVSRematch(roomId, newRoom);
  } catch {
    vsRematchBtn.disabled = false;
    vsRematchBtn.textContent = '⚡ Rematch';
    rematchOffered = false;
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function setupChat() {
  const open  = () => { chatPanel.classList.add('open'); chatOpen = true; setChatBadge(0); };
  const close = () => { chatPanel.classList.remove('open'); chatOpen = false; };

  chatBtn.addEventListener('click', () => chatOpen ? close() : open());
  chatClose.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen) close(); });

  const send = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    const color = getPlayerColor(playerId);
    sendChatMessage(roomId, { playerId, name: playerName, color, text, ts: Date.now() });
  };
  chatSendBtn.addEventListener('click', send);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  chatPanel.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = getPlayerColor(playerId);
      sendChatMessage(roomId, { playerId, name: playerName, color, text: btn.dataset.emoji, ts: Date.now() });
    });
  });

  onChatMessages(roomId, msg => {
    appendChatMessage(msg);
    if (isSingleEmoji(msg.text)) spawnBoardEmoji(msg);
    if (!chatOpen && msg.playerId !== playerId) setChatBadge(chatUnread + 1);
  });
}

function setChatBadge(n) {
  chatUnread = n;
  let badge = chatBtn.querySelector('.chat-badge');
  if (n > 0) {
    if (!badge) { badge = document.createElement('div'); badge.className = 'chat-badge'; chatBtn.appendChild(badge); }
    badge.textContent = n > 9 ? '9+' : n;
  } else {
    badge?.remove();
  }
}

function appendChatMessage(msg) {
  const mine = msg.playerId === playerId;
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const emojiOnly = isSingleEmoji(msg.text);
  const el = document.createElement('div');
  el.className = 'chat-msg' + (mine ? ' mine' : '');
  el.innerHTML = `
    <div class="chat-msg-meta">
      ${!mine ? `<div class="chat-msg-dot" style="background:${msg.color}"></div>` : ''}
      <span>${mine ? 'You' : msg.name}</span>
      <span>${time}</span>
    </div>
    <div class="chat-msg-bubble${emojiOnly ? ' emoji-only' : ''}">${escapeHtml(msg.text)}</div>
  `;
  chatMessages.appendChild(el);
  while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function spawnBoardEmoji(msg) {
  // Sender sees emoji on opponent's board; receiver sees it on their own board
  const target = (msg.playerId === playerId) ? oppBoard : board;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0) return;
  for (let i = 0; i < 10; i++) {
    const x = rect.left + 40 + Math.random() * (rect.width  - 80);
    const y = rect.top  + 40 + Math.random() * (rect.height - 80);
    const el = document.createElement('div');
    el.className = 'board-emoji';
    el.textContent = msg.text;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.animationDelay = (i * 60) + 'ms';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

function isSingleEmoji(text) {
  return /^\p{Emoji_Presentation}$/u.test(text.trim()) || /^\p{Emoji}\uFE0F?$/u.test(text.trim());
}

function getAvatarText(name) {
  const text = String(name || '').trim();
  if (!text) return '?';
  const first = getFirstGrapheme(text);
  return isEmojiGrapheme(first) ? first : first.toUpperCase();
}

function getFirstGrapheme(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const part of seg.segment(text)) return part.segment;
  }
  return Array.from(text)[0] || '?';
}

function isEmojiGrapheme(ch) {
  return /\p{Extended_Pictographic}/u.test(ch);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  if (unsubRoom)    { unsubRoom();    unsubRoom    = null; }
  if (unsubPieces)  { unsubPieces();  unsubPieces  = null; }
  if (unsubOpp)     { unsubOpp();     unsubOpp     = null; }
  if (unsubEffects) { unsubEffects(); unsubEffects = null; }
  stopTimer();
  if (dragging?.locked) unlockVSGroup(roomId, myBoardKey, dragging.indices);
}
