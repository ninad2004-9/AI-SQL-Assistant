/**
 * QueryMind — New Features Extension
 * Features: Monaco Editor, Performance Analyzer, Schema Search,
 *           Excel/JSON Export, Chart PNG Export, AI Table Documentation
 */

// ── Monaco Editor (Feature: Advanced SQL Editor) ─────────────────────────────
let monacoEditor = null;
let monacoReady = false;
let schemaCompletionDisposable = null;

function initMonacoEditor(initialValue = '') {
  if (typeof require === 'undefined' || !window.MonacoEnvironment) {
    // Set up Monaco loader environment
    window.MonacoEnvironment = {
      getWorkerUrl: function (moduleId, label) {
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
          self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/' };
          importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/base/worker/workerMain.min.js');
        `)}`;
      }
    };
  }

  require.config({
    paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }
  });

  require(['vs/editor/editor.main'], function (monaco) {
    const container = document.getElementById('monaco-container');
    if (!container) return;

    // Create editor
    monacoEditor = monaco.editor.create(container, {
      value: initialValue,
      language: 'sql',
      theme: 'vs-dark',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      lineNumbers: 'on',
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      renderLineHighlight: 'all',
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      parameterHints: { enabled: true },
      formatOnPaste: false,
      tabSize: 2,
      padding: { top: 10, bottom: 10 },
    });

    // Override the dark theme to match app colors
    monaco.editor.defineTheme('querymind-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '7c6af7', fontStyle: 'bold' },
        { token: 'string', foreground: '5eead4' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'comment', foreground: '555570', fontStyle: 'italic' },
        { token: 'operator', foreground: 'f87171' },
        { token: 'identifier', foreground: 'e8e8f0' },
      ],
      colors: {
        'editor.background': '#13131a',
        'editor.foreground': '#e8e8f0',
        'editor.lineHighlightBackground': '#1c1c27',
        'editor.selectionBackground': '#3730a320',
        'editorLineNumber.foreground': '#555570',
        'editorLineNumber.activeForeground': '#8888a8',
        'editor.findMatchBackground': '#7c6af720',
        'editor.findMatchHighlightBackground': '#7c6af710',
        'editorGutter.background': '#13131a',
        'editorSuggestWidget.background': '#1c1c27',
        'editorSuggestWidget.border': '#2a2a3a',
        'editorSuggestWidget.selectedBackground': '#2a2a3a',
      }
    });
    monaco.editor.setTheme('querymind-dark');

    monacoReady = true;

    // Sync Monaco content to currentSQL on change
    monacoEditor.onDidChangeModelContent(() => {
      currentSQL = monacoEditor.getValue();
    });

    // Register schema-aware SQL completions
    refreshSchemaCompletions(monaco);

    // Ctrl+Enter to generate SQL from Monaco context
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      generateSQL();
    });

    // Alt+Shift+F format shortcut
    monacoEditor.addCommand(
      monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      () => formatSQL()
    );

    console.log('[Monaco] Editor initialized');
  });
}

function refreshSchemaCompletions(monaco) {
  if (!monaco || !currentSchemaData) return;

  // Dispose old completions
  if (schemaCompletionDisposable) {
    schemaCompletionDisposable.dispose();
  }

  const tables = Object.keys(currentSchemaData);
  const completionItems = [];

  // Add table name completions
  tables.forEach(tbl => {
    completionItems.push({
      label: tbl,
      kind: monaco.languages.CompletionItemKind.Class,
      detail: `Table (${currentSchemaData[tbl].columns?.length || 0} columns, ${currentSchemaData[tbl].row_count || 0} rows)`,
      insertText: tbl,
      documentation: `Table: ${tbl}`,
    });

    // Add column completions with table prefix
    (currentSchemaData[tbl].columns || []).forEach(col => {
      completionItems.push({
        label: `${tbl}.${col.name}`,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: `${col.type}${col.nullable === false ? ' NOT NULL' : ''}`,
        insertText: col.name,
        documentation: `Column: ${tbl}.${col.name} (${col.type})`,
      });
      // Also add bare column name
      completionItems.push({
        label: col.name,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: `${col.type} — from ${tbl}`,
        insertText: col.name,
        sortText: `b_${col.name}`,
      });
    });
  });

  schemaCompletionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems: function (model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: completionItems.map(item => ({ ...item, range }))
      };
    }
  });
}

