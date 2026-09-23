// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  const slider = document.getElementById('tab-slider');
  const loginPanel = document.getElementById('panel-login');
  const regPanel = document.getElementById('panel-register');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');

  if (tab === 'login') {
    slider.classList.remove('right');
    loginPanel.classList.remove('hidden');
    regPanel.classList.add('hidden');
    tabLogin.classList.add('active');
    tabReg.classList.remove('active');
  } else {
    slider.classList.add('right');
    loginPanel.classList.add('hidden');
    regPanel.classList.remove('hidden');
    tabLogin.classList.remove('active');
    tabReg.classList.add('active');
  }
  clearErrors();
}

function clearErrors() {
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('reg-error').classList.add('hidden');
}

function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text)   text.style.opacity = loading ? '0' : '1';
  if (loader) loader.classList.toggle('hidden', !loading);
}

// ── Register ───────────────────────────────────────────────────────────────────
async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errBox   = document.getElementById('reg-error');
  const btn      = document.getElementById('reg-btn');

  if (!name || !email || !password) { showError(errBox, 'Please fill in all fields.'); return; }
  if (password.length < 6)          { showError(errBox, 'Password must be at least 6 characters.'); return; }

  setLoading(btn, true);
  try {
    const res  = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) { showError(errBox, data.detail || 'Registration failed.'); return; }
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
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errBox   = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) { showError(errBox, 'Please fill in all fields.'); return; }

  setLoading(btn, true);
  try {
    const res  = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { showError(errBox, data.detail || 'Login failed.'); return; }
    saveSession(data);
    window.location.href = '/app';
  } catch {
    showError(errBox, 'Network error. Please try again.');
  } finally {
    setLoading(btn, false);
  }
}

function showError(box, msg) {
  box.textContent = msg;
  box.classList.remove('hidden');
  box.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
}

function saveSession(data) {
  localStorage.setItem('qm_token', data.token);
  localStorage.setItem('qm_name',  data.name);
  localStorage.setItem('qm_email', data.email);
}

// Redirect if already logged in
if (localStorage.getItem('qm_token')) window.location.href = '/app';

// Enter key support
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const loginVisible = !document.getElementById('panel-login').classList.contains('hidden');
  if (loginVisible) doLogin(); else doRegister();
});

// ── Floating code snippets ─────────────────────────────────────────────────────
const snippets = [
  'SELECT * FROM users', 'WHERE revenue > 1000', 'GROUP BY department',
  'ORDER BY created_at DESC', 'INNER JOIN orders ON', 'COUNT(DISTINCT id)',
  'LIMIT 10', 'AVG(salary)', 'LEFT JOIN customers', 'HAVING COUNT(*) > 5',
  'INSERT INTO logs', 'UPDATE products SET', 'DELETE FROM sessions',
];

function spawnSnippet() {
  const el = document.createElement('div');
  el.className = 'float-snippet';
  el.textContent = snippets[Math.floor(Math.random() * snippets.length)];
  el.style.left = Math.random() * 100 + 'vw';
  el.style.animationDuration = (12 + Math.random() * 14) + 's';
  el.style.animationDelay = (Math.random() * 4) + 's';
  el.style.fontSize = (10 + Math.random() * 5) + 'px';
  document.getElementById('floaters').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

for (let i = 0; i < 12; i++) setTimeout(spawnSnippet, i * 600);
setInterval(spawnSnippet, 1800);