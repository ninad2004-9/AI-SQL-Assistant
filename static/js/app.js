/**
 * QueryMind AI SQL Assistant - Main Dashboard JavaScript
 * Handles all UI interactions, state management, and API communication.
 */

// Global State Variables
const token = localStorage.getItem('qm_token');
const userName = localStorage.getItem('qm_name');
const userEmail = localStorage.getItem('qm_email');

// Auth Guard
if (!token) {
    window.location.href = '/';
}

let history = [];
let sidebarOpen = true;
let currentQuery = { sql: '', page: 1, pageSize: 50, sortColumn: '', sortDir: 'asc', filters: {} };
let currentResults = { columns: [], rows: [], stats: {} };
let currentChart = null; // Chart.js instance
let currentQuestion = '';
let currentSQL = '';
let dbConnected = false;
let currentSchemaText = '';

// Chart Colors (Dark Theme)
const CHART_COLORS = ['#7c6af7', '#5eead4', '#f87171', '#fbbf24', '#a78bfa', '#34d399', '#fb923c', '#60a5fa'];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Set user info
    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    const userAvatarEl = document.getElementById('user-avatar');
    
    if (userNameEl) userNameEl.textContent = userName || 'User';
    if (userEmailEl) userEmailEl.textContent = userEmail || 'user@example.com';
    if (userAvatarEl && userName) userAvatarEl.textContent = userName.charAt(0).toUpperCase();

    // Check DB status on load
    await checkDbStatus();

    // Keyboard shortcuts
    const questionInput = document.getElementById('question-input');
    if (questionInput) {
        questionInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                generateSQL();
            }
        });
    }

    // Load history
    renderHistory();
});

// --- API Wrapper ---
async function apiCall(endpoint, options = {}) {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    let url = endpoint;
    
    if (isGet) {
        const separator = url.includes('?') ? '&' : '?';
        url += `${separator}session_token=${encodeURIComponent(token)}`;
    } else {
        options.headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        const bodyObj = options.body ? JSON.parse(options.body) : {};
        bodyObj.session_token = token;
        options.body = JSON.stringify(bodyObj);
    }

    try {
        const res = await fetch(url, options);
        if (res.status === 401 || res.status === 403) {
            doLogout();
            return null;
        }
        return await res.json();
    } catch (err) {
        console.error(`API call failed for ${endpoint}:`, err);
        throw err;
    }
}

// --- Helpers ---
function show(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function hide(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function escHtml(s) {
    if (!s) return '';
    return s.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function typewrite(elId, text, delay = 20) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    let i = 0;
    function type() {
        if (i < text.length) {
            el.innerHTML += escHtml(text.charAt(i));
            i++;
            setTimeout(type, delay);
        }
    }
    type();
}

function shakeElement(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
}

function copySQL() {
    const codeEl = document.getElementById('sql-result-code');
    if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent);
        const copyBtn = document.getElementById('copy-sql-btn');
        if (copyBtn) {
            const originalText = copyBtn.innerText;
            copyBtn.innerText = 'Copied!';
            setTimeout(() => copyBtn.innerText = originalText, 2000);
        }
    }
}

function clearResult() {
    hide('result-card');
    hide('ai-panel');
    hide('results-section');
    document.getElementById('question-input').value = '';
    currentSQL = '';
    currentQuestion = '';
}

// --- Sidebar & Auth ---
function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.getElementById('sidebar');
    if (sidebarOpen) {
        sidebar.classList.remove('-translate-x-full');
    } else {
        sidebar.classList.add('-translate-x-full');
    }
}

async function doLogout() {
    try {
        await fetch('/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
    } catch(e) {}
    localStorage.removeItem('qm_token');
    localStorage.removeItem('qm_name');
    localStorage.removeItem('qm_email');
    window.location.href = '/';
}

function addToHistory(question, sql) {
    history.unshift({ question, sql, timestamp: new Date().toISOString() });
    if (history.length > 10) history.pop();
    renderHistory();
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    historyList.innerHTML = '';
    
    if (history.length === 0) {
        historyList.innerHTML = '<div class="text-gray-500 text-sm italic p-2">No recent history</div>';
        return;
    }
    
    history.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'p-2 hover:bg-gray-800 cursor-pointer rounded mb-1 text-sm truncate text-gray-300';
        div.onclick = () => loadHistory(i);
        div.textContent = item.question || item.sql;
        historyList.appendChild(div);
    });
}

