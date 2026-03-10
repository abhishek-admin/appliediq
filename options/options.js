/**
 * options.js — AppliedIQ Settings & Configuration
 *
 * Manages:
 *  - User profile (name, role, experience, target, location, notice period)
 *  - Gemini API key (stored in chrome.storage.local — never leaves browser except to Gemini)
 *  - Follow-up reminder interval
 *  - Saved LinkedIn search queries (view, launch, add, delete, reset to defaults)
 *  - Data export (JSON + CSV) and data clear
 */

'use strict';

let queries = [];
let settings = {};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  settings = await StorageAPI.getSettings();
  queries = await StorageAPI.getQueries();

  loadProfileFields();
  loadApiKeyField();
  loadFollowupField();
  renderQueryList();
  updateApiStatusBadge();
  updateStorageInfo();

  bindAll();
});

// ─── Profile ──────────────────────────────────────────────────────────────────

function loadProfileFields() {
  document.getElementById('pf-name').value = settings.userName || '';
  document.getElementById('pf-current-role').value = settings.currentRole || '';
  document.getElementById('pf-experience').value = settings.yearsOfExperience || '';
  document.getElementById('pf-target-role').value = settings.targetRole || 'Senior SDET / SQE';
  document.getElementById('pf-location').value = settings.location || 'Bengaluru, India';
  document.getElementById('pf-notice').value = settings.noticePeriod || '';
}

async function saveProfile() {
  settings.userName = document.getElementById('pf-name').value.trim();
  settings.currentRole = document.getElementById('pf-current-role').value.trim();
  settings.yearsOfExperience = document.getElementById('pf-experience').value.trim();
  settings.targetRole = document.getElementById('pf-target-role').value.trim();
  settings.location = document.getElementById('pf-location').value.trim();
  settings.noticePeriod = document.getElementById('pf-notice').value.trim();
  await StorageAPI.saveSettings(settings);
  showToast('Profile saved');
}

// ─── API Key ──────────────────────────────────────────────────────────────────

function loadApiKeyField() {
  document.getElementById('gemini-api-key').value = settings.geminiApiKey || '';
  document.getElementById('gemini-model').value = settings.geminiModel || 'gemini-2.5-flash-preview-04-17';
}

function updateApiStatusBadge() {
  const badge = document.getElementById('api-status-badge');
  if (settings.geminiApiKey && settings.geminiApiKey.length > 10) {
    badge.textContent = '✓ API key configured';
    badge.className = 'api-status ok';
  } else {
    badge.textContent = '⚠ Not configured';
    badge.className = 'api-status missing';
  }
}

async function saveApiKey() {
  settings.geminiApiKey = document.getElementById('gemini-api-key').value.trim();
  settings.geminiModel = document.getElementById('gemini-model').value.trim() || 'gemini-2.5-flash-preview-04-17';
  await StorageAPI.saveSettings(settings);
  updateApiStatusBadge();
  showToast('API key and model saved');
}

async function testApiConnection() {
  const key = document.getElementById('gemini-api-key').value.trim();
  const model = document.getElementById('gemini-model').value.trim() || 'gemini-2.5-flash-preview-04-17';
  const resultEl = document.getElementById('api-test-result');

  if (!key) {
    resultEl.textContent = 'Enter an API key first.';
    resultEl.style.color = '#f87171';
    resultEl.style.display = 'block';
    return;
  }

  resultEl.textContent = `Testing with model: ${model} …`;
  resultEl.style.color = 'var(--text-muted)';
  resultEl.style.display = 'block';

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err && err.error && err.error.message) || `HTTP ${response.status}`;
      resultEl.textContent = `API error: ${msg}`;
      resultEl.style.color = '#f87171';
      return;
    }

    const data = await response.json();
    const text = (data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text) || '';
    resultEl.textContent = `Connected. Model "${model}" responded: "${text.trim()}"`;
    resultEl.style.color = '#86efac';
  } catch (err) {
    resultEl.textContent = `Network error: ${err.message}`;
    resultEl.style.color = '#f87171';
  }
}

async function listAvailableModels() {
  const key = document.getElementById('gemini-api-key').value.trim();
  const resultEl = document.getElementById('api-test-result');
  const modelsDiv = document.getElementById('models-list');
  const modelsItems = document.getElementById('models-list-items');

  if (!key) {
    resultEl.textContent = 'Enter an API key first.';
    resultEl.style.color = '#f87171';
    resultEl.style.display = 'block';
    return;
  }

  resultEl.textContent = 'Fetching available models…';
  resultEl.style.color = 'var(--text-muted)';
  resultEl.style.display = 'block';
  modelsDiv.style.display = 'none';

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err && err.error && err.error.message) || `HTTP ${response.status}`;
      resultEl.textContent = `Error fetching models: ${msg}`;
      resultEl.style.color = '#f87171';
      return;
    }

    const data = await response.json();
    const models = (data.models || []).filter(function (m) {
      return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1;
    });

    if (models.length === 0) {
      resultEl.textContent = 'No generateContent-compatible models found.';
      resultEl.style.color = '#f87171';
      return;
    }

    resultEl.textContent = `Found ${models.length} compatible models. Click one to use it.`;
    resultEl.style.color = '#86efac';

    modelsItems.innerHTML = '';
    models.forEach(function (m) {
      // m.name is like "models/gemini-2.5-flash-preview-04-17"
      var shortName = m.name.replace('models/', '');
      var btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.style.fontFamily = 'monospace';
      btn.style.fontSize = '11px';
      btn.textContent = shortName;
      btn.title = m.displayName || shortName;
      btn.addEventListener('click', function () {
        document.getElementById('gemini-model').value = shortName;
        modelsItems.querySelectorAll('button').forEach(function (b) { b.style.background = ''; b.style.color = ''; });
        btn.style.background = '#2563eb';
        btn.style.color = '#fff';
      });
      modelsItems.appendChild(btn);
    });

    modelsDiv.style.display = 'block';
  } catch (err) {
    resultEl.textContent = `Network error: ${err.message}`;
    resultEl.style.color = '#f87171';
  }
}

