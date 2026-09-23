// ── Auth guard ─────────────────────────────────────────────────────────────────
const token = localStorage.getItem('qm_token');
const name  = localStorage.getItem('qm_name');
const email = localStorage.getItem('qm_email');
if (!token) window.location.href = '/';

// ── Init UI ────────────────────────────────────────────────────────────────────
document.getElementById('user-name').textContent  = name  || 'User';
document.getElementById('user-email').textContent = email || '';
document.getElementById('avatar').textContent     = (name || 'U')[0].toUpperCase();

const history = [];
let sidebarOpen = true;

// ── Sidebar toggle ─────────────────────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed', !sidebarOpen);
  document.getElementById('main').classList.toggle('expanded', !sidebarOpen);
}

// ── Logout ─────────────────────────────────────────────────────────────────────
async function doLogout() {
  await fetch('/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {});
  localStorage.clear();
  window.location.href = '/';
}

// ── Generate SQL ───────────────────────────────────────────────────────────────
async function generateSQL() {
  const question = document.getElementById('question').value.trim();
  const schema   = document.getElementById('schema').value.trim();
  const dialect  = document.getElementById('dialect').value;

  if (!question) {
    shakeElement(document.getElementById('question'));
    return;
  }

  hide('result-card');
  hide('error-card');

  const btn = document.getElementById('gen-btn');
  const genText   = document.getElementById('gen-text');
  const genLoader = document.getElementById('gen-loader');
  btn.disabled = true;
  genText.textContent = 'Generating…';
  genLoader.classList.remove('hidden');

  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, db_schema: schema, dialect, session_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Server error');

    // Typewriter effect for SQL
    document.getElementById('sql-output').textContent = '';
    document.getElementById('explanation-text').textContent = data.explanation;
    show('result-card');
    typewrite('sql-output', data.sql, 12);

    // Add to history
    history.unshift({ question, sql: data.sql });
    if (history.length > 10) history.pop();
    renderHistory();

  } catch (err) {
    document.getElementById('error-text').textContent = err.message || 'Something went wrong.';
    show('error-card');
  } finally {
    btn.disabled = false;
    genText.textContent = '⚡ Generate SQL';
    genLoader.classList.add('hidden');
  }
}

// ── Typewriter effect ──────────────────────────────────────────────────────────
function typewrite(elId, text, delay = 15) {
  const el = document.getElementById(elId);
  let i = 0;
  el.textContent = '';
  const interval = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) clearInterval(interval);
  }, delay);
}

// ── Copy SQL ───────────────────────────────────────────────────────────────────
function copySQL() {
  const sql = document.getElementById('sql-output').textContent;
  navigator.clipboard.writeText(sql).then(() => {
    const btn = document.querySelector('.btn-icon');
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    btn.style.color = 'var(--success)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
  });
}

// ── Clear result ───────────────────────────────────────────────────────────────
function clearResult() {
  const card = document.getElementById('result-card');
  card.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 200 })
    .finished.then(() => hide('result-card'));
}

// ── History ────────────────────────────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('history-list');
  if (history.length === 0) {
    list.innerHTML = '<p class="history-empty">No queries yet</p>';
    return;
  }
  list.innerHTML = history.map((h, i) => `
    <div class="history-item" onclick="loadHistory(${i})">
      <p class="hi-q">${escHtml(h.question)}</p>
      <p class="hi-sql">${escHtml(h.sql.slice(0, 50))}…</p>
    </div>`).join('');
}

function loadHistory(i) {
  document.getElementById('question').value = history[i].question;
  document.getElementById('sql-output').textContent = history[i].sql;
  show('result-card');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function shakeElement(el) {
  el.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ], { duration: 350, easing: 'ease-out' });
  el.focus();
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); generateSQL(); }
});