function loadHistory(i) {
    const item = history[i];
    if (item) {
        document.getElementById('question-input').value = item.question || '';
        if (item.sql) {
            currentSQL = item.sql;
            currentQuestion = item.question;
            show('result-card');
            typewrite('sql-result-code', item.sql, 0);
        }
    }
}

// --- Database Connection ---
function openDbModal() { show('db-modal'); }
function closeDbModal() { hide('db-modal'); }

function onDbTypeChange() {
    const type = document.getElementById('db-type').value;
    const credFields = document.getElementById('db-credentials');
    if (type === 'sqlite') {
        credFields.classList.add('hidden');
    } else {
        credFields.classList.remove('hidden');
    }
}

async function checkDbStatus() {
    try {
        const data = await apiCall('/db/status');
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

function updateDbStatusUI(connected, type = '', name = '') {
    dbConnected = connected;
    const indicator = document.getElementById('db-status-indicator');
    const label = document.getElementById('db-status-label');
    const connectBtn = document.getElementById('db-connect-btn');
    const disconnectBtn = document.getElementById('db-disconnect-btn');
    
    if (indicator && label && connectBtn && disconnectBtn) {
        if (connected) {
            indicator.classList.replace('bg-red-500', 'bg-green-500');
            label.textContent = `${type} (${name})`;
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
        } else {
            indicator.classList.replace('bg-green-500', 'bg-red-500');
            label.textContent = 'Disconnected';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            const schemaExplorer = document.getElementById('schema-explorer');
            if (schemaExplorer) schemaExplorer.innerHTML = '<div class="text-gray-500 text-sm">Not connected</div>';
        }
    }
}

async function connectDatabase() {
    const db_type = document.getElementById('db-type').value;
    const host = document.getElementById('db-host').value;
    const port = document.getElementById('db-port').value;
    const database = document.getElementById('db-name').value;
    const username = document.getElementById('db-user').value;
    const password = document.getElementById('db-pass').value;
    
    const btn = document.getElementById('db-modal-connect-btn');
    const origText = btn.innerText;
    btn.innerText = 'Connecting...';
    btn.disabled = true;
    
    try {
        const res = await apiCall('/db/connect', {
            method: 'POST',
            body: JSON.stringify({ db_type, host, port, database, username, password })
        });
        
        if (res && res.status === 'success') {
            updateDbStatusUI(true, res.db_type, res.database);
            closeDbModal();
            await loadSchema();
        } else {
            alert(res.message || 'Failed to connect');
        }
    } catch (e) {
        alert('Error connecting to database.');
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
}

async function disconnectDatabase() {
    try {
        await apiCall('/db/disconnect', { method: 'POST' });
        updateDbStatusUI(false);
        currentSchemaText = '';
    } catch (e) {
        console.error('Error disconnecting', e);
    }
}

async function loadSchema() {
    try {
        const data = await apiCall('/db/schema');
        if (data && data.tables) {
            currentSchemaText = data.schema_text;
            renderSchemaExplorer(data.tables);
        }
    } catch (e) {
        console.error('Error loading schema', e);
    }
}

function renderSchemaExplorer(tables) {
    const explorer = document.getElementById('schema-explorer');
    if (!explorer) return;
    
    explorer.innerHTML = '';
    for (const [tableName, tableInfo] of Object.entries(tables)) {
        const tableDiv = document.createElement('div');
        tableDiv.className = 'mb-1';
        
        const header = document.createElement('div');
        header.className = 'flex items-center cursor-pointer hover:bg-gray-800 p-1 rounded text-sm text-gray-200';
        header.onclick = () => toggleTableExpand(tableName);
        header.innerHTML = `
            <span class="mr-2 text-gray-400" id="icon-${tableName}">▶</span>
            <span class="font-medium text-teal-400">📋 ${escHtml(tableName)}</span>
        `;
        
        const columnsDiv = document.createElement('div');
        columnsDiv.id = `cols-${tableName}`;
        columnsDiv.className = 'hidden pl-6 text-xs text-gray-400';
        
        tableInfo.columns.forEach(col => {
            const isPk = tableInfo.primary_key && tableInfo.primary_key.includes(col.name);
            const pkIcon = isPk ? '🔑 ' : '';
            columnsDiv.innerHTML += `<div class="py-0.5 truncate">${pkIcon}${escHtml(col.name)} <span class="text-gray-600">(${escHtml(col.type)})</span></div>`;
        });
        
        tableDiv.appendChild(header);
        tableDiv.appendChild(columnsDiv);
        explorer.appendChild(tableDiv);
    }
}

function toggleTableExpand(tableName) {
    const cols = document.getElementById(`cols-${tableName}`);
    const icon = document.getElementById(`icon-${tableName}`);
    if (cols && icon) {
        if (cols.classList.contains('hidden')) {
            cols.classList.remove('hidden');
            icon.textContent = '▼';
        } else {
            cols.classList.add('hidden');
            icon.textContent = '▶';
        }
    }
}

// --- SQL Generation ---
async function generateSQL() {
    const question = document.getElementById('question-input').value.trim();
    if (!question) {
        shakeElement('question-input');
        return;
    }

    const btn = document.getElementById('generate-btn');
    const spinner = document.getElementById('generate-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
        const dialect = document.getElementById('dialect-select') ? document.getElementById('dialect-select').value : 'PostgreSQL';
        
        const res = await apiCall('/generate', {
            method: 'POST',
            body: JSON.stringify({ 
                question, 
                db_schema: currentSchemaText, 
                dialect 
            })
        });

        if (res && res.sql) {
            currentSQL = res.sql;
            currentQuestion = question;
            show('result-card');
            hide('ai-panel');
            typewrite('sql-result-code', res.sql);
            
            const explanationEl = document.getElementById('sql-explanation');
            if (explanationEl) explanationEl.innerHTML = escHtml(res.explanation || '').replace(/\n/g, '<br>');
            
            addToHistory(question, res.sql);
            
            // Auto fetch suggestions and followups
            loadSuggestions();
            loadFollowups();
        }
    } catch (e) {
        alert('Error generating SQL. Please try again.');
    } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
    }
}

// --- AI Action Buttons ---
function showAiPanel(title, htmlContent) {
    show('ai-panel');
    const titleEl = document.getElementById('ai-panel-title');
    const contentEl = document.getElementById('ai-panel-content');
    if (titleEl) titleEl.textContent = title;
    if (contentEl) contentEl.innerHTML = htmlContent;
}

async function explainSQL() {
    if (!currentSQL) return;
    try {
        const res = await apiCall('/explain', {
            method: 'POST',
            body: JSON.stringify({ sql: currentSQL, dialect: 'PostgreSQL' })
        });
        
        if (res) {
            let html = `<p class="mb-2 text-gray-200">${escHtml(res.summary)}</p>`;
            html += `<h4 class="font-medium mt-3 mb-1 text-teal-400">Breakdown:</h4><ul class="list-disc pl-5 text-sm text-gray-300">`;
            (res.breakdown || []).forEach(b => html += `<li>${escHtml(b)}</li>`);
            html += `</ul>`;
            if (res.tips && res.tips.length > 0) {
                html += `<h4 class="font-medium mt-3 mb-1 text-purple-400">Tips:</h4><ul class="list-disc pl-5 text-sm text-gray-300">`;
                res.tips.forEach(t => html += `<li>${escHtml(t)}</li>`);
                html += `</ul>`;
            }
            showAiPanel('AI Explanation', html);
        }
    } catch (e) { console.error(e); }
}

async function fixSQL() {
    if (!currentSQL) return;
    const errorMsg = prompt("Enter the error message you received (or leave blank for general check):", "");
    try {
        const res = await apiCall('/fix', {
            method: 'POST',
            body: JSON.stringify({ sql: currentSQL, error_message: errorMsg, dialect: 'PostgreSQL' })
        });
        
        if (res) {
            let html = '';
            if (res.has_errors) {
                html += `<p class="text-red-400 mb-2">Errors found!</p>`;
                html += `<ul class="list-disc pl-5 mb-3 text-sm text-gray-300">`;
                (res.errors || []).forEach(e => html += `<li>${escHtml(e)}</li>`);
                html += `</ul>`;
                html += `<p class="mb-2 text-green-400 font-medium">Fixed SQL:</p>`;
                html += `<pre class="bg-gray-900 p-2 rounded text-sm text-gray-200 overflow-x-auto"><code>${escHtml(res.fixed_sql)}</code></pre>`;
                html += `<p class="mt-2 text-sm text-gray-400">${escHtml(res.explanation)}</p>`;
                
                // Option to apply
                html += `<button onclick="currentSQL=\`${res.fixed_sql.replace(/`/g, '\\`')}\`; document.getElementById('sql-result-code').textContent=currentSQL; hide('ai-panel');" class="mt-3 bg-teal-600 hover:bg-teal-500 text-white px-3 py-1 rounded text-sm">Apply Fix</button>`;
            } else {
                html = `<p class="text-green-400">No obvious syntax errors found.</p>`;
            }
            showAiPanel('SQL Fix & Debug', html);
        }
    } catch (e) { console.error(e); }
}

