import { getWhatHappenedCopy } from './feedback-copy.js';

const FEEDBACK_TYPES = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'feedback', label: 'Feedback' },
];

function getContext() {
  const url = window.location.href;
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const puzzleId = params.get('id') || null;
  const roomId = params.get('room') || null;

  let screen = 'landing';
  if (path.includes('puzzle.html')) screen = 'puzzle';
  else if (path.includes('vs.html')) screen = 'vs';
  else if (path.includes('play.html')) screen = 'play-picker';
  else if (path.includes('rooms.html')) screen = 'rooms';
  else if (path.includes('vs-rooms.html')) screen = 'vs-rooms';

  const parts = [`Screen: ${screen}`];
  if (puzzleId) parts.push(`Puzzle: ${puzzleId}`);
  if (roomId) parts.push(`Room: ${roomId}`);

  return {
    url,
    path,
    puzzleId,
    roomId,
    screen,
    contextText: parts.join(' · '),
  };
}

function createLauncher() {
  const launcher = document.createElement('div');
  launcher.id = 'feedback-launcher';
  launcher.innerHTML = `
    <button id="feedback-btn" title="Bug / feedback">
      🐞
    </button>
  `;
  document.body.appendChild(launcher);
  return launcher;
}

function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'feedback-panel';
  panel.className = 'feedback-panel';

  const { contextText } = getContext();
  const { label, placeholder } = getWhatHappenedCopy('bug');

  panel.innerHTML = `
    <div class="feedback-header">
      <span>Bug / Feedback</span>
      <button id="feedback-close" class="icon-btn" aria-label="Close feedback form">✕</button>
    </div>
    <form id="feedback-form" class="feedback-form">
      <div class="feedback-type-row">
        ${FEEDBACK_TYPES.map(t => `
          <label>
            <input type="radio" name="fb-type" value="${t.value}" ${t.value === 'bug' ? 'checked' : ''} />
            <span>${t.label}</span>
          </label>
        `).join('')}
      </div>
      <label class="feedback-field">
        <span id="feedback-what-happened-label">${label}</span>
        <textarea id="feedback-message" rows="4" maxlength="1000"
          placeholder="${placeholder}"></textarea>
      </label>
      <label class="feedback-field">
        <span>How can we reach you? <span class="optional">(optional)</span></span>
        <input id="feedback-contact" type="text" maxlength="200" placeholder="Email, Discord, etc." />
      </label>
      <div class="feedback-context">
        <span class="feedback-context-label">Context</span>
        <span id="feedback-context-text">${contextText}</span>
      </div>
      <button type="submit" class="btn" id="feedback-submit">Send</button>
      <p class="status" id="feedback-status"></p>
    </form>
  `;

  document.body.appendChild(panel);
  return panel;
}

function syncWhatHappenedCopy(type) {
  const { label, placeholder } = getWhatHappenedCopy(type);
  const labelEl = document.getElementById('feedback-what-happened-label');
  const messageEl = document.getElementById('feedback-message');
  if (labelEl) labelEl.textContent = label;
  if (messageEl) messageEl.placeholder = placeholder;
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('feedback-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

function openPanel() {
  const panel = document.getElementById('feedback-panel');
  if (!panel) return;
  panel.classList.add('open');
  // Refresh context text in case the user navigated within the same page
  const { contextText } = getContext();
  const ctxEl = document.getElementById('feedback-context-text');
  if (ctxEl) ctxEl.textContent = contextText;
}

function closePanel() {
  const panel = document.getElementById('feedback-panel');
  if (!panel) return;
  panel.classList.remove('open');
}

async function submitFeedback(event) {
  event.preventDefault();
  const messageEl = document.getElementById('feedback-message');
  const contactEl = document.getElementById('feedback-contact');
  const submitBtn = document.getElementById('feedback-submit');

  if (!messageEl || !submitBtn) return;

  const message = messageEl.value.trim();
  if (!message) {
    setStatus('Please add a short description.', true);
    return;
  }

  const typeInput = document.querySelector('input[name="fb-type"]:checked');
  const type = typeInput ? typeInput.value : 'bug';
  const contact = contactEl ? contactEl.value.trim() : '';
  const ctx = getContext();

  submitBtn.disabled = true;
  setStatus('Sending...');

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        message,
        contact,
        context: ctx.contextText,
        url: ctx.url,
        path: ctx.path,
        puzzleId: ctx.puzzleId,
        roomId: ctx.roomId,
        screen: ctx.screen,
        userAgent: navigator.userAgent,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send feedback');
    }

    messageEl.value = '';
    if (contactEl) contactEl.value = contact;
    setStatus('Thank you! Your feedback was sent.');
    setTimeout(() => {
      setStatus('');
      closePanel();
    }, 2000);
  } catch (err) {
    console.error(err);
    setStatus('Could not send feedback. Please try again.', true);
  } finally {
    submitBtn.disabled = false;
  }
}

function initFeedbackWidget() {
  if (document.getElementById('feedback-launcher')) return;

  createLauncher();
  createPanel();

  const btn = document.getElementById('feedback-btn');
  const closeBtn = document.getElementById('feedback-close');
  const form = document.getElementById('feedback-form');

  if (btn) btn.addEventListener('click', () => {
    const panel = document.getElementById('feedback-panel');
    if (!panel) return;
    if (panel.classList.contains('open')) {
      closePanel();
    } else {
      openPanel();
    }
  });

  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  if (form) {
    // Swap textarea label/placeholder based on the selected radio type.
    form.addEventListener('change', (e) => {
      const target = e.target;
      if (!target || target.name !== 'fb-type') return;
      syncWhatHappenedCopy(target.value);
    });
    syncWhatHappenedCopy('bug'); // ensure correct initial copy
  }

  if (form) form.addEventListener('submit', submitFeedback);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFeedbackWidget);
} else {
  initFeedbackWidget();
}