// Set SQL value in Monaco (and fallback pre element)
function setMonacoSQL(sql) {
  currentSQL = sql;
  if (monacoEditor && monacoReady) {
    monacoEditor.setValue(sql || '');
  }
  // Always sync fallback too
  const codeEl = document.getElementById('sql-output');
  if (codeEl) codeEl.textContent = sql || '';
}

// Get SQL from Monaco (with fallback)
function getMonacoSQL() {
  if (monacoEditor && monacoReady) {
    return monacoEditor.getValue().trim();
  }
  // Fallback to pre element
  const codeEl = document.getElementById('sql-output');
  return codeEl ? codeEl.textContent.trim() : '';
}

// Format SQL using Monaco's built-in formatter
function formatSQL() {
  if (monacoEditor && monacoReady) {
    monacoEditor.getAction('editor.action.formatDocument')?.run();
  }
}

// Download SQL as file
function downloadSQL() {
  const sql = getMonacoSQL() || currentSQL;
  if (!sql) return;
  const blob = new Blob([sql], { type: 'text/sql;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `query_${Date.now()}.sql`;
  a.click();
  URL.revokeObjectURL(url);
}

// Mark errors in Monaco editor
function markMonacoErrors(errors) {
  if (!monacoEditor || !monacoReady || !window.monaco) return;
  const model = monacoEditor.getModel();
  if (!model) return;

  const markers = errors.map(err => ({
    severity: window.monaco.MarkerSeverity.Error,
    message: err.description || err.message || 'Error',
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: model.getLineCount(),
    endColumn: 999,
  }));
  window.monaco.editor.setModelMarkers(model, 'querymind', markers);
}

function clearMonacoErrors() {
  if (!monacoEditor || !monacoReady || !window.monaco) return;
  const model = monacoEditor.getModel();
  if (model) window.monaco.editor.setModelMarkers(model, 'querymind', []);
}


// ── Advanced Schema Explorer — Search & AI Documentation ─────────────────────

let _schemaSearchQuery = '';

function filterSchema(query) {
  _schemaSearchQuery = (query || '').toLowerCase().trim();
  if (!currentSchemaData) return;
  renderSchemaExplorer(currentSchemaData, _schemaSearchQuery);
}

// Upgraded renderSchemaExplorer — adds search, constraint badges, AI doc button, FK details
function renderSchemaExplorerEnhanced(tables, searchQuery = '') {
  const container = document.getElementById('schema-list');
  if (!container) return;

  const tableNames = Object.keys(tables);
  if (tableNames.length === 0) {
    container.innerHTML = '<p class="history-empty">No tables detected in database</p>';
    return;
  }

  // Filter by search
  const filtered = searchQuery
    ? tableNames.filter(tbl => {
        if (tbl.toLowerCase().includes(searchQuery)) return true;
        return (tables[tbl].columns || []).some(c => c.name.toLowerCase().includes(searchQuery));
      })
    : tableNames;

  if (filtered.length === 0) {
    container.innerHTML = `<p class="history-empty">No tables or columns matching "${escHtml(searchQuery)}"</p>`;
    return;
  }

  let html = '';
  filtered.forEach((tblName, idx) => {
    const tbl = tables[tblName];
    const rowCount = tbl.row_count >= 0 ? `${tbl.row_count} rows` : '';
    const colCount = tbl.columns ? `${tbl.columns.length} cols` : '';
    const pkCols = tbl.primary_key || [];
    const fkMap = {};
    (tbl.foreign_keys || []).forEach(fk => {
      fk.columns.forEach(c => { fkMap[c] = fk.referred_table; });
    });

    // Filter columns if search active
    const displayCols = searchQuery
      ? (tbl.columns || []).filter(c => c.name.toLowerCase().includes(searchQuery) || tblName.toLowerCase().includes(searchQuery))
      : (tbl.columns || []);

    html += `
      <div class="schema-table" id="tbl-wrap-${idx}">
        <div class="schema-table-header" onclick="toggleTableColumns(${idx})" title="Click to expand columns">
          <span class="arrow" id="arrow-${idx}">▶</span>
          <span class="tbl-icon">🗄️</span>
          <span class="tbl-name" title="${escHtml(tblName)}">${escHtml(tblName)}</span>
          <span class="tbl-col-badge">${colCount}</span>
          <span class="row-count">${rowCount}</span>
        </div>
        <div class="schema-table-cols" id="cols-${idx}">
          <div style="padding: 4px 0 8px 0; display:flex; gap:4px; justify-content:space-between; align-items:center; flex-wrap:wrap;">
            <button class="btn-icon-sm" onclick="queryTable('${escHtml(tblName)}')" title="Query sample records">⚡ Query</button>
            <button class="btn-icon-sm schema-doc-btn" onclick="generateTableDoc('${escHtml(tblName)}', ${idx})" title="Generate AI table documentation">🤖 AI Doc</button>
            <span style="font-size:0.65rem; color:var(--text3);">${tbl.columns ? tbl.columns.length : 0} columns</span>
          </div>
          <div id="table-doc-${idx}" class="table-doc-box" style="display:none;"></div>
          ${displayCols.map(col => {
            const isPk = pkCols.includes(col.name);
            const fkTarget = fkMap[col.name];
            const isNotNull = col.nullable === false;
            const hasDefault = col.default && col.default !== 'None';
            return `
              <div class="schema-col" title="${escHtml(col.name)}: ${escHtml(col.type)}">
                <div class="schema-col-name">
                  ${isPk ? '<span class="pk-badge" title="Primary Key">🔑</span>' : ''}
                  ${fkTarget ? `<span class="fk-badge" title="Foreign Key → ${escHtml(fkTarget)}">🔗</span>` : ''}
                  <span title="${escHtml(col.name)}">${escHtml(col.name)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:3px; flex-shrink:0;">
                  ${isNotNull ? '<span class="constraint-badge nn-badge" title="NOT NULL">NN</span>' : ''}
                  ${hasDefault ? `<span class="constraint-badge def-badge" title="Default: ${escHtml(col.default)}">DEF</span>` : ''}
                  <span class="col-type" title="${escHtml(col.type)}">${escHtml(col.type.split('(')[0])}</span>
                </div>
              </div>
            `;
          }).join('')}
          ${fkMap && Object.keys(fkMap).length > 0 ? `
            <div style="margin-top:6px; padding-top:5px; border-top:1px solid var(--border);">
              ${Object.entries(fkMap).map(([col, target]) => `
                <div style="font-size:0.65rem; color:var(--text3); padding:2px 0;">
                  🔗 <code style="color:var(--accent2);">${escHtml(col)}</code> → <code style="color:var(--accent);">${escHtml(target)}</code>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Auto-expand tables that match search
  if (searchQuery) {
    filtered.forEach((_, idx) => {
      const cols = document.getElementById(`cols-${idx}`);
      const arrow = document.getElementById(`arrow-${idx}`);
      if (cols && arrow) {
        cols.classList.add('open');
        arrow.classList.add('open');
      }
    });
  }
}

// Override the original renderSchemaExplorer
const _originalRenderSchemaExplorer = window.renderSchemaExplorer;
window.renderSchemaExplorer = function(tables, searchQuery) {
  renderSchemaExplorerEnhanced(tables, searchQuery || _schemaSearchQuery);
  // Refresh Monaco completions when schema updates
  if (monacoReady && window.monaco) {
    refreshSchemaCompletions(window.monaco);
  }
};

// AI Table Documentation
async function generateTableDoc(tableName, idx) {
  const docBox = document.getElementById(`table-doc-${idx}`);
  if (!docBox) return;

  docBox.style.display = 'block';
  docBox.innerHTML = `
    <div class="loading-inline" style="padding:6px 0;">
      <div class="dot-loader"><span></span><span></span><span></span></div>
      <span style="font-size:0.72rem;">Generating documentation…</span>
    </div>
  `;

  try {
    const res = await apiCall('/db/table-doc', 'POST', { table_name: tableName });
    if (res) {
      let html = `<div class="table-doc-content">`;
      if (res.purpose) {
        html += `<p class="doc-purpose"><strong>📌 Purpose:</strong> ${escHtml(res.purpose)}</p>`;
      }
      if (res.business_context) {
        html += `<p class="doc-context">${escHtml(res.business_context)}</p>`;
      }
      if (res.key_columns && res.key_columns.length > 0) {
        html += `<div class="doc-section-title">Key Columns</div>`;
        html += res.key_columns.map(kc =>
          `<div class="doc-col-row"><code>${escHtml(kc.name)}</code> — <span>${escHtml(kc.description)}</span></div>`
        ).join('');
      }
      if (res.typical_queries && res.typical_queries.length > 0) {
        html += `<div class="doc-section-title">Typical Queries</div>`;
        html += res.typical_queries.map(q =>
          `<div class="doc-query-pill" onclick="applySuggestion('${escAttr(q)}')" title="Click to use this query">💬 ${escHtml(q)}</div>`
        ).join('');
      }
      html += `</div>`;
      docBox.innerHTML = html;
    }
  } catch (err) {
    docBox.innerHTML = `<p style="color:var(--error); font-size:0.75rem;">Could not generate documentation: ${escHtml(err.message)}</p>`;
  }
}


// ── AI Query Performance Analyzer ────────────────────────────────────────────

async function analyzeQueryPerformance() {
  const sql = getMonacoSQL() || currentSQL;
  if (!sql) {
    showError('No SQL query to analyze. Generate or write a query first.');
    return;
  }

  if (!dbConnected) {
    showError('Connect to a database first to analyze query performance.');
    openDbModal();
    return;
  }

  setAiPanelLoading('Running EXPLAIN ANALYZE and analyzing query execution plan…');
  show('ai-panel');

  try {
    const res = await apiCall('/db/explain-plan', 'POST', { sql });

    if (res && res.analysis) {
      const a = res.analysis;
      const plan = res.plan;

      const scoreColor = a.overall_score === 'good' ? 'var(--success)' :
                         a.overall_score === 'fair' ? 'var(--warning)' : 'var(--error)';
      const scoreIcon = a.overall_score === 'good' ? '✅' :
                        a.overall_score === 'fair' ? '⚠️' : '🚨';

      let html = `
        <div class="ai-section">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <span style="font-size:1.4rem;">${scoreIcon}</span>
            <div>
              <div style="font-size:0.88rem; font-weight:600; color:${scoreColor}; text-transform:capitalize;">
                ${escHtml(a.overall_score || 'unknown')} Performance
              </div>
              <p style="font-size:0.8rem; color:var(--text2); margin-top:2px;">${escHtml(a.summary || '')}</p>
            </div>
          </div>
        </div>
      `;

      // Raw plan display
      if (plan && plan.raw_text) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">EXPLAIN Plan (${escHtml(plan.dialect || 'sql')})</div>
            <pre class="ai-sql-block" style="max-height:160px; overflow-y:auto; font-size:0.72rem; white-space:pre-wrap; color:var(--text2);">${escHtml(String(plan.raw_text).slice(0, 2000))}</pre>
          </div>
        `;
      }

      // Findings
      if (a.findings && a.findings.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">Performance Findings</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${a.findings.map(f => `
                <div class="perf-finding severity-${escHtml(f.severity || 'low')}">
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                    <span class="ai-tag ${f.severity === 'high' ? 'critical' : f.severity === 'medium' ? 'warning' : 'low'}">${escHtml(f.severity || 'low')}</span>
                    <strong style="font-size:0.8rem;">${escHtml(f.title || '')}</strong>
                  </div>
                  <p style="font-size:0.77rem; color:var(--text2);">${escHtml(f.description || '')}</p>
                  ${f.location ? `<p style="font-size:0.7rem; color:var(--text3); margin-top:2px;">📍 ${escHtml(f.location)}</p>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Index recommendations
      if (a.index_recommendations && a.index_recommendations.length > 0) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">💡 Recommended Indexes</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${a.index_recommendations.map(idx => `
                <div style="background:var(--surface2); padding:8px 12px; border-radius:8px; border:1px solid rgba(94,234,212,0.2);">
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <strong style="color:var(--accent2); font-size:0.8rem;">${escHtml(idx.table)}</strong>
                    <span style="color:var(--text3); font-size:0.72rem;">(${escHtml((idx.columns || []).join(', '))})</span>
                    ${idx.type ? `<span class="constraint-badge" style="font-size:0.62rem;">${escHtml(idx.type)}</span>` : ''}
                  </div>
                  ${idx.sql ? `<pre class="ai-sql-block" style="margin:4px 0;">${escHtml(idx.sql)}</pre>` : ''}
                  <p style="font-size:0.75rem; color:var(--text2);">${escHtml(idx.reason || '')}</p>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Rewrite suggestion
      if (a.rewrite_suggestion && a.rewrite_suggestion.trim()) {
        html += `
          <div class="ai-section">
            <div class="ai-section-title">⚡ Suggested Query Rewrite</div>
            <pre class="ai-sql-block">${escHtml(a.rewrite_suggestion)}</pre>
            <button class="btn-primary" style="padding:6px 14px; font-size:0.8rem; width:auto; margin-top:8px;" onclick="applyFixedSql('${escAttr(a.rewrite_suggestion)}')">
              Apply Rewrite
            </button>
          </div>
        `;
      }

      // Estimated improvement
      if (a.estimated_improvement) {
        html += `
          <div class="ai-section" style="background:rgba(74,222,128,0.05); border:1px solid rgba(74,222,128,0.15); border-radius:8px; padding:8px 12px;">
            <strong style="color:var(--success); font-size:0.78rem;">📈 Expected Improvement</strong>
            <p style="font-size:0.78rem; color:var(--text2); margin-top:3px;">${escHtml(a.estimated_improvement)}</p>
          </div>
        `;
      }

      showAiPanel('🔬 Query Performance Analyzer', html);
    }
  } catch (err) {
    showAiPanel('🔬 Query Performance Analyzer', `
      <div class="ai-section">
        <p style="color:var(--error);">${escHtml(err.message)}</p>
        <p style="color:var(--text2); font-size:0.78rem; margin-top:6px;">Note: EXPLAIN ANALYZE requires a connected database. Make sure you are connected and the SQL is a valid SELECT query.</p>
      </div>
    `);
  }
}


// ── Export Results — Excel & JSON ─────────────────────────────────────────────

function exportResultsExcel() {
  if (!currentResults.rows || currentResults.rows.length === 0) {
    showError('No result rows to export.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showError('SheetJS library not loaded. Check your internet connection.');
    return;
  }

  try {
    const cols = currentResults.columns;
    const rows = currentResults.rows;

    // Build array of arrays with headers
    const wsData = [cols, ...rows.map(r => cols.map(c => r[c] ?? null))];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-fit column widths
    const colWidths = cols.map((col, i) => ({
      wch: Math.max(col.length, ...rows.slice(0, 50).map(r => String(r[col] ?? '').length), 8)
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Query Results');
    XLSX.writeFile(wb, `query_results_${Date.now()}.xlsx`);
  } catch (err) {
    showError(`Excel export failed: ${err.message}`);
  }
}

function exportResultsJson() {
  if (!currentResults.rows || currentResults.rows.length === 0) {
    showError('No result rows to export.');
    return;
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    sql: currentSQL || '',
    total_rows: currentResults.totalRows,
    columns: currentResults.columns,
    rows: currentResults.rows,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `query_results_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}


// ── Results Global Search ─────────────────────────────────────────────────────

let _resultsSearchTimer = null;
let _allResultRows = []; // store unfiltered rows

function onResultsSearch(query) {
  clearTimeout(_resultsSearchTimer);
  _resultsSearchTimer = setTimeout(() => {
    filterResultsTable(query);
  }, 200);
}

function filterResultsTable(query) {
  const q = (query || '').toLowerCase().trim();
  const cols = currentResults.columns;
  const rows = _allResultRows.length > 0 ? _allResultRows : currentResults.rows;

  if (!q) {
    // Restore all rows
    if (_allResultRows.length > 0) {
      renderDataTableRows(cols, _allResultRows);
    }
    return;
  }

  // Filter rows where any cell matches
  const filtered = rows.filter(row =>
    cols.some(col => {
      const v = row[col];
      return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
    })
  );

  renderDataTableRows(cols, filtered);
}

// Render only tbody rows (used by search filter)
function renderDataTableRows(cols, rows) {
  const tbody = document.getElementById('results-table-body');
  if (!tbody) return;

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
}


// ── Chart PNG Export ──────────────────────────────────────────────────────────

function exportChartPng() {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas || !chartInstance) {
    showError('No chart to export. Render a chart first.');
    return;
  }

  // Create a white-background version for PNG
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const ctx = exportCanvas.getContext('2d');
  ctx.fillStyle = '#13131a';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  exportCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}


// ── Event Listeners for New Features ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Monaco format/download buttons
  document.getElementById('btn-format-sql')?.addEventListener('click', formatSQL);
  document.getElementById('btn-download-sql')?.addEventListener('click', downloadSQL);

  // Performance Analyzer
  document.getElementById('btn-analyze-perf')?.addEventListener('click', analyzeQueryPerformance);

  // Excel / JSON export
  document.getElementById('btn-export-excel')?.addEventListener('click', exportResultsExcel);
  document.getElementById('btn-export-json')?.addEventListener('click', exportResultsJson);

  // Chart PNG export
  document.getElementById('btn-export-chart')?.addEventListener('click', exportChartPng);

  // Initialize Monaco after a brief delay to let app.js finish
  setTimeout(() => {
    if (typeof require !== 'undefined') {
      initMonacoEditor('');
    }
  }, 500);
});


// ── Monkey-patch existing functions to integrate Monaco ───────────────────────

// Override getSqlFromOutput to use Monaco
const _origGetSqlFromOutput = window.getSqlFromOutput;
window.getSqlFromOutput = function() {
  if (monacoEditor && monacoReady) {
    currentSQL = monacoEditor.getValue().trim();
  } else if (_origGetSqlFromOutput) {
    _origGetSqlFromOutput();
  }
};

// Override the original generateSQL to set SQL in Monaco
const _origGenerateSQL = window.generateSQL;
window.generateSQL = async function() {
  // Call the original
  const question = document.getElementById('question')?.value.trim();
  if (!question) return;

  // Run original logic
  await _origGenerateSQL?.();

  // Sync to Monaco after
  setTimeout(() => {
    const codeEl = document.getElementById('sql-output');
    if (codeEl && monacoEditor && monacoReady) {
      const sql = codeEl.textContent.trim();
      if (sql) monacoEditor.setValue(sql);
    }
  }, 100);
};

// Override applyFixedSql to also set Monaco
const _origApplyFixedSql = window.applyFixedSql;
window.applyFixedSql = function(fixedSql) {
  currentSQL = fixedSql;
  if (monacoEditor && monacoReady) {
    monacoEditor.setValue(fixedSql);
  }
  const codeEl = document.getElementById('sql-output');
  if (codeEl) codeEl.textContent = fixedSql;
  hide('ai-panel');
};

// Override loadHistoryItem to set Monaco
const _origLoadHistoryItem = window.loadHistoryItem;
window.loadHistoryItem = function(i) {
  const item = history[i];
  if (!item) return;
  document.getElementById('question').value = item.question;
  currentSQL = item.sql;
  if (monacoEditor && monacoReady) {
    monacoEditor.setValue(item.sql || '');
  }
  const codeEl = document.getElementById('sql-output');
  if (codeEl) codeEl.textContent = item.sql;
  document.getElementById('explanation-text').textContent = 'Loaded from query history.';
  show('result-card');
};

// Override queryTable to also set Monaco
const _origQueryTable = window.queryTable;
window.queryTable = function(tblName) {
  const sql = `SELECT * FROM "${tblName}" LIMIT 50;`;
  document.getElementById('question').value = `Show 50 rows from ${tblName}`;
  currentSQL = sql;
  if (monacoEditor && monacoReady) {
    monacoEditor.setValue(sql);
  }
  show('result-card');
  const codeEl = document.getElementById('sql-output');
  if (codeEl) codeEl.textContent = sql;
  document.getElementById('explanation-text').textContent = `Retrieves up to 50 sample records from the ${tblName} table.`;
  executeLiveQuery(true);
};

// Store all rows when results come in (for search)
const _origRenderDataTable = window.renderDataTable;
window.renderDataTable = function(res) {
  _allResultRows = (res.rows || []).slice();
  _origRenderDataTable?.(res);
  // Clear search
  const searchEl = document.getElementById('results-search');
  if (searchEl) searchEl.value = '';
};

// Expose globally
window.analyzeQueryPerformance = analyzeQueryPerformance;
window.generateTableDoc = generateTableDoc;
window.filterSchema = filterSchema;
window.onResultsSearch = onResultsSearch;
window.exportResultsExcel = exportResultsExcel;
window.exportResultsJson = exportResultsJson;
window.exportChartPng = exportChartPng;
window.formatSQL = formatSQL;
window.downloadSQL = downloadSQL;