async function optimizeSQL() {
    if (!currentSQL) return;
    try {
        const res = await apiCall('/optimize', {
            method: 'POST',
            body: JSON.stringify({ sql: currentSQL, dialect: 'PostgreSQL', db_schema: currentSchemaText })
        });
        
        if (res) {
            let html = `<p class="mb-2">${escHtml(res.explanation)}</p>`;
            if (res.optimized_sql !== currentSQL) {
                html += `<p class="mb-2 text-purple-400 font-medium">Optimized SQL:</p>`;
                html += `<pre class="bg-gray-900 p-2 rounded text-sm text-gray-200 overflow-x-auto"><code>${escHtml(res.optimized_sql)}</code></pre>`;
            }
            
            if (res.improvements && res.improvements.length > 0) {
                html += `<h4 class="font-medium mt-3 mb-1 text-teal-400">Improvements:</h4><ul class="list-disc pl-5 text-sm text-gray-300">`;
                res.improvements.forEach(i => html += `<li>${escHtml(i)}</li>`);
                html += `</ul>`;
            }
            
            if (res.index_suggestions && res.index_suggestions.length > 0) {
                html += `<h4 class="font-medium mt-3 mb-1 text-yellow-400">Index Suggestions:</h4><ul class="list-disc pl-5 text-sm text-gray-300">`;
                res.index_suggestions.forEach(i => html += `<li>${escHtml(i)}</li>`);
                html += `</ul>`;
            }
            showAiPanel('SQL Optimization', html);
        }
    } catch (e) { console.error(e); }
}