// ─── Follow-up Setting ────────────────────────────────────────────────────────

function loadFollowupField() {
  document.getElementById('followup-days').value = String(settings.followUpDays || 5);
}

async function saveFollowupSetting() {
  settings.followUpDays = parseInt(document.getElementById('followup-days').value, 10);
  await StorageAPI.saveSettings(settings);
  showToast('Follow-up setting saved');
}

// ─── Saved Queries ────────────────────────────────────────────────────────────

function renderQueryList() {
  const list = document.getElementById('query-list');
  if (queries.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px 0">No saved queries. Add one above or reset to defaults.</div>';
    return;
  }

  list.innerHTML = queries
    .map(
      (q) => `
    <div class="query-item" data-id="${q.id}">
      <div class="query-info">
        <div class="query-name">${escHtml(q.name)}</div>
        <div class="query-desc">${escHtml(q.description || '')}</div>
        <div class="query-url">${escHtml(q.url)}</div>
      </div>
      <div class="query-actions">
        <button class="btn btn-success btn-sm btn-launch-query" data-url="${escHtml(q.url)}" title="Open in LinkedIn">▶ Launch</button>
        <button class="btn btn-danger btn-sm btn-delete-query" data-id="${q.id}" title="Delete query">✕</button>
      </div>
    </div>`
    )
    .join('');

  // Launch buttons
  list.querySelectorAll('.btn-launch-query').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });

  // Delete buttons
  list.querySelectorAll('.btn-delete-query').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      queries = queries.filter((q) => q.id !== id);
      await StorageAPI.saveQueries(queries);
      renderQueryList();
    });
  });
}

function showAddQueryForm() {
  const form = document.getElementById('add-query-form');
  form.classList.add('visible');
  document.getElementById('aq-name').focus();
}

function hideAddQueryForm() {
  const form = document.getElementById('add-query-form');
  form.classList.remove('visible');
  document.getElementById('aq-name').value = '';
  document.getElementById('aq-desc').value = '';
  document.getElementById('aq-url').value = '';
}

async function addQuery() {
  const name = document.getElementById('aq-name').value.trim();
  const desc = document.getElementById('aq-desc').value.trim();
  const url = document.getElementById('aq-url').value.trim();

  if (!name || !url) {
    alert('Query name and URL are required.');
    return;
  }

  if (!url.includes('linkedin.com/jobs')) {
    if (!confirm('This URL does not look like a LinkedIn jobs search URL. Add anyway?')) return;
  }

  const newQuery = {
    id: `q_${Date.now()}`,
    name,
    description: desc,
    url,
  };

  queries.push(newQuery);
  await StorageAPI.saveQueries(queries);
  hideAddQueryForm();
  renderQueryList();
  showToast('Query added');
}

async function resetQueries() {
  if (!confirm('Reset all saved queries to the defaults? Your custom queries will be deleted.')) return;
  // Trigger a re-save with defaults by clearing existing
  await chrome.storage.local.remove('appliediq_queries');
  queries = await StorageAPI.getQueries(); // re-loads defaults
  renderQueryList();
  showToast('Queries reset to defaults');
}

// ─── Data Management ──────────────────────────────────────────────────────────

async function exportJSON() {
  const json = await StorageAPI.exportJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `appliediq-backup-${dateTag()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportCSV() {
  const csv = await StorageAPI.exportCSV();
  if (!csv) { alert('No data to export.'); return; }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `appliediq-export-${dateTag()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAllData() {
  const all = await StorageAPI.getAll();
  if (all.length === 0) { alert('No data to clear.'); return; }
  const confirmed = confirm(
    `This will permanently delete all ${all.length} application records. This cannot be undone.\n\nAre you sure?`
  );
  if (!confirmed) return;
  await chrome.storage.local.remove('appliediq_applications');
  showToast('All application data cleared');
  updateStorageInfo();
}

async function updateStorageInfo() {
  const all = await StorageAPI.getAll();
  const bytes = new TextEncoder().encode(JSON.stringify(all)).length;
  const kb = (bytes / 1024).toFixed(1);
  const maxKB = (5 * 1024).toFixed(0);
  document.getElementById('storage-info').textContent =
    `${all.length} applications stored — ~${kb} KB used of ${maxKB} KB local storage limit`;
}

// ─── Bind Events ─────────────────────────────────────────────────────────────

function bindAll() {
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-save-api').addEventListener('click', saveApiKey);
  document.getElementById('btn-test-api').addEventListener('click', testApiConnection);
  document.getElementById('btn-list-models').addEventListener('click', listAvailableModels);
  document.getElementById('btn-save-followup').addEventListener('click', saveFollowupSetting);

  document.getElementById('btn-show-add-query').addEventListener('click', showAddQueryForm);
  document.getElementById('btn-save-query').addEventListener('click', addQuery);
  document.getElementById('btn-cancel-query').addEventListener('click', hideAddQueryForm);
  document.getElementById('btn-reset-queries').addEventListener('click', resetQueries);

  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-clear-all').addEventListener('click', clearAllData);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('save-toast');
  toast.textContent = `✓ ${message}`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateTag() {
  return new Date().toISOString().split('T')[0];
}
