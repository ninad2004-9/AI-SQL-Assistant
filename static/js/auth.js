// ─────────────────────────────────────────────────────────────────────────────
// QueryMind — Authentication & Landing Page Interaction Logic
// ─────────────────────────────────────────────────────────────────────────────

// ── Auth Modal Controls ──────────────────────────────────────────────────────
function openAuthModal(tab = 'login') {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    switchTab(tab);
    // Focus the primary input
    setTimeout(() => {
      const input = tab === 'login'
        ? document.getElementById('login-email')
        : document.getElementById('reg-name');
      input?.focus();
    }, 100);
  }
}

function closeAuthModal() {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  clearErrors();
}

function handleModalOverlayClick(e) {
  if (e.target.id === 'auth-modal-overlay') {
    closeAuthModal();
  }
}

// ── Watch Demo Modal Controls ────────────────────────────────────────────────
function openDemoModal() {
  const overlay = document.getElementById('demo-modal-overlay');
  if (overlay) overlay.classList.remove('hidden');
}

function closeDemoModal() {
  const overlay = document.getElementById('demo-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function handleDemoOverlayClick(e) {
  if (e.target.id === 'demo-modal-overlay') {
    closeDemoModal();
  }
}

// ── Tab Switching inside Auth Modal ──────────────────────────────────────────
function switchTab(tab) {
  const slider = document.getElementById('tab-slider');
  const loginPanel = document.getElementById('panel-login');
  const regPanel = document.getElementById('panel-register');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');

  if (!slider || !loginPanel || !regPanel) return;

  if (tab === 'login') {
    slider.classList.remove('right');
    loginPanel.classList.remove('hidden');
    regPanel.classList.add('hidden');
    tabLogin?.classList.add('active');
    tabReg?.classList.remove('active');
  } else {
    slider.classList.add('right');
    loginPanel.classList.add('hidden');
    regPanel.classList.remove('hidden');
    tabLogin?.classList.remove('active');
    tabReg?.classList.add('active');
  }
  clearErrors();
}

function clearErrors() {
  document.getElementById('login-error')?.classList.add('hidden');
  document.getElementById('reg-error')?.classList.add('hidden');
}

function setLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text)   text.style.opacity = loading ? '0' : '1';
  if (loader) loader.classList.toggle('hidden', !loading);
}

// ── Register ───────────────────────────────────────────────────────────────────
async function doRegister() {
  const name     = document.getElementById('reg-name')?.value.trim();
  const email    = document.getElementById('reg-email')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const errBox   = document.getElementById('reg-error');
  const btn      = document.getElementById('reg-btn');

  if (!name || !email || !password) {
    showError(errBox, 'Please fill in all fields.');
    return;
  }
  if (password.length < 6) {
    showError(errBox, 'Password must be at least 6 characters.');
    return;
  }

  setLoading(btn, true);
  try {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(errBox, data.detail || 'Registration failed.');
      return;
    }
    saveSession(data);
    window.location.href = '/app';
  } catch {
    showError(errBox, 'Network error. Please try again.');
  } finally {
    setLoading(btn, false);
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email    = document.getElementById('login-email')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  const errBox   = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) {
    showError(errBox, 'Please fill in all fields.');
    return;
  }

  setLoading(btn, true);
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(errBox, data.detail || 'Login failed.');
      return;
    }
    saveSession(data);
    window.location.href = '/app';
  } catch {
    showError(errBox, 'Network error. Please try again.');
  } finally {
    setLoading(btn, false);
  }
}

function showError(box, msg) {
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
  box.animate(
    [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
    { duration: 250 }
  );
}

function saveSession(data) {
  localStorage.setItem('qm_token', data.token);
  localStorage.setItem('qm_name',  data.name);
  localStorage.setItem('qm_email', data.email);
}

// ── Logged in UI state detection ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('qm_token');
  if (token) {
    // If logged in, customize top actions so users can easily jump to workspace
    const signinBtn = document.getElementById('btn-nav-signin');
    const ctaBtn = document.getElementById('btn-nav-cta');
    if (signinBtn) {
      signinBtn.textContent = 'Dashboard →';
      signinBtn.onclick = () => window.location.href = '/app';
    }
    if (ctaBtn) {
      const span = ctaBtn.querySelector('span');
      if (span) span.textContent = 'Open Workspace';
      ctaBtn.onclick = () => window.location.href = '/app';
    }
  }

  // Check URL hash for modal trigger (e.g. #login or #register)
  if (window.location.hash === '#login') {
    openAuthModal('login');
  } else if (window.location.hash === '#register') {
    openAuthModal('register');
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // ESC closes any open modal
  if (e.key === 'Escape') {
    closeAuthModal();
    closeDemoModal();
    return;
  }

  // Enter key submits active modal form
  if (e.key === 'Enter') {
    const authOverlay = document.getElementById('auth-modal-overlay');
    if (authOverlay && !authOverlay.classList.contains('hidden')) {
      const loginVisible = !document.getElementById('panel-login')?.classList.contains('hidden');
      if (loginVisible) doLogin(); else doRegister();
    }
  }
});

// ── Floating code snippets background animation ───────────────────────────────
const snippets = [
  'SELECT * FROM users',
  'WHERE revenue > 1000',
  'GROUP BY department',
  'ORDER BY created_at DESC',
  'INNER JOIN orders ON',
  'COUNT(DISTINCT id)',
  'LIMIT 10',
  'AVG(salary)',
  'LEFT JOIN customers',
  'HAVING COUNT(*) > 5',
  'INSERT INTO logs',
  'UPDATE products SET',
  'DELETE FROM sessions',
];

function spawnSnippet() {
  const floaters = document.getElementById('floaters');
  if (!floaters) return;
  const el = document.createElement('div');
  el.className = 'float-snippet';
  el.textContent = snippets[Math.floor(Math.random() * snippets.length)];
  el.style.left = (Math.random() * 95) + 'vw';
  el.style.animationDuration = (12 + Math.random() * 14) + 's';
  el.style.animationDelay = (Math.random() * 3) + 's';
  el.style.fontSize = (10 + Math.random() * 4) + 'px';
  floaters.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

for (let i = 0; i < 10; i++) setTimeout(spawnSnippet, i * 700);
setInterval(spawnSnippet, 2000);