async function translateSQL() {
    if (!currentSQL) return;
    try {
        const res = await apiCall('/sql-to-nl', {
            method: 'POST',
            body: JSON.stringify({ sql: currentSQL })
        });
        
        if (res) {
            let html = `<p class="text-lg text-gray-200 mb-3">${escHtml(res.natural_language)}</p>`;
            if (res.audience_friendly) {
                html += `<h4 class="text-sm font-medium text-purple-400 mb-1">Business Friendly:</h4>`;
                html += `<p class="text-sm text-gray-400">${escHtml(res.audience_friendly)}</p>`;
            }
            showAiPanel('Translation to English', html);
        }
    } catch (e) { console.error(e); }
}

async function validateSQL() {
    if (!currentSQL) return;
    try {
        const res = await apiCall('/validate', {
            method: 'POST',
            body: JSON.stringify({ question: currentQuestion, sql: currentSQL, db_schema: currentSchemaText, dialect: 'PostgreSQL' })
        });
        
        if (res) {
            let html = `<div class="mb-3 flex items-center"><span class="font-bold mr-2">Valid:</span> ${res.is_valid ? '<span class="text-green-400">Yes</span>' : '<span class="text-red-400">No</span>'}</div>`;
            html += `<div class="mb-3"><span class="font-bold mr-2">Confidence:</span> ${(res.confidence * 100).toFixed(0)}%</div>`;
            
            if (res.issues && res.issues.length > 0) {
                html += `<h4 class="font-medium mt-2 mb-1 text-red-400">Issues:</h4><ul class="list-disc pl-5 text-sm text-gray-300 mb-3">`;
                res.issues.forEach(i => html += `<li>${escHtml(i)}</li>`);
                html += `</ul>`;
            }
            
            if (res.corrected_sql) {
                html += `<p class="mb-2 text-green-400 font-medium">Corrected SQL:</p>`;
                html += `<pre class="bg-gray-900 p-2 rounded text-sm text-gray-200 overflow-x-auto"><code>${escHtml(res.corrected_sql)}</code></pre>`;
            }
            
            if (res.explanation) {
                html += `<p class="mt-2 text-sm text-gray-400">${escHtml(res.explanation)}</p>`;
            }
            
            showAiPanel('Validation Results', html);
        }
    } catch (e) { console.error(e); }
}

