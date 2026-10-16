/**
 * QueryMind — AI SQL Assistant
 * Full frontend application logic implementing all 30 features.
 */

// ── Auth Guard & State ────────────────────────────────────────────────────────
const token = localStorage.getItem('qm_token');
const userName = localStorage.getItem('qm_name');
const userEmail = localStorage.getItem('qm_email');

if (!token) {
  window.location.href = '/';
}

let sidebarOpen = true;
let currentQuestion = '';
let currentSQL = '';
let lastExecutionError = '';
let dbConnected = false;
let currentDbInfo = { type: '', name: '' };
let currentSchemaData = null;
let currentSchemaText = '';
let history = [];

// Query execution state
let currentQuery = {
  sql: '',
  page: 1,
  pageSize: 50,
  sortColumn: '',
  sortDirection: 'asc',
  filters: {}
};

// Query results cache
let currentResults = {
  columns: [],
  rows: [],
  totalRows: 0,
  totalPages: 1,
  stats: {}
};

// Chart instance
let chartInstance = null;
const CHART_PALETTE = [
  '#7c6af7', '#5eead4', '#f87171', '#fbbf24',
  '#a78bfa', '#34d399', '#fb923c', '#60a5fa',
  '#ec4899', '#818cf8', '#2dd4bf', '#f43f5e'
];

// ── DOM Initialization ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initUserInfo();
  setupEventListeners();
  await checkDbStatus();
  await loadPersistentHistory();
});

async function initUserInfo() {
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('avatar');

  if (nameEl) nameEl.textContent = userName || 'User';
  if (emailEl) emailEl.textContent = userEmail || '';
  if (avatarEl) avatarEl.textContent = (userName || 'U')[0].toUpperCase();

  // Fetch verified profile from backend database
  try {
    const me = await apiCall('/auth/me', 'GET');
    if (me && me.name) {
      localStorage.setItem('qm_name', me.name);
      localStorage.setItem('qm_email', me.email);
      if (nameEl) nameEl.textContent = me.name;
      if (emailEl) emailEl.textContent = me.email;
      if (avatarEl) avatarEl.textContent = me.name[0].toUpperCase();
    }
  } catch (e) {}
}

async function loadPersistentHistory() {
  try {
    const res = await apiCall('/history', 'GET');
    if (res && res.history && Array.isArray(res.history)) {
      history = res.history.map(item => ({
        question: item.question,
        sql: item.sql_query,
        time: item.created_at ? new Date(item.created_at).toLocaleTimeString() : ''
      }));
      renderHistory();
    }
  } catch (err) {
    console.warn('Could not load persistent history from backend:', err);
  }
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.min(Math.max(el.scrollHeight + 6, 120), 400);
  el.style.height = newHeight + 'px';
}

