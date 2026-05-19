const INSTALL_DISMISS_KEY = 'jt-pwa-install-dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** Same signals as js/mobile-quality.js — home-screen install is for phones/tablets, not desktop. */
function isMobileInstallTarget() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  return coarse || mobileUa;
}

function shouldOfferInstall() {
  if (!isMobileInstallTarget()) return false;
  if (isStandalone()) return false;
  try {
    if (sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1') return false;
  } catch {
    /* ignore */
  }
  return true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* install/offline is optional */
    });
  });
}

function setupInstallPrompt() {
  if (!shouldOfferInstall()) return;

  let deferredPrompt = null;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.hidden = true;
  banner.innerHTML = `
    <p><strong>Install Jigsaw Together</strong> — add to your home screen for fullscreen play.</p>
    <div class="pwa-install-actions">
      <button type="button" class="btn btn-sm" id="pwa-install-btn">Install</button>
      <button type="button" class="btn btn-ghost btn-sm" id="pwa-install-dismiss">Not now</button>
    </div>
  `;

  const mount = () => {
    if (banner.isConnected) return;
    document.body.appendChild(banner);
  };

  const dismiss = () => {
    banner.hidden = true;
    try {
      sessionStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isMobileInstallTarget()) return;
    event.preventDefault();
    deferredPrompt = event;
    mount();
    banner.hidden = false;
  });

  banner.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.id === 'pwa-install-dismiss') {
      dismiss();
      return;
    }

    if (target.id !== 'pwa-install-btn' || !deferredPrompt) return;

    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    dismiss();
  });

  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isSafari = /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
  if (isMobileInstallTarget() && isIos && isSafari && !isStandalone()) {
    mount();
    banner.hidden = false;
    const installBtn = banner.querySelector('#pwa-install-btn');
    if (installBtn) {
      installBtn.textContent = 'How to install';
      installBtn.addEventListener('click', () => {
        const note = banner.querySelector('.pwa-ios-hint');
        if (note) {
          note.hidden = !note.hidden;
          return;
        }
        const hint = document.createElement('p');
        hint.className = 'pwa-ios-hint';
        hint.textContent = 'Tap Share, then “Add to Home Screen”.';
        banner.insertBefore(hint, banner.querySelector('.pwa-install-actions'));
      });
    }
  }
}

registerServiceWorker();
setupInstallPrompt();