// --- Query Execution ---
async function runQuery() {
    if (!currentSQL) return;
    if (!dbConnected) {
        alert("Please connect to a database first.");
        return;
    }
    
    currentQuery.sql = currentSQL;
    show('results-section');
    switchResultsTab('table');
    document.getElementById('results-table-container').innerHTML = '<div class="text-center py-10"><div class="spinner inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div><p class="mt-2 text-gray-400">Executing query...</p></div>';

    try {
        const res = await apiCall('/db/execute', {
            method: 'POST',
            body: JSON.stringify(currentQuery)
        });
        
        if (res && res.columns) {
            currentResults = res;
            renderResultsTable(res);
            renderPagination(res);
            renderStats(res.stats);
            
            // Populate chart dropdowns
            populateChartDropdowns(res.columns);
            
            // Auto fetch insights
            loadInsights(res);
        } else if (res && res.error) {
            document.getElementById('results-table-container').innerHTML = `<div class="text-red-400 p-4 bg-red-900 bg-opacity-20 rounded border border-red-800">${escHtml(res.error)}</div>`;
        }
    } catch (e) {
        document.getElementById('results-table-container').innerHTML = `<div class="text-red-400 p-4">Error executing query.</div>`;
    }
}

function renderResultsTable(data) {
    const container = document.getElementById('results-table-container');
    if (!container) return;
    
    if (!data.rows || data.rows.length === 0) {
        container.innerHTML = '<div class="p-4 text-gray-400">No results found.</div>';
        return;
    }

    let html = `<div class="overflow-x-auto"><table class="w-full text-left text-sm text-gray-300">`;
    
    // Headers
    html += `<thead class="text-xs uppercase bg-gray-800 text-gray-400"><tr>`;
    data.columns.forEach(col => {
        const sortIndicator = currentQuery.sortColumn === col ? (currentQuery.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
        html += `<th class="px-4 py-3 cursor-pointer hover:text-white" onclick="sortResults('${escHtml(col)}')">${escHtml(col)}${sortIndicator}</th>`;
    });
    html += `</tr>`;
    
    // Filters
    html += `<tr class="bg-gray-900 border-b border-gray-700">`;
    data.columns.forEach(col => {
        const filterVal = currentQuery.filters[col] || '';
        html += `<th class="px-2 py-1"><input type="text" class="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white" placeholder="Filter..." data-col="${escHtml(col)}" value="${escHtml(filterVal)}" onchange="filterResults()"></th>`;
    });
    html += `</tr></thead><tbody>`;
    
    // Rows
    data.rows.forEach(row => {
        html += `<tr class="border-b border-gray-800 hover:bg-gray-800">`;
        data.columns.forEach(col => {
            let val = row[col];
            if (val === null) val = '<span class="text-gray-500 italic">null</span>';
            else if (typeof val === 'object') val = JSON.stringify(val);
            else val = escHtml(String(val));
            html += `<td class="px-4 py-2">${val}</td>`;
        });
        html += `</tr>`;
    });
    
    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

function sortResults(column) {
    if (currentQuery.sortColumn === column) {
        currentQuery.sortDir = currentQuery.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        currentQuery.sortColumn = column;
        currentQuery.sortDir = 'asc';
    }
    runQuery();
}

function filterResults() {
    const inputs = document.querySelectorAll('#results-table-container input[data-col]');
    currentQuery.filters = {};
    inputs.forEach(input => {
        if (input.value.trim()) {
            currentQuery.filters[input.getAttribute('data-col')] = input.value.trim();
        }
    });
    currentQuery.page = 1;
    runQuery();
}

function changePage(page) {
    currentQuery.page = page;
    runQuery();
}

function renderPagination(data) {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    
    if (data.total_pages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = `<div class="flex items-center space-x-2 text-sm mt-4 justify-end">`;
    html += `<button class="px-3 py-1 bg-gray-800 rounded hover:bg-gray-700 disabled:opacity-50" ${data.page === 1 ? 'disabled' : ''} onclick="changePage(${data.page - 1})">Prev</button>`;
    html += `<span class="text-gray-400">Page ${data.page} of ${data.total_pages} (${data.total_rows} total)</span>`;
    html += `<button class="px-3 py-1 bg-gray-800 rounded hover:bg-gray-700 disabled:opacity-50" ${data.page === data.total_pages ? 'disabled' : ''} onclick="changePage(${data.page + 1})">Next</button>`;
    html += `</div>`;
    
    container.innerHTML = html;
}

// --- Tabs ---
function switchResultsTab(tab) {
    ['table', 'charts', 'insights', 'stats'].forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const content = document.getElementById(`tab-content-${t}`);
        if (btn && content) {
            if (t === tab) {
                btn.classList.add('border-b-2', 'border-purple-500', 'text-purple-400');
                btn.classList.remove('text-gray-400');
                content.classList.remove('hidden');
                
                // If switching to charts and canvas is empty but we have a chart config, maybe re-render
                if (tab === 'charts' && currentResults.columns.length > 0 && !currentChart) {
                    renderChart();
                }
            } else {
                btn.classList.remove('border-b-2', 'border-purple-500', 'text-purple-400');
                btn.classList.add('text-gray-400');
                content.classList.add('hidden');
            }
        }
    });
}

// --- Charts ---
function populateChartDropdowns(columns) {
    const xSel = document.getElementById('chart-x');
    const ySel = document.getElementById('chart-y');
    if (!xSel || !ySel) return;
    
    xSel.innerHTML = '';
    ySel.innerHTML = '';
    
    columns.forEach(col => {
        xSel.innerHTML += `<option value="${escHtml(col)}">${escHtml(col)}</option>`;
        ySel.innerHTML += `<option value="${escHtml(col)}">${escHtml(col)}</option>`;
    });
    
    if (columns.length >= 2) {
        ySel.selectedIndex = 1;
    }
}

function destroyChart() {
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
}

function renderChart() {
    if (!currentResults || !currentResults.rows || currentResults.rows.length === 0) return;
    
    const type = document.getElementById('chart-type').value;
    const xCol = document.getElementById('chart-x').value;
    const yCol = document.getElementById('chart-y').value;
    
    if (!xCol || !yCol) return;
    
    const ctx = document.getElementById('results-chart');
    if (!ctx) return;
    
    destroyChart();
    
    const labels = currentResults.rows.map(r => String(r[xCol] || ''));
    const data = currentResults.rows.map(r => {
        const val = parseFloat(r[yCol]);
        return isNaN(val) ? 0 : val;
    });
    
    let backgroundColor = CHART_COLORS[0];
    if (type === 'pie' || type === 'doughnut') {
        backgroundColor = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    }
    
    currentChart = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: yCol,
                data: data,
                backgroundColor: backgroundColor,
                borderColor: type === 'line' ? CHART_COLORS[0] : '#1f2937',
                borderWidth: 1,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#d1d5db' },
                    display: type === 'pie' || type === 'doughnut'
                }
            },
            scales: (type === 'pie' || type === 'doughnut') ? {} : {
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
            }
        }
    });
}

