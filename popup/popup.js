/**
 * popup.js — AppliedIQ Dashboard
 *
 * Features:
 *  - Load and render all applications from chrome.storage.local
 *  - Filter by status, sort by date/company, fuzzy search
 *  - Inline status edit via click-on-chip → dropdown
 *  - Follow-up due badges (overdue / today / upcoming / sent)
 *  - Soft delete with 5s undo window
 *  - CSV export
 *  - Add job modal (manual entry)
 *  - Edit job modal
 *  - Follow-up email generation (static + Gemini)
 *  - AI features: Analyze, Evaluate JD, Search Links, Prioritize
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let allRecords = [];
let filteredRecords = [];
let settings = {};
let undoBuffer = null;
let undoTimer = null;
let currentAiMode = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  settings = await StorageAPI.getSettings();
  await loadAndRender();
  bindControls();
});

async function loadAndRender() {
  allRecords = await StorageAPI.getAll();
  applyFiltersAndRender();
  updateStats();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function applyFiltersAndRender() {
  const searchVal = document.getElementById('search-input').value.trim().toLowerCase();
  const statusFilter = document.getElementById('filter-status').value;
  const sortBy = document.getElementById('sort-by').value;

  filteredRecords = allRecords.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchVal) {
      const haystack = `${r.company} ${r.jobTitle} ${r.notes || ''}`.toLowerCase();
      if (!haystack.includes(searchVal)) return false;
    }
    return true;
  });

  filteredRecords.sort((a, b) => {
    if (sortBy === 'date-desc') return new Date(b.appliedDate) - new Date(a.appliedDate);
    if (sortBy === 'date-asc') return new Date(a.appliedDate) - new Date(b.appliedDate);
    if (sortBy === 'company') return a.company.localeCompare(b.company);
    return 0;
  });

  renderTable(filteredRecords);
}

function renderTable(records) {
  const tbody = document.getElementById('table-body');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('app-table');

  if (records.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';

  tbody.innerHTML = records.map((r) => buildRow(r)).join('');
  attachRowListeners();
}

function buildRow(r) {
  const dateStr = formatDate(r.appliedDate);
  const sourceBadge = buildSourceBadge(r.source);
  const statusChip = buildStatusChip(r);
  const followUpBadge = buildFollowUpBadge(r);
  const jobLink = r.jobUrl
    ? `<a href="${escHtml(r.jobUrl)}" target="_blank" class="company-link" title="Open job posting">${escHtml(r.company)}</a>`
    : escHtml(r.company);

  return `
    <tr data-id="${r.id}" class="${r.status === 'Ghosted' ? 'row-ghost' : ''}">
      <td class="cell-company" title="${escHtml(r.company)}">${jobLink}</td>
      <td class="cell-role" title="${escHtml(r.jobTitle)}">${escHtml(r.jobTitle)}</td>
      <td class="cell-date">${dateStr}</td>
      <td>${sourceBadge}</td>
      <td class="status-cell">${statusChip}</td>
      <td>${followUpBadge}</td>
      <td class="actions-cell">
        <button class="action-btn btn-email" data-id="${r.id}" title="Generate follow-up email">✉</button>
        <button class="action-btn btn-edit" data-id="${r.id}" title="Edit">✏</button>
        <button class="action-btn btn-delete danger" data-id="${r.id}" title="Delete">🗑</button>
      </td>
    </tr>`;
}

function buildSourceBadge(source) {
  const map = {
    linkedin_easy_apply: ['⚡ Easy Apply', 'source-easy'],
    linkedin_external: ['🌐 External', 'source-external'],
    manual: ['✍ Manual', 'source-manual'],
  };
  const [label, cls] = map[source] || ['Unknown', 'source-manual'];
  return `<span class="source-badge ${cls}">${label}</span>`;
}

function buildStatusChip(r) {
  const cls = 'status-' + r.status.replace(/\s+/g, '-');
  return `<span class="status-chip ${cls}" data-id="${r.id}" title="Click to change status">${escHtml(r.status)}</span>`;
}

function buildFollowUpBadge(r) {
  if (r.followUpSent) {
    return `<span class="followup-badge followup-sent">✓ Sent</span>`;
  }
  if (!r.followUpDate || r.status !== 'Applied') {
    return `<span class="followup-na">—</span>`;
  }
  const due = new Date(r.followUpDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / 86400000);

  if (diff < 0) {
    return `<span class="followup-badge followup-overdue">⏰ ${Math.abs(diff)}d overdue</span>`;
  } else if (diff === 0) {
    return `<span class="followup-badge followup-today">⏰ Today</span>`;
  } else {
    return `<span class="followup-badge followup-upcoming">📅 ${formatDate(r.followUpDate)}</span>`;
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function updateStats() {
  const total = allRecords.length;
  const applied = allRecords.filter((r) => r.status === 'Applied').length;
  const inProcess = allRecords.filter((r) =>
    ['Interview Scheduled', 'Technical Round', 'HR Round'].includes(r.status)
  ).length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followupDue = allRecords.filter((r) => {
    if (r.followUpSent || r.status !== 'Applied' || !r.followUpDate) return false;
    return new Date(r.followUpDate) <= today;
  }).length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-applied').textContent = applied;
  document.getElementById('stat-followup').textContent = followupDue;
  document.getElementById('stat-interview').textContent = inProcess;
}

// ─── Row Listeners ────────────────────────────────────────────────────────────

function attachRowListeners() {
  // Status chip click → inline dropdown
  document.querySelectorAll('.status-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      showInlineStatusSelect(id, e.currentTarget);
    });
  });

  // Edit button
  document.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      openEditModal(id);
    });
  });

  // Delete button
  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      softDelete(id);
    });
  });

  // Email button
  document.querySelectorAll('.btn-email').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      openEmailModal(id);
    });
  });
}

// ─── Inline Status Edit ───────────────────────────────────────────────────────

const STATUSES = [
  'Applied', 'Followed Up', 'Interview Scheduled',
  'Technical Round', 'HR Round', 'Offer', 'Rejected', 'Ghosted',
];

function showInlineStatusSelect(id, chipEl) {
  const select = document.createElement('select');
  select.className = 'status-select-inline';
  STATUSES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === chipEl.textContent.trim()) opt.selected = true;
    select.appendChild(opt);
  });

  chipEl.replaceWith(select);
  select.focus();

  const commit = async () => {
    const newStatus = select.value;
    const updates = { status: newStatus };
    if (newStatus === 'Followed Up') updates.followUpSent = true;
    await StorageAPI.update(id, updates);
    await loadAndRender();
  };

  select.addEventListener('change', commit);
  select.addEventListener('blur', async () => {
    await commit();
  });
}

// ─── Soft Delete with Undo ────────────────────────────────────────────────────

async function softDelete(id) {
  const record = allRecords.find((r) => r.id === id);
  if (!record) return;

  undoBuffer = record;
  await StorageAPI.delete(id);
  await loadAndRender();

  showUndoBar(record.jobTitle, record.company);

  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoBuffer = null;
    hideUndoBar();
  }, 5000);
}

function showUndoBar(title, company) {
  const bar = document.getElementById('undo-bar');
  document.getElementById('undo-msg').textContent = `Deleted: ${title} at ${company}`;
  bar.style.display = 'flex';
}

function hideUndoBar() {
  document.getElementById('undo-bar').style.display = 'none';
}

document.getElementById('btn-undo').addEventListener('click', async () => {
  if (!undoBuffer) return;
  clearTimeout(undoTimer);
  await StorageAPI.save(undoBuffer);
  undoBuffer = null;
  hideUndoBar();
  await loadAndRender();
});

// ─── CSV Export ───────────────────────────────────────────────────────────────

document.getElementById('btn-export').addEventListener('click', async () => {
  const csv = await StorageAPI.exportCSV();
  if (!csv) { alert('No data to export.'); return; }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `appliediq-export-${dateTag()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ─── Options Button ───────────────────────────────────────────────────────────

document.getElementById('btn-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── Controls ─────────────────────────────────────────────────────────────────

function bindControls() {
  document.getElementById('search-input').addEventListener('input', applyFiltersAndRender);
  document.getElementById('filter-status').addEventListener('change', applyFiltersAndRender);
  document.getElementById('sort-by').addEventListener('change', applyFiltersAndRender);
  document.getElementById('btn-add').addEventListener('click', openAddModal);
}

// ─── Add Job Modal ────────────────────────────────────────────────────────────

function openAddModal() {
  // Reset form
  document.getElementById('form-add').reset();
  document.getElementById('add-date').value = todayISO();
  showModal('modal-add');
}

document.getElementById('modal-add-close').addEventListener('click', () => hideModal('modal-add'));
document.getElementById('modal-add-cancel').addEventListener('click', () => hideModal('modal-add'));

document.getElementById('form-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const company = document.getElementById('add-company').value.trim();
  const jobTitle = document.getElementById('add-title').value.trim();
  const jobUrl = document.getElementById('add-joburl').value.trim();
  const portalUrl = document.getElementById('add-portalurl').value.trim();
  const appliedDate = document.getElementById('add-date').value;
  const source = document.getElementById('add-source').value;
  const hmEmail = document.getElementById('add-hm-email').value.trim();
  const notes = document.getElementById('add-notes').value.trim();
  const tagsRaw = document.getElementById('add-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const applied = appliedDate ? new Date(appliedDate).toISOString() : new Date().toISOString();
  const followUpDays = settings.followUpDays || 5;
  const followUpDate = computeFollowUpDate(applied, followUpDays);

  const record = {
    id: generateUUID(),
    jobTitle,
    company,
    jobUrl,
    portalUrl,
    source,
    appliedDate: applied,
    status: 'Applied',
    followUpDate,
    followUpSent: false,
    hiringManagerName: '',
    hiringManagerEmail: hmEmail,
    notes,
    tags,
  };

  await StorageAPI.save(record);
  hideModal('modal-add');
  await loadAndRender();
});

// ─── Edit Job Modal ───────────────────────────────────────────────────────────

async function openEditModal(id) {
  const r = allRecords.find((rec) => rec.id === id);
  if (!r) return;

  document.getElementById('edit-id').value = r.id;
  document.getElementById('edit-company').value = r.company;
  document.getElementById('edit-title').value = r.jobTitle;
  document.getElementById('edit-joburl').value = r.jobUrl || '';
  document.getElementById('edit-status').value = r.status;
  document.getElementById('edit-hm-name').value = r.hiringManagerName || '';
  document.getElementById('edit-hm-email').value = r.hiringManagerEmail || '';
  document.getElementById('edit-notes').value = r.notes || '';
  document.getElementById('edit-tags').value = (r.tags || []).join(', ');
  document.getElementById('edit-followup-sent').checked = r.followUpSent || false;

  showModal('modal-edit');
}

document.getElementById('modal-edit-close').addEventListener('click', () => hideModal('modal-edit'));
document.getElementById('modal-edit-cancel').addEventListener('click', () => hideModal('modal-edit'));

document.getElementById('form-edit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const tagsRaw = document.getElementById('edit-tags').value.trim();
  const newStatus = document.getElementById('edit-status').value;
  const followUpSent = document.getElementById('edit-followup-sent').checked;

  await StorageAPI.update(id, {
    company: document.getElementById('edit-company').value.trim(),
    jobTitle: document.getElementById('edit-title').value.trim(),
    jobUrl: document.getElementById('edit-joburl').value.trim(),
    status: newStatus,
    hiringManagerName: document.getElementById('edit-hm-name').value.trim(),
    hiringManagerEmail: document.getElementById('edit-hm-email').value.trim(),
    notes: document.getElementById('edit-notes').value.trim(),
    tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [],
    followUpSent,
  });

  hideModal('modal-edit');
  await loadAndRender();
});

// ─── Follow-up Email Modal ────────────────────────────────────────────────────

async function openEmailModal(id) {
  const r = allRecords.find((rec) => rec.id === id);
  if (!r) return;

  showModal('modal-email');
  document.getElementById('email-loading').style.display = 'flex';
  document.getElementById('email-content').style.display = 'none';

  try {
    const result = await generateFollowUpEmail(
      {
        jobTitle: r.jobTitle,
        company: r.company,
        appliedDate: r.appliedDate,
        source: r.source,
        hiringManagerName: r.hiringManagerName || '',
        notes: r.notes || '',
        userName: settings.userName || 'Applicant',
        linkedinUrl: '',
        currentRole: settings.currentRole || 'Senior SDET',
        yearsOfExperience: settings.yearsOfExperience || '',
      },
      settings.geminiApiKey || '',
      settings.geminiModel || ''
    );

    document.getElementById('email-subject').value = result.subject;
    document.getElementById('email-body').value = result.body;
  } catch (err) {
    document.getElementById('email-subject').value = 'Error generating email';
    document.getElementById('email-body').value = err.message;
  }

  document.getElementById('email-loading').style.display = 'none';
  document.getElementById('email-content').style.display = 'flex';
}

document.getElementById('modal-email-close').addEventListener('click', () => hideModal('modal-email'));

document.getElementById('btn-copy-email').addEventListener('click', async () => {
  const subject = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body').value;
  await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
  document.getElementById('btn-copy-email').textContent = '✓ Copied!';
  setTimeout(() => (document.getElementById('btn-copy-email').textContent = '📋 Copy to Clipboard'), 2000);
});

document.getElementById('btn-mailto').addEventListener('click', () => {
  const subject = encodeURIComponent(document.getElementById('email-subject').value);
  const body = encodeURIComponent(document.getElementById('email-body').value);
  chrome.tabs.create({ url: `mailto:?subject=${subject}&body=${body}` });
});

// ─── AI Features ─────────────────────────────────────────────────────────────

const AI_MODES = {
  analyze: {
    title: '📊 Application Analysis',
    showInput: false,
    loadingText: 'Analyzing your applications with Gemini…',
  },
  jd: {
    title: '📝 Job Description Evaluation',
    showInput: true,
    loadingText: 'Evaluating job description with Gemini…',
    inputPlaceholder: 'Paste the full job description here…',
  },
  links: {
    title: '🔗 LinkedIn Search Strategy',
    showInput: false,
    loadingText: 'Building search strategy with Gemini…',
  },
  prioritize: {
    title: '🎯 Application Prioritization',
    showInput: false,
    loadingText: 'Prioritizing your pipeline with Gemini…',
  },
};

document.getElementById('btn-ai-analyze').addEventListener('click', () => openAiModal('analyze'));
document.getElementById('btn-ai-jd').addEventListener('click', () => openAiModal('jd'));
document.getElementById('btn-ai-links').addEventListener('click', () => openAiModal('links'));
document.getElementById('btn-ai-prioritize').addEventListener('click', () => openAiModal('prioritize'));

function openAiModal(mode) {
  currentAiMode = mode;
  const config = AI_MODES[mode];
  document.getElementById('modal-ai-title').textContent = config.title;
  document.getElementById('ai-loading').style.display = 'none';
  document.getElementById('ai-response').style.display = 'none';

  if (config.showInput) {
    document.getElementById('ai-input-section').style.display = 'flex';
    document.getElementById('ai-input-text').placeholder = config.inputPlaceholder || '';
    document.getElementById('ai-input-text').value = '';
  } else {
    document.getElementById('ai-input-section').style.display = 'none';
    runAiQuery(mode, '');
  }

  showModal('modal-ai');
}

document.getElementById('btn-ai-submit').addEventListener('click', () => {
  const input = document.getElementById('ai-input-text').value.trim();
  if (!input) return;
  document.getElementById('ai-input-section').style.display = 'none';
  runAiQuery(currentAiMode, input);
});

document.getElementById('modal-ai-close').addEventListener('click', () => hideModal('modal-ai'));

document.getElementById('btn-copy-ai').addEventListener('click', async () => {
  const text = document.getElementById('ai-response-text').textContent;
  await navigator.clipboard.writeText(text);
  document.getElementById('btn-copy-ai').textContent = '✓ Copied!';
  setTimeout(() => (document.getElementById('btn-copy-ai').textContent = '📋 Copy'), 2000);
});

async function runAiQuery(mode, userInput) {
  const apiKey = settings.geminiApiKey || '';
  if (!apiKey) {
    showAiResponse(
      'No Gemini API key configured.\n\nGo to ⚙ Options → enter your Gemini API key to enable AI features.\n\nGet a free key at: https://aistudio.google.com/apikey'
    );
    return;
  }

  document.getElementById('ai-loading').style.display = 'flex';
  document.getElementById('ai-loading-text').textContent = AI_MODES[mode].loadingText;
  document.getElementById('ai-response').style.display = 'none';

  try {
    const prompt = buildAiPrompt(mode, userInput);
    const response = await callGemini(prompt, apiKey, settings.geminiModel);
    showAiResponse(response);
  } catch (err) {
    showAiResponse(`Error: ${err.message}`);
  }
}

function buildAiPrompt(mode, userInput) {
  const statusJSON = JSON.stringify(
    allRecords.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {})
  );

  const today = new Date().toISOString().split('T')[0];
  const last30 = allRecords.filter((r) => {
    const d = new Date(r.appliedDate);
    return (new Date() - d) / 86400000 <= 30;
  }).length;

  const responded = allRecords.filter((r) =>
    ['Interview Scheduled', 'Technical Round', 'HR Round', 'Offer'].includes(r.status)
  ).length;

  const responseRate =
    allRecords.length > 0 ? Math.round((responded / allRecords.length) * 100) : 0;

  const tableData = allRecords
    .slice(0, 30)
    .map(
      (r) =>
        `${r.company} | ${r.jobTitle} | ${r.appliedDate?.split('T')[0]} | ${r.source} | ${r.status} | followUpSent:${r.followUpSent}`
    )
    .join('\n');

  const contextBlock = `
USER_PROFILE:
  name: ${settings.userName || 'Applicant'}
  current_role: ${settings.currentRole || 'Senior SDET'}
  experience_years: ${settings.yearsOfExperience || 'unknown'}
  target_role: ${settings.targetRole || 'Senior SDET / SQE'}
  location_preference: ${settings.location || 'India'}
  notice_period: ${settings.noticePeriod || 'unknown'}

APPLICATION_SUMMARY:
  total_applied: ${allRecords.length}
  last_30_days: ${last30}
  response_rate: ${responseRate}%
  status_breakdown: ${statusJSON}
  today: ${today}

RECENT_APPLICATIONS (company | role | date | source | status | followUpSent):
${tableData}`;

  switch (mode) {
    case 'analyze':
      return `${contextBlock}

Task: Application Data Analysis.

Analyze the application data above. You must:
- Identify clusters: applications in last 7/14/30 days? Response rate?
- Flag anomalies: duplicate companies? Role mismatches?
- Call out dead weight: Applied status older than 14 days with no follow-up = likely ghosts
- Surface what's working: any source with higher response rate?
- Recommend next action per company tier: Follow up, escalate, write off, or wait

Do not give generic advice. Be direct and specific. Maximum 400 words.`;

    case 'jd':
      return `${contextBlock}

Task: Job Description Evaluation.

Evaluate this job description for fit with the applicant profile above:

---
${userInput}
---

Return in this exact structure:
ROLE LEGITIMACY
- Real open role or ghost posting? Signals?
- Posted by company directly or staffing agency?

FIT ASSESSMENT (for Senior SDET / SQE profile)
- Required skills match: [list matched / unmatched]
- Experience level alignment: Overskilled / Matched / Stretch
- Red flags in JD?

INTERVIEW STRUCTURE PREDICTION
- Likely stages based on company + role level
- Technical evaluation likely covers

LINKEDIN URL FOR SIMILAR ROLES
- Provide one exact LinkedIn search URL for similar roles

APPLY OR SKIP
- Binary recommendation. One sentence justification.

Maximum 600 words.`;

    case 'links':
      return `${contextBlock}

Task: LinkedIn Search Strategy.

Build a targeted LinkedIn search strategy for the applicant above. You must return:

1. Minimum 5 functional LinkedIn search URLs (exact URLs with all parameters)
2. For each URL: name it, explain the filters, and state which company tier it targets
3. Explain how to identify ATS type from apply flow URLs
4. List ATS-boosting keywords to include in resume for these roles

Format each URL in a code block. Include parameter breakdown table.

Maximum 600 words.`;

    case 'prioritize':
      return `${contextBlock}

Task: Application Prioritization.

Using the prioritization logic below, categorize each application:

TIER 1 — Act immediately: Applied 5–10 days ago, no response, no follow-up, product-based company
TIER 2 — Follow up once more: Followed up once, no response, 7+ days since, company still hiring
TIER 3 — Write off: Applied 20+ days ago, no response to two follow-ups, status unchanged

For each record, state: Company | Role | Applied Date | Status | Recommended Tier | Action

Do NOT advise following up after 2 attempts. Be direct. Maximum 400 words.`;

    default:
      return `${contextBlock}\n\nAnalyze the application data and provide actionable insights.`;
  }
}

async function callGemini(prompt, apiKey, model) {
  const systemPrompt = `You are a seasoned recruiter and senior software engineer with 12+ years of combined experience across talent acquisition at product-based tech companies and hands-on software quality engineering.

You assist job applicants — specifically Senior SDETs and Quality Engineers.

Rules:
- Never use filler phrases like "Great question!", "Absolutely!", "Of course!"
- Never validate effort without outcome evidence
- State confidence level when making predictions
- Recommend specific action, not vague direction
- Headers allowed for multi-section responses
- Tables preferred over bullet lists for comparative data
- Terminate response immediately after conclusion — no sign-off`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash-preview-04-17'}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

function showAiResponse(text) {
  document.getElementById('ai-loading').style.display = 'none';
  document.getElementById('ai-response-text').textContent = text;
  document.getElementById('ai-response').style.display = 'flex';
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────

function showModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function hideModal(id) {
  document.getElementById(id).style.display = 'none';
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function computeFollowUpDate(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function dateTag() {
  return new Date().toISOString().split('T')[0];
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