// ── API Helper ────────────────────────────────────────────────────────────────
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const config = { method, headers };

  let url = endpoint;
  if (method === 'GET') {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}session_token=${encodeURIComponent(token)}`;
  } else if (body) {
    body.session_token = token;
    config.body = JSON.stringify(body);
  } else {
    config.body = JSON.stringify({ session_token: token });
  }

  try {
    const res = await fetch(url, config);
    if (res.status === 401) {
      localStorage.clear();
      window.location.href = '/';
      return null;
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    throw err;
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // Sidebar toggle
  document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', doLogout);

  // Schema toggle editor
  document.getElementById('btn-toggle-schema')?.addEventListener('click', () => {
    const body = document.getElementById('schema-body');
    body.classList.toggle('hidden');
    if (!body.classList.contains('hidden')) {
      autoResizeTextarea(document.getElementById('schema'));
    }
  });

  // Schema input auto-resize
  const schemaEl = document.getElementById('schema');
  if (schemaEl) {
    schemaEl.addEventListener('input', () => autoResizeTextarea(schemaEl));
  }

  // Question & Generate SQL
  document.getElementById('gen-btn')?.addEventListener('click', generateSQL);
  document.getElementById('btn-clear-question')?.addEventListener('click', () => {
    document.getElementById('question').value = '';
    document.getElementById('question').focus();
  });

  // Ctrl+Enter / Cmd+Enter shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      generateSQL();
    }
  });

  // SQL Result Action Buttons
  document.getElementById('btn-copy')?.addEventListener('click', copySQL);
  document.getElementById('btn-explain')?.addEventListener('click', explainSQL);
  document.getElementById('btn-fix')?.addEventListener('click', fixSQL);
  document.getElementById('btn-optimize')?.addEventListener('click', optimizeSQL);
  document.getElementById('btn-translate')?.addEventListener('click', translateSQL);
  document.getElementById('btn-validate')?.addEventListener('click', validateSQL);
  document.getElementById('btn-run-query')?.addEventListener('click', () => executeLiveQuery(true));
  document.getElementById('btn-clear-result')?.addEventListener('click', () => hide('result-card'));

  // AI Panel close
  document.getElementById('btn-close-ai-panel')?.addEventListener('click', () => hide('ai-panel'));

  // Suggestions close
  document.getElementById('btn-close-suggestions')?.addEventListener('click', () => hide('suggestions-panel'));

  // Clear chat / conversation
  document.getElementById('btn-clear-chat')?.addEventListener('click', clearConversation);

  // DB Connection Modal
  document.getElementById('btn-open-db-modal')?.addEventListener('click', openDbModal);
  document.getElementById('btn-cancel-db')?.addEventListener('click', closeDbModal);
  document.getElementById('db-type-select')?.addEventListener('change', onDbTypeChange);
  document.getElementById('db-connect-btn')?.addEventListener('click', connectDatabase);
  document.getElementById('btn-modal-sample')?.addEventListener('click', connectSampleDatabase);
  document.getElementById('btn-connect-sample')?.addEventListener('click', connectSampleDatabase);
  document.getElementById('btn-disconnect-db')?.addEventListener('click', disconnectDatabase);

  // ER Diagram Modal
  document.getElementById('btn-open-er')?.addEventListener('click', openErDiagram);
  document.getElementById('btn-close-er')?.addEventListener('click', closeErDiagram);

  // Results Section & Tabs
  document.getElementById('btn-close-results')?.addEventListener('click', () => hide('results-section'));
  document.getElementById('btn-export-csv')?.addEventListener('click', exportResultsCsv);

  document.querySelectorAll('.results-tab').forEach(tab => {
    tab.addEventListener('click', () => switchResultsTab(tab.dataset.tab));
  });

  // Page size select
  document.getElementById('page-size-select')?.addEventListener('change', (e) => {
    currentQuery.pageSize = parseInt(e.target.value, 10);
    currentQuery.page = 1;
    executeLiveQuery(false);
  });

  // Chart controls
  document.getElementById('btn-render-chart')?.addEventListener('click', renderCustomChart);
  document.getElementById('btn-auto-chart')?.addEventListener('click', autoRenderBestChart);
}

// ── Sidebar & Navigation ──────────────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar')?.classList.toggle('collapsed', !sidebarOpen);
  document.getElementById('main')?.classList.toggle('expanded', !sidebarOpen);
}

async function doLogout() {
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
  } catch (e) {}
  localStorage.clear();
  window.location.href = '/';
}

// ── Database Connection (Features 11, 12, 13) ─────────────────────────────────
function openDbModal() {
  show('db-modal');
  hide('db-modal-error');
  onDbTypeChange();
}

function closeDbModal() {
  hide('db-modal');
}

function onDbTypeChange() {
  const type = document.getElementById('db-type-select').value;
  const netFields = document.getElementById('db-net-fields');
  const portInput = document.getElementById('db-port');
  const nameLabel = document.getElementById('db-name-label');
  const nameInput = document.getElementById('db-name');

  if (type === 'sqlite') {
    netFields.style.display = 'none';
    nameLabel.textContent = 'SQLite File (bundled in project or file path)';
    nameInput.placeholder = 'customer_behavior.db or sample_store.db';
    if (!nameInput.value || nameInput.value === 'postgres') {
      nameInput.value = 'customer_behavior.db';
    }
  } else {
    netFields.style.display = 'block';
    nameLabel.textContent = 'Database Name';
    if (type === 'postgresql') {
      portInput.value = '5432';
      nameInput.placeholder = 'customer_behavior';
    } else if (type === 'mysql') {
      portInput.value = '3306';
      nameInput.placeholder = 'mysql';
    }
  }
}

async function checkDbStatus() {
  try {
    const data = await apiCall('/db/status', 'GET');
    if (data && data.connected) {
      updateDbStatusUI(true, data.db_type, data.db_name);
      await loadSchema();
    } else {
      updateDbStatusUI(false);
    }
  } catch (e) {
    updateDbStatusUI(false);
  }
}

function updateDbStatusUI(connected, dbType = '', dbName = '') {
  dbConnected = connected;
  currentDbInfo = { type: dbType, name: dbName };

  const dot = document.getElementById('db-dot');
  const text = document.getElementById('db-status-text');
  const disBtn = document.getElementById('btn-disconnect-db');
  const dialectSelect = document.getElementById('dialect');

  if (connected) {
    dot?.classList.add('connected');
    if (text) text.textContent = `${dbType.toUpperCase()}: ${dbName}`;
    disBtn?.classList.remove('hidden');

    // Auto-select dialect in dropdown
    if (dialectSelect) {
      if (dbType.toLowerCase() === 'postgresql') dialectSelect.value = 'PostgreSQL';
      else if (dbType.toLowerCase() === 'mysql') dialectSelect.value = 'MySQL';
      else if (dbType.toLowerCase() === 'sqlite') dialectSelect.value = 'SQLite';
    }
  } else {
    dot?.classList.remove('connected');
    if (text) text.textContent = 'Disconnected';
    disBtn?.classList.add('hidden');
    renderEmptySchema();
  }
}

async function connectDatabase() {
  const dbType = document.getElementById('db-type-select').value;
  const host = document.getElementById('db-host').value.trim();
  const port = parseInt(document.getElementById('db-port').value || '5432', 10);
  const database = document.getElementById('db-name').value.trim();
  const username = document.getElementById('db-user').value.trim();
  const password = document.getElementById('db-pass').value;
  const errBox = document.getElementById('db-modal-error');
  const connectBtn = document.getElementById('db-connect-btn');

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  hide('db-modal-error');

  try {
    const res = await apiCall('/db/connect', 'POST', {
      db_type: dbType,
      host,
      port,
      database,
      username,
      password
    });

    if (res && res.status === 'connected') {
      updateDbStatusUI(true, res.db_type, res.database);
      closeDbModal();
      await loadSchema();
    }
  } catch (err) {
    errBox.textContent = err.message || 'Failed to connect to database.';
    show('db-modal-error');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
}

async function connectSampleDatabase() {
  const btn = document.getElementById('btn-connect-sample');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading Demo DB…'; }

  try {
    const res = await apiCall('/db/sample', 'POST', {});
    if (res && res.status === 'connected') {
      updateDbStatusUI(true, res.db_type, res.database);
      closeDbModal();
      await loadSchema();
      // Set a pleasant demo question
      const qInput = document.getElementById('question');
      if (qInput && !qInput.value) {
        qInput.value = 'Show top 5 customers by total spending with their country and order count';
      }
    }
  } catch (err) {
    showError(err.message || 'Failed to load sample database.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

async function disconnectDatabase() {
  try {
    await apiCall('/db/disconnect', 'POST', {});
    updateDbStatusUI(false);
    currentSchemaText = '';
    currentSchemaData = null;
    document.getElementById('schema').value = '';
  } catch (err) {
    showError(err.message || 'Error disconnecting.');
  }
}

// ── Schema Import & Analysis (Features 14, 15, 16, 17) ────────────────────────
async function loadSchema() {
  try {
    const data = await apiCall('/db/schema', 'GET');
    if (data && data.tables) {
      currentSchemaData = data.tables;
      currentSchemaText = data.schema_text || '';

      // Update manual schema textarea and auto-expand to fit
      const schemaArea = document.getElementById('schema');
      if (schemaArea) {
        schemaArea.value = currentSchemaText;
        autoResizeTextarea(schemaArea);
      }

      const badge = document.getElementById('schema-badge');
      if (badge) badge.textContent = `${data.table_count} tables auto-synced`;

      // Render tree explorer
      renderSchemaExplorer(data.tables);
    }
  } catch (err) {
    console.error('Failed to load schema:', err);
  }
}

function renderEmptySchema() {
  const container = document.getElementById('schema-list');
  if (container) {
    container.innerHTML = '<p class="history-empty">Connect a database to explore tables & columns</p>';
  }
  const badge = document.getElementById('schema-badge');
  if (badge) badge.textContent = 'Optional / Manual';
}

function renderSchemaExplorer(tables) {
  const container = document.getElementById('schema-list');
  if (!container) return;

  const tableNames = Object.keys(tables);
  if (tableNames.length === 0) {
    container.innerHTML = '<p class="history-empty">No tables detected in database</p>';
    return;
  }

  let html = '';
  tableNames.forEach((tblName, idx) => {
    const tbl = tables[tblName];
    const rowCount = tbl.row_count >= 0 ? `${tbl.row_count} rows` : '';
    const colCount = tbl.columns ? `${tbl.columns.length} cols` : '';
    const pkCols = tbl.primary_key || [];
    const fkCols = (tbl.foreign_keys || []).flatMap(f => f.columns);

    html += `
      <div class="schema-table" id="tbl-wrap-${idx}">
        <div class="schema-table-header" onclick="toggleTableColumns(${idx})" title="Click to view all ${tbl.columns.length} columns">
          <span class="arrow" id="arrow-${idx}">▶</span>
          <span class="tbl-icon">🗄️</span>
          <span class="tbl-name" title="${escHtml(tblName)}">${escHtml(tblName)}</span>
          <span class="tbl-col-badge">${colCount}</span>
          <span class="row-count">${rowCount}</span>
        </div>
        <div class="schema-table-cols" id="cols-${idx}">
          <div style="padding: 4px 0 8px 0; display:flex; gap:6px; justify-content:space-between; align-items:center;">
            <button class="btn-icon-sm" onclick="queryTable('${escHtml(tblName)}')" title="Query sample records">⚡ Query Table</button>
            <span style="font-size:0.65rem; color:var(--text3);">${tbl.columns.length} columns</span>
          </div>
          ${tbl.columns.map(col => {
            const isPk = pkCols.includes(col.name);
            const isFk = fkCols.includes(col.name);
            return `
              <div class="schema-col" title="${escHtml(col.name)} (${escHtml(col.type)})">
                <div class="schema-col-name">
                  ${isPk ? '<span class="pk-badge" title="Primary Key">🔑</span>' : ''}
                  ${isFk ? '<span class="fk-badge" title="Foreign Key">🔗</span>' : ''}
                  <span title="${escHtml(col.name)}">${escHtml(col.name)}</span>
                </div>
                <span class="col-type" title="${escHtml(col.type)}">${escHtml(col.type)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleTableColumns(idx) {
  const cols = document.getElementById(`cols-${idx}`);
  const arrow = document.getElementById(`arrow-${idx}`);
  if (cols && arrow) {
    const isOpen = cols.classList.contains('open');
    cols.classList.toggle('open', !isOpen);
    arrow.classList.toggle('open', !isOpen);
  }
}

function queryTable(tblName) {
  const sql = `SELECT * FROM ${tblName} LIMIT 50;`;
  document.getElementById('question').value = `Show 50 rows from ${tblName}`;
  currentSQL = sql;
  show('result-card');
  document.getElementById('sql-output').textContent = sql;
  document.getElementById('explanation-text').textContent = `Retrieves up to 50 sample records from the ${tblName} table.`;
  executeLiveQuery(true);
}

// ── Database ER Diagram (Feature 18) ──────────────────────────────────────────
async function openErDiagram() {
  if (!dbConnected) {
    showError('Please connect to a database to generate an ER diagram.');
    return;
  }

  show('er-modal');
  const canvas = document.getElementById('er-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#8888a8';
  ctx.font = '16px Inter, sans-serif';
  ctx.fillText('Generating ER Diagram from database relationships…', 50, 60);

  try {
    const data = await apiCall('/db/er-diagram', 'GET');
    if (data && data.nodes) {
      renderErCanvas(data);
    }
  } catch (err) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f87171';
    ctx.fillText(`Error rendering ER diagram: ${err.message}`, 50, 60);
  }
}

function closeErDiagram() {
  hide('er-modal');
}

function renderErCanvas(data) {
  const canvas = document.getElementById('er-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const nodes = data.nodes || [];
  const edges = data.edges || [];

  const metaEl = document.getElementById('er-meta');
  if (metaEl) {
    metaEl.textContent = `${nodes.length} tables · ${edges.length} foreign key relationships`;
  }

  const boxWidth = 240;
  const rowHeight = 24;
  const headerHeight = 36;

  // Auto-arrange in columns if needed
  const colCount = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(nodes.length))));
  nodes.forEach((n, i) => {
    const colIdx = i % colCount;
    const rowIdx = Math.floor(i / colCount);
    n.x = 60 + colIdx * (boxWidth + 90);
    n.y = 50 + rowIdx * 280;
    n.w = boxWidth;
    n.h = headerHeight + (n.columns ? n.columns.length * rowHeight : 0) + 8;
  });

  // Draw relationship connection lines first (edges)
  edges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);

    if (fromNode && toNode) {
      const startX = fromNode.x + fromNode.w;
      const startY = fromNode.y + headerHeight / 2;
      const endX = toNode.x;
      const endY = toNode.y + headerHeight / 2;

      ctx.beginPath();
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 2]);

      const midX = (startX + endX) / 2;
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(midX, startY, midX, endY, endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw arrow head at destination
      ctx.beginPath();
      ctx.fillStyle = '#5eead4';
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Label on connection
      if (edge.from_col) {
        ctx.fillStyle = '#8888a8';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`🔗 ${edge.from_col} → ${edge.to_col || ''}`, midX - 30, (startY + endY) / 2 - 6);
      }
    }
  });

  // Draw table entity boxes (nodes)
  nodes.forEach(node => {
    // Card background
    ctx.fillStyle = '#13131a';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, node.h, 10);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Card border
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Table Header
    ctx.fillStyle = '#1c1c27';
    ctx.beginPath();
    ctx.roundRect(node.x, node.y, node.w, headerHeight, [10, 10, 0, 0]);
    ctx.fill();

    // Bottom header line
    ctx.strokeStyle = '#7c6af7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y + headerHeight);
    ctx.lineTo(node.x + node.w, node.y + headerHeight);
    ctx.stroke();

    // Header title
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText(`🗄️ ${node.label || node.id}`, node.x + 12, node.y + 23);

    // Columns
    if (node.columns) {
      node.columns.forEach((col, cIdx) => {
        const rowY = node.y + headerHeight + cIdx * rowHeight + 16;

        // Alternate subtle row line
        ctx.fillStyle = cIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';
        ctx.fillRect(node.x + 2, rowY - 12, node.w - 4, rowHeight);

        if (col.is_pk) {
          ctx.fillStyle = '#fbbf24';
          ctx.font = '11px Inter, sans-serif';
          ctx.fillText('🔑', node.x + 10, rowY);
        }

        ctx.fillStyle = col.is_pk ? '#5eead4' : '#e8e8f0';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(col.name, node.x + (col.is_pk ? 28 : 14), rowY);

        ctx.fillStyle = '#8888a8';
        ctx.font = '10px JetBrains Mono, monospace';
        const typeStr = col.type || '';
        const typeWidth = ctx.measureText(typeStr).width;
        ctx.fillText(typeStr, node.x + node.w - typeWidth - 12, rowY);
      });
    }
  });
}

// ── Natural Language → SQL (Feature 4 & 10) ───────────────────────────────────
async function generateSQL() {
  const question = document.getElementById('question').value.trim();
  const schema = document.getElementById('schema').value.trim();
  const dialect = document.getElementById('dialect').value;

  if (!question) {
    shakeElement(document.getElementById('question'));
    return;
  }

  currentQuestion = question;
  hide('error-card');
  hide('ai-panel');

  const btn = document.getElementById('gen-btn');
  const genText = document.getElementById('gen-text');
  const genLoader = document.getElementById('gen-loader');

  btn.disabled = true;
  genText.textContent = 'Generating…';
  genLoader.classList.remove('hidden');

  try {
    const res = await apiCall('/generate', 'POST', {
      question,
      db_schema: schema,
      dialect
    });

    if (res && res.sql) {
      currentSQL = res.sql;
      document.getElementById('sql-output').textContent = res.sql;
      document.getElementById('explanation-text').textContent = res.explanation || 'SQL generated successfully.';
      show('result-card');

      // Add to conversation history
      addToHistory(question, res.sql);

      // Trigger Suggestions & Follow-ups in parallel
      loadSuggestions(question, res.sql);
      loadFollowups(question, res.sql);
    }
  } catch (err) {
    showError(err.message || 'Failed to generate SQL query.');
  } finally {
    btn.disabled = false;
    genText.textContent = '⚡ Generate SQL';
    genLoader.classList.add('hidden');
  }
}

// ── AI Query Suggestions & Follow-ups (Features 6 & 8) ────────────────────────
async function loadSuggestions(question, sql) {
  try {
    const schema = document.getElementById('schema').value.trim();
    const res = await apiCall('/suggestions', 'POST', {
      question,
      sql,
      db_schema: schema
    });

    if (res && res.suggestions && res.suggestions.length > 0) {
      const container = document.getElementById('suggestions-list');
      container.innerHTML = res.suggestions.map(s => `
        <span class="suggestion-pill" onclick="applySuggestion('${escAttr(s.question)}')" title="${escHtml(s.description || '')}">
          ${escHtml(s.question)}
        </span>
      `).join('');
      show('suggestions-panel');
    }
  } catch (e) {
    console.warn('Suggestions error:', e);
  }
}

async function loadFollowups(question, sql) {
  try {
    const schema = document.getElementById('schema').value.trim();
    const res = await apiCall('/followup', 'POST', {
      question,
      sql,
      db_schema: schema
    });

    if (res && res.followups && res.followups.length > 0) {
      const container = document.getElementById('followup-list');
      const wrap = document.getElementById('followups-wrap');
      container.innerHTML = res.followups.map(f => `
        <span class="suggestion-pill" style="border-color:rgba(124,106,247,0.3);" onclick="applySuggestion('${escAttr(f.question)}')" title="${escHtml(f.intent || '')}">
          💬 ${escHtml(f.question)}
        </span>
      `).join('');
      wrap?.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('Follow-ups error:', e);
  }
}

function applySuggestion(qText) {
  const input = document.getElementById('question');
  input.value = qText;
  generateSQL();
}

// ── AI Explainer (Feature 1) ──────────────────────────────────────────────────
async function explainSQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  setAiPanelLoading('Explaining query clause by clause…');

  try {
    const dialect = document.getElementById('dialect').value;
    const res = await apiCall('/explain', 'POST', { sql: currentSQL, dialect });

    if (res) {
      let html = `
        <div class="ai-section">
          <div class="ai-section-title">Overview</div>
          <p>${escHtml(res.summary || '')}</p>
          <div style="margin-top:6px;">
            <span class="ai-tag ${res.complexity === 'complex' ? 'critical' : res.complexity === 'moderate' ? 'warning' : 'low'}">Complexity: ${escHtml(res.complexity || 'normal')}</span>
          </div>
        </div>
      `;

      if (res.breakdown && res.breakdown.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Query Clause Breakdown</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${res.breakdown.map(b => `
                <div style="background:var(--surface2); padding:8px 12px; border-radius:8px; border:1px solid var(--border);">
                  <code style="color:var(--accent2); font-family:var(--mono); font-size:0.8rem; display:block; margin-bottom:4px;">${escHtml(b.clause)}</code>
                  <p style="font-size:0.8rem; color:var(--text2); margin:0;">${escHtml(b.explanation)}</p>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (res.tips && res.tips.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Pro Tips</div>
            <ul>
              ${res.tips.map(t => `<li>${escHtml(t)}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      showAiPanel('🔍 Query Explanation (AI Explainer)', html);
    }
  } catch (err) {
    showAiPanel('🔍 Query Explanation', `<p style="color:var(--error);">${escHtml(err.message)}</p>`);
  }
}

// ── SQL Error Fixer (Feature 2) ───────────────────────────────────────────────
async function fixSQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  setAiPanelLoading('Analyzing SQL for errors and constructing fixes…');

  try {
    const dialect = document.getElementById('dialect').value;
    const res = await apiCall('/fix', 'POST', {
      sql: currentSQL,
      error_message: lastExecutionError,
      dialect
    });

    if (res) {
      let html = '';
      if (res.has_errors) {
        html += `
          <div class="ai-section">
            <span class="ai-tag critical">Errors Detected</span>
            <p style="margin-top:6px;">${escHtml(res.explanation || '')}</p>
          </div>
        `;

        if (res.errors && res.errors.length > 0) {
          html += `
            <div class="ai-section">
              <div class="ai-section-title">Detected Issues</div>
              <ul>
                ${res.errors.map(e => `
                  <li><strong>${escHtml(e.type || 'error')}:</strong> ${escHtml(e.description)} <span class="hint">(${escHtml(e.location || '')})</span></li>
                `).join('')}
              </ul>
            </div>
          `;
        }

        if (res.fixed_sql) {
          html += `
            <div class="ai-section">
              <div class="ai-section-title">Corrected SQL</div>
              <pre class="ai-sql-block"><code>${escHtml(res.fixed_sql)}</code></pre>
              <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem; width:auto; margin-top:8px;" onclick="applyFixedSql('${escAttr(res.fixed_sql)}')">
                ✓ Apply Fixed SQL
              </button>
            </div>
          `;
        }
      } else {
        html = `
          <div class="ai-section">
            <span class="ai-tag low">No Syntax Errors Found</span>
            <p style="margin-top:8px;">The query structure looks syntactically valid for ${escHtml(dialect)}. ${escHtml(res.explanation || '')}</p>
          </div>
        `;
      }

      showAiPanel('🔧 SQL Error Fixer', html);
    }
  } catch (err) {
    showAiPanel('🔧 SQL Error Fixer', `<p style="color:var(--error);">${escHtml(err.message)}</p>`);
  }
}

function applyFixedSql(fixedSql) {
  currentSQL = fixedSql;
  document.getElementById('sql-output').textContent = fixedSql;
  hide('ai-panel');
}

// ── SQL Optimizer (Feature 3) ─────────────────────────────────────────────────
async function optimizeSQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  setAiPanelLoading('Evaluating query performance & indexing opportunities…');

  try {
    const dialect = document.getElementById('dialect').value;
    const schema = document.getElementById('schema').value.trim();
    const res = await apiCall('/optimize', 'POST', {
      sql: currentSQL,
      dialect,
      db_schema: schema
    });

    if (res) {
      let html = `
        <div class="ai-section">
          <div class="ai-section-title">Optimization Assessment</div>
          <p>${escHtml(res.explanation || '')}</p>
          ${res.estimated_improvement ? `<p style="margin-top:4px; color:var(--accent2);"><strong>Expected Gain:</strong> ${escHtml(res.estimated_improvement)}</p>` : ''}
        </div>
      `;

      if (res.improvements && res.improvements.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Key Improvements</div>
            <ul>
              ${res.improvements.map(i => `
                <li><span class="ai-tag ${i.impact === 'high' ? 'critical' : i.impact === 'medium' ? 'warning' : 'low'}">${escHtml(i.impact)} impact</span> ${escHtml(i.description)}</li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      if (res.index_suggestions && res.index_suggestions.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Suggested Index Recommendations</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${res.index_suggestions.map(idx => `
                <div style="background:var(--surface2); padding:8px 12px; border-radius:8px; border:1px solid var(--border);">
                  <strong style="color:var(--accent);">${escHtml(idx.table)}</strong> (${escHtml((idx.columns || []).join(', '))})
                  <p style="font-size:0.78rem; color:var(--text2); margin:3px 0 0 0;">${escHtml(idx.reason)}</p>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (res.optimized_sql && res.optimized_sql.trim() !== currentSQL.trim()) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Optimized Query</div>
            <pre class="ai-sql-block"><code>${escHtml(res.optimized_sql)}</code></pre>
            <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem; width:auto; margin-top:8px;" onclick="applyFixedSql('${escAttr(res.optimized_sql)}')">
              ⚡ Apply Optimized SQL
            </button>
          </div>
        `;
      }

      showAiPanel('⚡ SQL Optimizer', html);
    }
  } catch (err) {
    showAiPanel('⚡ SQL Optimizer', `<p style="color:var(--error);">${escHtml(err.message)}</p>`);
  }
}

// ── SQL → Natural Language (Feature 5) ────────────────────────────────────────
async function translateSQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  setAiPanelLoading('Translating SQL to plain English…');

  try {
    const res = await apiCall('/sql-to-nl', 'POST', { sql: currentSQL });
    if (res) {
      const html = `
        <div class="ai-section">
          <div class="ai-section-title">Plain English Translation</div>
          <p style="font-size:0.95rem; line-height:1.6; color:var(--text);">${escHtml(res.natural_language || '')}</p>
        </div>
        ${res.audience_friendly ? `
          <div class="ai-section">
            <div class="ai-section-title">Executive / Non-Technical Summary</div>
            <p style="color:var(--text2);">${escHtml(res.audience_friendly)}</p>
          </div>
        ` : ''}
      `;
      showAiPanel('📝 SQL → Natural Language', html);
    }
  } catch (err) {
    showAiPanel('📝 SQL → Natural Language', `<p style="color:var(--error);">${escHtml(err.message)}</p>`);
  }
}

// ── AI Query Validation (Feature 9) ───────────────────────────────────────────
async function validateSQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  const question = document.getElementById('question').value.trim() || currentQuestion;
  if (!question) {
    showError('Enter a natural language question to validate against.');
    return;
  }

  setAiPanelLoading('Validating SQL against your original request…');

  try {
    const dialect = document.getElementById('dialect').value;
    const schema = document.getElementById('schema').value.trim();
    const res = await apiCall('/validate', 'POST', {
      question,
      sql: currentSQL,
      db_schema: schema,
      dialect
    });

    if (res) {
      const isValid = res.is_valid;
      const conf = Math.round((res.confidence || 0) * 100);

      let html = `
        <div class="ai-section">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <span class="validation-badge ${isValid ? 'valid' : 'invalid'}">
              ${isValid ? '✓ Matches User Intent' : '⚠️ Potential Intent Discrepancy'}
            </span>
            <span class="hint">Confidence: ${conf}%</span>
          </div>
          <p>${escHtml(res.explanation || '')}</p>
        </div>
      `;

      if (res.issues && res.issues.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Identified Concerns</div>
            <ul>
              ${res.issues.map(iss => `
                <li><span class="ai-tag ${iss.severity || 'warning'}">${escHtml(iss.severity || 'note')}</span> ${escHtml(iss.description)}</li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      if (res.corrected_sql && res.corrected_sql.trim() !== currentSQL.trim()) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Recommended Query</div>
            <pre class="ai-sql-block"><code>${escHtml(res.corrected_sql)}</code></pre>
            <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem; width:auto; margin-top:8px;" onclick="applyFixedSql('${escAttr(res.corrected_sql)}')">
              ✓ Use Corrected SQL
            </button>
          </div>
        `;
      }

      showAiPanel('✓ AI Query Validation', html);
    }
  } catch (err) {
    showAiPanel('✓ AI Query Validation', `<p style="color:var(--error);">${escHtml(err.message)}</p>`);
  }
}

// ── Multi-turn Clear Conversation (Feature 10) ────────────────────────────────
async function clearConversation() {
  try {
    await apiCall('/conversation/clear', 'POST', {});
    await apiCall('/history/clear', 'POST', {});
    history = [];
    renderHistory();
    const badge = document.getElementById('multi-turn-badge');
    if (badge) {
      const orig = badge.textContent;
      badge.textContent = 'Context Cleared';
      setTimeout(() => badge.textContent = orig, 1800);
    }
  } catch (err) {
    console.error('Error clearing conversation:', err);
  }
}

// ── Live Query Execution (Features 19, 20, 25, 27, 28, 29, 30) ────────────────
async function executeLiveQuery(resetPage = false) {
  getSqlFromOutput();
  if (!currentSQL) return;

  if (!dbConnected) {
    showError('Please connect to a database first to execute live queries.');
    openDbModal();
    return;
  }

  if (resetPage) {
    currentQuery.page = 1;
    currentQuery.filters = {};
  }
  currentQuery.sql = currentSQL;

  show('results-section');
  setResultsLoading(true);
  hide('error-card');

  const startTime = performance.now();

  try {
    const res = await apiCall('/db/execute', 'POST', {
      sql: currentQuery.sql,
      page: currentQuery.page,
      page_size: currentQuery.pageSize,
      sort_column: currentQuery.sortColumn,
      sort_direction: currentQuery.sortDirection,
      filters: currentQuery.filters
    });

    const elapsed = Math.round(performance.now() - startTime);

    if (res && res.columns) {
      lastExecutionError = '';
      currentResults = {
        columns: res.columns,
        rows: res.rows || [],
        totalRows: res.total_rows || 0,
        totalPages: res.total_pages || 1,
        stats: res.stats || {}
      };

      const metaEl = document.getElementById('results-meta');
      if (metaEl) {
        metaEl.textContent = `${currentResults.totalRows} rows total · Page ${res.page} of ${res.total_pages} · ${elapsed}ms`;
      }

      // Render Table Tab
      renderDataTable(res);

      // Render Summary Stats Tab
      renderStatsTab(res.stats);

      // Populate Chart Selectors
      populateChartDropdowns(res.columns);

      // Automatically trigger AI Data Insights in background
      loadDataInsights(currentSQL, res.rows, res.columns);
    }
  } catch (err) {
    lastExecutionError = err.message;
    showError(`Execution error: ${err.message}`);
    setResultsError(err.message);
  } finally {
    setResultsLoading(false);
  }
}

function renderDataTable(res) {
  const thead = document.getElementById('results-table-head');
  const tbody = document.getElementById('results-table-body');
  if (!thead || !tbody) return;

  const cols = res.columns || [];
  const rows = res.rows || [];

  // Header row with sorting (Feature 29)
  let headerHtml = '<tr>';
  cols.forEach(col => {
    const isSorted = currentQuery.sortColumn === col;
    const arrow = isSorted ? (currentQuery.sortDirection === 'asc' ? '▲' : '▼') : '';
    headerHtml += `
      <th onclick="toggleSort('${escAttr(col)}')" title="Click to sort">
        ${escHtml(col)} <span class="sort-arrow">${arrow}</span>
      </th>
    `;
  });
  headerHtml += '</tr>';

  // Filter row (Feature 28)
  headerHtml += '<tr class="filter-row">';
  cols.forEach(col => {
    const val = currentQuery.filters[col] || '';
    headerHtml += `
      <th>
        <input class="filter-input" placeholder="Filter…" value="${escAttr(val)}" onchange="onFilterChange('${escAttr(col)}', this.value)"/>
      </th>
    `;
  });
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;

  // Body rows
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center; padding:2rem; color:var(--text2);">No matching records found.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr>
        ${cols.map(c => {
          const v = r[c];
          if (v === null || v === undefined) {
            return '<td class="null-val">NULL</td>';
          }
          return `<td>${escHtml(String(v))}</td>`;
        }).join('')}
      </tr>
    `).join('');
  }

  // Pagination controls (Feature 30)
  renderPagination(res);
}

function toggleSort(col) {
  if (currentQuery.sortColumn === col) {
    currentQuery.sortDirection = currentQuery.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    currentQuery.sortColumn = col;
    currentQuery.sortDirection = 'asc';
  }
  executeLiveQuery(false);
}

function onFilterChange(col, val) {
  if (val.trim()) {
    currentQuery.filters[col] = val.trim();
  } else {
    delete currentQuery.filters[col];
  }
  currentQuery.page = 1;
  executeLiveQuery(false);
}

function renderPagination(res) {
  const infoEl = document.getElementById('pagination-info');
  const controlsEl = document.getElementById('pagination-controls');
  if (!infoEl || !controlsEl) return;

  const start = Math.min((res.page - 1) * res.page_size + 1, res.total_rows);
  const end = Math.min(res.page * res.page_size, res.total_rows);
  infoEl.textContent = `Showing ${start}–${end} of ${res.total_rows}`;

  let html = '';
  html += `<button class="page-btn" ${res.page <= 1 ? 'disabled' : ''} onclick="changePage(${res.page - 1})">« Prev</button>`;

  const maxButtons = 5;
  const startPage = Math.max(1, res.page - 2);
  const endPage = Math.min(res.total_pages, startPage + maxButtons - 1);

  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === res.page ? 'active' : ''}" onclick="changePage(${p})">${p}</button>`;
  }

  html += `<button class="page-btn" ${res.page >= res.total_pages ? 'disabled' : ''} onclick="changePage(${res.page + 1})">Next »</button>`;
  controlsEl.innerHTML = html;
}

function changePage(p) {
  currentQuery.page = p;
  executeLiveQuery(false);
}

function setResultsLoading(isLoading) {
  const tbody = document.getElementById('results-table-body');
  if (tbody && isLoading) {
    tbody.innerHTML = `
      <tr>
        <td colspan="100" style="text-align:center; padding:3rem;">
          <div class="loading-inline">
            <div class="dot-loader"><span></span><span></span><span></span></div>
            <span>Executing query…</span>
          </div>
        </td>
      </tr>
    `;
  }
}

function setResultsError(msg) {
  const tbody = document.getElementById('results-table-body');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="100" style="color:var(--error); padding:2rem; text-align:center;">
          ⚠️ ${escHtml(msg)}
        </td>
      </tr>
    `;
  }
}

// ── Data Visualization & Charts (Features 21, 22, 23, 24) ─────────────────────
function populateChartDropdowns(columns) {
  const xSel = document.getElementById('chart-x');
  const ySel = document.getElementById('chart-y');
  if (!xSel || !ySel) return;

  xSel.innerHTML = '';
  ySel.innerHTML = '';

  columns.forEach(col => {
    xSel.innerHTML += `<option value="${escAttr(col)}">${escHtml(col)}</option>`;
    ySel.innerHTML += `<option value="${escAttr(col)}">${escHtml(col)}</option>`;
  });

  // Pick reasonable defaults: first string col as X, first numeric col as Y
  const stats = currentResults.stats || {};
  let xPicked = false;
  let yPicked = false;

  columns.forEach(col => {
    const isNum = stats[col] && stats[col].type === 'numeric';
    if (!yPicked && isNum) {
      ySel.value = col;
      yPicked = true;
    } else if (!xPicked && !isNum) {
      xSel.value = col;
      xPicked = true;
    }
  });

  if (!yPicked && columns.length > 1) {
    ySel.selectedIndex = 1;
  }
}

function renderCustomChart() {
  const chartType = document.getElementById('chart-type').value;
  const xCol = document.getElementById('chart-x').value;
  const yCol = document.getElementById('chart-y').value;

  drawChart(chartType, xCol, yCol);
}

function drawChart(type, xCol, yCol) {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas || !currentResults.rows || currentResults.rows.length === 0) return;

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const rows = currentResults.rows.slice(0, 50); // Chart top 50 for readability
  const labels = rows.map(r => String(r[xCol] !== null ? r[xCol] : 'NULL'));
  const values = rows.map(r => {
    const n = parseFloat(r[yCol]);
    return isNaN(n) ? 0 : n;
  });

  const isPie = type === 'pie' || type === 'doughnut';
  const colors = isPie
    ? labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length])
    : CHART_PALETTE[0];

  chartInstance = new Chart(canvas, {
    type: type,
    data: {
      labels,
      datasets: [{
        label: `${yCol} by ${xCol}`,
        data: values,
        backgroundColor: colors,
        borderColor: isPie ? '#13131a' : '#7c6af7',
        borderWidth: isPie ? 2 : 1.5,
        tension: 0.35,
        fill: type === 'line'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: isPie,
          labels: { color: '#8888a8', font: { family: 'Inter', size: 11 } }
        },
        tooltip: {
          backgroundColor: '#1c1c27',
          titleColor: '#e8e8f0',
          bodyColor: '#5eead4',
          borderColor: '#2a2a3a',
          borderWidth: 1
        }
      },
      scales: isPie ? {} : {
        x: {
          grid: { color: 'rgba(42, 42, 58, 0.4)' },
          ticks: { color: '#8888a8', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(42, 42, 58, 0.4)' },
          ticks: { color: '#8888a8', font: { family: 'Inter', size: 10 } }
        }
      }
    }
  });
}

// ── Automatic Chart Generation (Feature 21) ───────────────────────────────────
function autoRenderBestChart() {
  const stats = currentResults.stats || {};
  const cols = currentResults.columns || [];
  if (cols.length === 0) return;

  let bestType = 'bar';
  let bestX = cols[0];
  let bestY = cols[1] || cols[0];

  // Check if AI insights gave a recommendation
  if (window._lastChartRec && window._lastChartRec.type) {
    const rec = window._lastChartRec;
    bestType = rec.type === 'pie' ? 'pie' : rec.type === 'line' ? 'line' : 'bar';
    if (rec.x_column && cols.includes(rec.x_column)) bestX = rec.x_column;
    if (rec.y_column && cols.includes(rec.y_column)) bestY = rec.y_column;
  } else {
    // Heuristic: categorical X, numeric Y
    for (const c of cols) {
      if (stats[c] && stats[c].type === 'numeric') {
        bestY = c;
        break;
      }
    }
    for (const c of cols) {
      if (stats[c] && stats[c].type === 'categorical') {
        bestX = c;
        break;
      }
    }
  }

  document.getElementById('chart-type').value = bestType;
  document.getElementById('chart-x').value = bestX;
  document.getElementById('chart-y').value = bestY;

  drawChart(bestType, bestX, bestY);
}

// ── AI Data Insights (Features 7 & 26) ────────────────────────────────────────
async function loadDataInsights(sql, rows, columns) {
  const container = document.getElementById('insights-content');
  if (!container) return;

  container.innerHTML = `
    <div class="loading-inline" style="padding:1rem;">
      <div class="dot-loader"><span></span><span></span><span></span></div>
      <span>AI Data Analyst is synthesizing insights…</span>
    </div>
  `;

  try {
    const res = await apiCall('/insights', 'POST', {
      sql,
      results: rows.slice(0, 50),
      columns
    });

    if (res && res.insights) {
      window._lastChartRec = res.chart_recommendation || null;

      let html = '';
      if (res.summary) {
        html += `
          <div style="background:var(--surface2); padding:12px; border-radius:10px; border:1px solid var(--border); margin-bottom:10px;">
            <strong style="color:var(--accent2); display:block; margin-bottom:4px;">📊 Summary Observation</strong>
            <p style="font-size:0.84rem; color:var(--text); line-height:1.5;">${escHtml(res.summary)}</p>
          </div>
        `;
      }

      html += res.insights.map(ins => {
        let icon = '💡';
        if (ins.type === 'pattern') icon = '🔄';
        else if (ins.type === 'trend') icon = '📈';
        else if (ins.type === 'anomaly') icon = '⚠️';
        else if (ins.type === 'recommendation') icon = '🎯';

        return `
          <div class="insight-card">
            <div class="insight-header">
              <span class="insight-icon">${icon}</span>
              <span class="insight-title">${escHtml(ins.title || '')}</span>
              <span class="insight-type">${escHtml(ins.type || 'insight')}</span>
            </div>
            <p class="insight-desc">${escHtml(ins.description || '')}</p>
          </div>
        `;
      }).join('');

      if (res.chart_recommendation) {
        html += `
          <div style="background:rgba(124,106,247,0.08); border:1px solid rgba(124,106,247,0.25); padding:10px 14px; border-radius:10px; margin-top:8px;">
            <strong style="color:var(--accent);">🪄 Chart Recommendation:</strong>
            <span style="font-size:0.82rem; color:var(--text2); margin-left:6px;">
              ${escHtml(res.chart_recommendation.type ? res.chart_recommendation.type.toUpperCase() : '')} chart (${escHtml(res.chart_recommendation.x_column || '')} vs ${escHtml(res.chart_recommendation.y_column || '')}) — ${escHtml(res.chart_recommendation.reason || '')}
            </span>
          </div>
        `;
      }

      container.innerHTML = html;
    }
  } catch (err) {
    container.innerHTML = `<p style="color:var(--error); font-size:0.8rem;">Could not load insights: ${escHtml(err.message)}</p>`;
  }
}

// ── Summary Statistics (Feature 27) ───────────────────────────────────────────
function renderStatsTab(stats) {
  const container = document.getElementById('stats-content');
  if (!container) return;

  const colNames = Object.keys(stats || {});
  if (colNames.length === 0) {
    container.innerHTML = '<p class="hint">No statistics available for this result set.</p>';
    return;
  }

  container.innerHTML = colNames.map(col => {
    const s = stats[col];
    if (s.type === 'numeric') {
      return `
        <div class="stat-card">
          <div class="stat-col-name">${escHtml(col)} <span class="stat-type-badge">Numeric</span></div>
          <div class="stat-row"><span class="stat-label">Count:</span><span class="stat-value">${s.count}</span></div>
          <div class="stat-row"><span class="stat-label">Min:</span><span class="stat-value">${s.min}</span></div>
          <div class="stat-row"><span class="stat-label">Max:</span><span class="stat-value">${s.max}</span></div>
          <div class="stat-row"><span class="stat-label">Average:</span><span class="stat-value">${s.avg}</span></div>
          <div class="stat-row"><span class="stat-label">Total Sum:</span><span class="stat-value">${s.sum}</span></div>
          <div class="stat-row"><span class="stat-label">Nulls:</span><span class="stat-value">${s.null_count || 0}</span></div>
        </div>
      `;
    } else {
      const topVals = (s.top_values || []).map(tv => `
        <span class="top-val" title="${tv.count} occurrences">${escHtml(tv.value)} (${tv.count})</span>
      `).join('');

      return `
        <div class="stat-card">
          <div class="stat-col-name">${escHtml(col)} <span class="stat-type-badge" style="color:var(--accent); background:rgba(124,106,247,0.12);">Category</span></div>
          <div class="stat-row"><span class="stat-label">Total Rows:</span><span class="stat-value">${s.count}</span></div>
          <div class="stat-row"><span class="stat-label">Unique Values:</span><span class="stat-value">${s.unique || 0}</span></div>
          <div class="stat-row"><span class="stat-label">Nulls:</span><span class="stat-value">${s.null_count || 0}</span></div>
          <div style="margin-top:6px;">
            <span class="stat-label" style="display:block; margin-bottom:3px;">Top Values:</span>
            <div class="top-values">${topVals || '<span class="hint">—</span>'}</div>
          </div>
        </div>
      `;
    }
  }).join('');
}

// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchResultsTab(tabId) {
  document.querySelectorAll('.results-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.results-tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId);
  });

  if (tabId === 'tab-charts') {
    // If chart canvas not rendered yet, trigger
    if (!chartInstance && currentResults.columns.length > 0) {
      autoRenderBestChart();
    }
  }
}

// ── Export Results as CSV ─────────────────────────────────────────────────────
function exportResultsCsv() {
  if (!currentResults.rows || currentResults.rows.length === 0) {
    showError('No result rows to export.');
    return;
  }

  const cols = currentResults.columns;
  const rows = currentResults.rows;

  let csv = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(',') + '\n';
  rows.forEach(r => {
    csv += cols.map(c => {
      const v = r[c];
      return v !== null && v !== undefined ? `"${String(v).replace(/"/g, '""')}"` : '""';
    }).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `query_results_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── History Tracking ──────────────────────────────────────────────────────────
function addToHistory(question, sql) {
  history.unshift({ question, sql, time: new Date().toLocaleTimeString() });
  if (history.length > 15) history.pop();
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;

  if (history.length === 0) {
    list.innerHTML = '<p class="history-empty">No queries yet</p>';
    return;
  }

  list.innerHTML = history.map((h, i) => `
    <div class="history-item" onclick="loadHistoryItem(${i})">
      <p class="hi-q">${escHtml(h.question)}</p>
      <p class="hi-sql">${escHtml(h.sql.slice(0, 45))}…</p>
    </div>
  `).join('');
}

function loadHistoryItem(i) {
  const item = history[i];
  if (!item) return;

  document.getElementById('question').value = item.question;
  currentSQL = item.sql;
  document.getElementById('sql-output').textContent = item.sql;
  document.getElementById('explanation-text').textContent = 'Loaded from query history.';
  show('result-card');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSqlFromOutput() {
  const codeEl = document.getElementById('sql-output');
  if (codeEl) {
    currentSQL = codeEl.textContent.trim();
  }
}

function copySQL() {
  getSqlFromOutput();
  if (!currentSQL) return;

  navigator.clipboard.writeText(currentSQL).then(() => {
    const btn = document.getElementById('btn-copy');
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 1800);
  });
}

function setAiPanelLoading(msg) {
  show('ai-panel');
  document.getElementById('ai-panel-title').textContent = '🤖 AI Assistant';
  document.getElementById('ai-panel-body').innerHTML = `
    <div class="loading-inline">
      <div class="dot-loader"><span></span><span></span><span></span></div>
      <span>${escHtml(msg)}</span>
    </div>
  `;
}

function showAiPanel(title, html) {
  show('ai-panel');
  document.getElementById('ai-panel-title').textContent = title;
  document.getElementById('ai-panel-body').innerHTML = html;
}

function showError(msg) {
  const card = document.getElementById('error-card');
  const text = document.getElementById('error-text');
  if (card && text) {
    text.textContent = msg;
    show('error-card');
    shakeElement(card);
  }
}

function show(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function hide(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(s) {
  if (!s) return '';
  return String(s)
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
}

function shakeElement(el) {
  if (!el) return;
  el.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-6px)' },
    { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' }
  ], { duration: 320, easing: 'ease-out' });
  el.focus?.();
}