// --- Insights ---
async function loadInsights(resData) {
    const container = document.getElementById('insights-container');
    if (!container) return;
    
    container.innerHTML = '<div class="text-gray-400 text-sm">Generating AI insights...</div>';
    
    try {
        const res = await apiCall('/insights', {
            method: 'POST',
            body: JSON.stringify({
                sql: currentSQL,
                results: resData.rows.slice(0, 50), // Send sample for insights
                columns: resData.columns
            })
        });
        
        if (res && res.insights) {
            let html = `<p class="text-gray-200 mb-4">${escHtml(res.summary || '')}</p>`;
            html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">`;
            
            res.insights.forEach(ins => {
                let icon = '💡';
                if (ins.type === 'trend') icon = '📈';
                if (ins.type === 'anomaly') icon = '⚠️';
                
                html += `
                <div class="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <div class="flex items-center mb-2">
                        <span class="mr-2">${icon}</span>
                        <h4 class="font-medium text-teal-400">${escHtml(ins.title)}</h4>
                    </div>
                    <p class="text-sm text-gray-300">${escHtml(ins.description)}</p>
                </div>`;
            });
            html += `</div>`;
            
            if (res.chart_recommendation) {
                html += `<div class="mt-4 p-3 bg-purple-900 bg-opacity-20 border border-purple-800 rounded text-sm text-purple-300">
                    <span class="font-bold">Recommendation:</span> ${escHtml(res.chart_recommendation)}
                </div>`;
            }
            
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div class="text-gray-500">No insights could be generated.</div>';
        }
    } catch (e) {
        container.innerHTML = '<div class="text-red-400">Failed to load insights.</div>';
    }
}

// --- Stats ---
function renderStats(stats) {
    const container = document.getElementById('stats-container');
    if (!container || !stats) return;
    
    if (Object.keys(stats).length === 0) {
        container.innerHTML = '<div class="text-gray-500">No statistics available.</div>';
        return;
    }
    
    let html = `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">`;
    for (const [col, colStats] of Object.entries(stats)) {
        html += `<div class="bg-gray-800 p-4 rounded border border-gray-700">
            <h4 class="font-bold text-gray-200 mb-2 truncate" title="${escHtml(col)}">${escHtml(col)}</h4>
            <div class="space-y-1 text-sm">`;
        
        if (colStats.type === 'numeric') {
            html += `<div class="flex justify-between"><span class="text-gray-400">Min:</span> <span class="text-gray-200">${colStats.min}</span></div>`;
            html += `<div class="flex justify-between"><span class="text-gray-400">Max:</span> <span class="text-gray-200">${colStats.max}</span></div>`;
            html += `<div class="flex justify-between"><span class="text-gray-400">Avg:</span> <span class="text-gray-200">${parseFloat(colStats.avg).toFixed(2)}</span></div>`;
            if (colStats.sum) html += `<div class="flex justify-between"><span class="text-gray-400">Sum:</span> <span class="text-gray-200">${colStats.sum}</span></div>`;
        } else {
            html += `<div class="flex justify-between"><span class="text-gray-400">Unique:</span> <span class="text-gray-200">${colStats.unique_count}</span></div>`;
            if (colStats.top_values && colStats.top_values.length > 0) {
                html += `<div class="text-gray-400 mt-2">Top Values:</div>`;
                colStats.top_values.slice(0, 3).forEach(tv => {
                    html += `<div class="flex justify-between text-xs pl-2"><span class="text-gray-300 truncate w-3/4">${escHtml(String(tv.value))}</span> <span class="text-teal-400">${tv.count}</span></div>`;
                });
            }
        }
        
        html += `</div></div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
}

// --- Suggestions & Followups ---
async function loadSuggestions() {
    const container = document.getElementById('suggestions-container');
    if (!container) return;
    
    try {
        const res = await apiCall('/suggestions', {
            method: 'POST',
            body: JSON.stringify({ question: currentQuestion, sql: currentSQL, db_schema: currentSchemaText })
        });
        
        if (res && res.suggestions) {
            let html = '<div class="flex flex-wrap gap-2 mt-2">';
            res.suggestions.forEach(s => {
                html += `<button onclick="document.getElementById('question-input').value='${escHtml(s.question).replace(/'/g, "\\'")}'; generateSQL();" class="text-xs bg-gray-800 hover:bg-gray-700 text-teal-400 border border-gray-700 px-3 py-1.5 rounded-full transition-colors cursor-pointer">${escHtml(s.question)}</button>`;
            });
            html += '</div>';
            container.innerHTML = html;
        }
    } catch (e) {
        container.innerHTML = '';
    }
}

async function loadFollowups() {
    const container = document.getElementById('followups-container');
    if (!container) return;
    
    try {
        const res = await apiCall('/followup', {
            method: 'POST',
            body: JSON.stringify({ question: currentQuestion, sql: currentSQL, db_schema: currentSchemaText })
        });
        
        if (res && res.followups) {
            let html = '<h4 class="text-sm font-medium text-gray-400 mb-2">Follow-up Questions:</h4><div class="flex flex-col gap-2">';
            res.followups.forEach(f => {
                html += `<div onclick="document.getElementById('question-input').value='${escHtml(f.question).replace(/'/g, "\\'")}'; generateSQL();" class="text-sm bg-gray-800 hover:bg-purple-900 hover:bg-opacity-40 text-gray-300 border border-gray-700 px-3 py-2 rounded transition-colors cursor-pointer flex justify-between items-center">
                    <span>${escHtml(f.question)}</span>
                    <span class="text-xs text-purple-400">${escHtml(f.intent)}</span>
                </div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        }
    } catch (e) {
        container.innerHTML = '';
    }
}

// --- ER Diagram ---
function openErDiagram() {
    show('er-modal');
    loadAndRenderErDiagram();
}

function closeErDiagram() {
    hide('er-modal');
}

async function loadAndRenderErDiagram() {
    const canvas = document.getElementById('er-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px Inter, sans-serif';
    ctx.fillText('Loading ER Diagram...', 20, 30);
    
    try {
        const data = await apiCall('/db/er-diagram');
        if (data && data.nodes) {
            renderErDiagram(data);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText('No schema data available or failed to load.', 20, 30);
        }
    } catch (e) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f87171';
        ctx.fillText('Error loading ER diagram.', 20, 30);
    }
}

function renderErDiagram(data) {
    const canvas = document.getElementById('er-canvas');
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Simple auto-layout if coordinates are missing or all zero
    let xOffset = 50;
    let yOffset = 50;
    
    const boxWidth = 200;
    const rowHeight = 20;
    
    // Draw edges first so they are under boxes
    ctx.strokeStyle = '#60a5fa'; // Blue-ish lines for relationships
    ctx.lineWidth = 1.5;
    
    if (data.edges) {
        data.edges.forEach(edge => {
            const fromNode = data.nodes.find(n => n.id === edge.from);
            const toNode = data.nodes.find(n => n.id === edge.to);
            
            if (fromNode && toNode) {
                // Approximate connection points
                const fromX = (fromNode.x || 0) + boxWidth / 2;
                const fromY = (fromNode.y || 0) + 20; // Top header approx
                const toX = (toNode.x || 0) + boxWidth / 2;
                const toY = (toNode.y || 0) + 20;
                
                ctx.beginPath();
                ctx.moveTo(fromX, fromY);
                // Simple orthogonal routing
                ctx.lineTo(fromX, fromY + (toY - fromY)/2);
                ctx.lineTo(toX, fromY + (toY - fromY)/2);
                ctx.lineTo(toX, toY);
                ctx.stroke();
                
                // Draw arrow
                ctx.beginPath();
                ctx.moveTo(toX, toY);
                ctx.lineTo(toX - 5, toY - 10);
                ctx.lineTo(toX + 5, toY - 10);
                ctx.fillStyle = '#60a5fa';
                ctx.fill();
            }
        });
    }
    
    // Draw nodes (tables)
    data.nodes.forEach(node => {
        // Fallback layout if API didn't provide x, y
        if (node.x === undefined || node.y === undefined) {
            node.x = xOffset;
            node.y = yOffset;
            xOffset += boxWidth + 50;
            if (xOffset > canvas.width - boxWidth) {
                xOffset = 50;
                yOffset += 200;
            }
        }
        
        const boxHeight = 30 + (node.columns ? node.columns.length * rowHeight : 0);
        
        // Background
        ctx.fillStyle = '#1f2937'; // gray-800
        ctx.fillRect(node.x, node.y, boxWidth, boxHeight);
        
        // Border
        ctx.strokeStyle = '#374151'; // gray-700
        ctx.lineWidth = 1;
        ctx.strokeRect(node.x, node.y, boxWidth, boxHeight);
        
        // Header (Table name)
        ctx.fillStyle = '#4c1d95'; // purple-900
        ctx.fillRect(node.x, node.y, boxWidth, 30);
        ctx.fillStyle = '#e5e7eb'; // gray-200
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillText(node.label || node.id, node.x + 10, node.y + 20);
        
        // Columns
        if (node.columns) {
            ctx.font = '12px Inter, sans-serif';
            node.columns.forEach((col, i) => {
                const isPk = typeof col === 'object' && col.is_pk;
                const colName = typeof col === 'object' ? col.name : col;
                const colType = typeof col === 'object' ? col.type : '';
                
                ctx.fillStyle = '#9ca3af'; // gray-400
                const yPos = node.y + 45 + (i * rowHeight);
                
                if (isPk) {
                    ctx.fillText('🔑', node.x + 5, yPos);
                }
                
                ctx.fillStyle = '#d1d5db'; // gray-300
                ctx.fillText(colName, node.x + 25, yPos);
                
                if (colType) {
                    ctx.fillStyle = '#6b7280'; // gray-500
                    ctx.textAlign = 'right';
                    ctx.fillText(colType, node.x + boxWidth - 10, yPos);
                    ctx.textAlign = 'left'; // reset
                }
            });
        }
    });
}
