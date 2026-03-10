/**
 * background.js — AppliedIQ Service Worker
 *
 * Responsibilities:
 *  1. Tab tracking: detect LinkedIn-originated navigations to external portals
 *  2. Message handling: receive records from content scripts, save to storage
 *  3. Daily alarm: check for follow-up due dates, fire notifications
 *  4. Notification click: open popup
 *
 * External portal tracking (Workday, Greenhouse, Lever, etc.):
 *  - pendingBySource: sourceTabId → jobData (set when LinkedIn "Apply" is clicked)
 *  - pendingByPortalTab: newTabId → jobData (set when chrome.tabs.onCreated fires)
 *  - GET_PENDING_JOB handler looks up by the portal tab's own ID first,
 *    then falls back to most-recent pending job within 5 minutes.
 *  - This avoids any reliance on domain matching, which breaks on
 *    Workday (company-specific subdomains not known at click time).
 */

'use strict';

// ─── Pending Job Maps ─────────────────────────────────────────────────────────

// sourceTabId (LinkedIn tab) → { jobData + timestamp }
const pendingBySource = new Map();

// portalTabId (Workday/Greenhouse/etc. tab) → { jobData + timestamp }
const pendingByPortalTab = new Map();

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Storage helpers (inline — service workers can't use ES module imports) ───

const STORAGE_KEY = 'appliediq_applications';
const SETTINGS_KEY = 'appliediq_settings';

async function getAll() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

async function saveRecord(record) {
  const all = await getAll();
  const existing = all.findIndex((r) => r.id === record.id);
  if (existing >= 0) {
    all[existing] = record;
  } else {
    all.unshift(record);
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      resolve(result[SETTINGS_KEY] || { followUpDays: 5, userName: 'Applicant' });
    });
  });
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function computeFollowUpDate(appliedDate, days) {
  const d = new Date(appliedDate);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function cleanStalePending() {
  const now = Date.now();
  for (const [id, data] of pendingBySource) {
    if (now - data.timestamp > PENDING_TTL_MS) pendingBySource.delete(id);
  }
  for (const [id, data] of pendingByPortalTab) {
    if (now - data.timestamp > PENDING_TTL_MS) pendingByPortalTab.delete(id);
  }
}

// ─── Tab Tracking — key mechanism for external portal detection ───────────────

/**
 * When LinkedIn opens an external portal via window.open() or target="_blank",
 * Chrome fires tabs.onCreated with openerTabId = the LinkedIn tab.
 * We use this to associate the pending job with the new tab ID — so when
 * content-portal.js asks "do you have a job for me?", we look up by tab ID.
 */
chrome.tabs.onCreated.addListener((tab) => {
  const openerTabId = tab.openerTabId;
  if (openerTabId == null) return;

  const pending = pendingBySource.get(openerTabId);
  if (!pending) return;

  // Associate the portal tab ID with the pending job
  pendingByPortalTab.set(tab.id, { ...pending });
  console.log(`[AppliedIQ] Linked portal tab ${tab.id} to job: ${pending.jobTitle} at ${pending.company}`);
});

/**
 * Fallback: if LinkedIn navigates the current tab (instead of opening a new one),
 * webNavigation fires on the same tabId. We associate it similarly.
 */
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0) return; // top frame only
    const url = details.url;
    if (!url || url.startsWith('chrome') || url.startsWith('about') || url.includes('linkedin.com')) return;

    const tabId = details.tabId;

    // If this tab already has a pending job (it was the new tab from onCreated), skip
    if (pendingByPortalTab.has(tabId)) return;

    // Check if any source tab's pending job is still fresh and this tab was recently opened
    // by looking at transition type
    if (details.transitionType === 'link' || details.transitionQualifiers?.includes('from_address_bar')) return;

    // Find the most recent pending job — check if this tab navigated from LinkedIn
    cleanStalePending();
    if (pendingBySource.size === 0) return;

    // Use the most recently added source pending job as a candidate
    let newest = null;
    for (const [, data] of pendingBySource) {
      if (!newest || data.timestamp > newest.timestamp) newest = data;
    }
    if (newest && Date.now() - newest.timestamp < 10000) {
      // Navigation happened within 10s of the click — high confidence linkage
      pendingByPortalTab.set(tabId, { ...newest });
    }
  }
);

// ─── Message Handling ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {

    // LinkedIn Easy Apply — final modal submit detected
    case 'LINKEDIN_APPLY': {
      handleLinkedInApply(message.data, tabId).then((record) => {
        sendResponse({ success: true, record });
        updateBadge();
      });
      return true;
    }

    // LinkedIn "Apply" button (external) clicked — store pending job by source tab
    case 'LINKEDIN_EXTERNAL_NAVIGATE': {
      if (message.data && tabId) {
        cleanStalePending();
        pendingBySource.set(tabId, {
          ...message.data,
          sourceTabId: tabId,
          timestamp: Date.now(),
        });
        console.log(`[AppliedIQ] Pending external job stored for tab ${tabId}: ${message.data.jobTitle}`);
      }
      sendResponse({ success: true });
      break;
    }

    // content-portal.js asking: "do you have a pending job for this tab?"
    case 'GET_PENDING_JOB': {
      cleanStalePending();

      // Primary: look up by this tab's ID (set in tabs.onCreated or webNavigation)
      let pending = tabId != null ? pendingByPortalTab.get(tabId) : null;

      // Fallback: most recent pending source job within TTL
      // (handles cases where tab ID association missed — e.g. same-tab navigation)
      if (!pending && pendingBySource.size > 0) {
        let newest = null;
        for (const [, data] of pendingBySource) {
          if (!newest || data.timestamp > newest.timestamp) newest = data;
        }
        if (newest && Date.now() - newest.timestamp < PENDING_TTL_MS) {
          pending = newest;
          // Associate this tab now for cleanup
          if (tabId != null) pendingByPortalTab.set(tabId, pending);
        }
      }

      if (pending) {
        sendResponse({ found: true, data: pending });
      } else {
        sendResponse({ found: false });
      }
      return false;
    }

    // User confirmed they applied on the external portal
    case 'PORTAL_APPLY_CONFIRM': {
      handlePortalApply(message.data, tabId).then((record) => {
        // Clean up pending entries for this tab
        if (tabId != null) {
          const pendingEntry = pendingByPortalTab.get(tabId);
          if (pendingEntry) {
            pendingBySource.delete(pendingEntry.sourceTabId);
          }
          pendingByPortalTab.delete(tabId);
        }
        sendResponse({ success: true, record });
        updateBadge();
      });
      return true;
    }

    case 'GET_BADGE_COUNT': {
      getAll().then((all) => sendResponse({ count: all.length }));
      return true;
    }

    default:
      break;
  }
});

// ─── Record Handlers ──────────────────────────────────────────────────────────

async function handleLinkedInApply(data, tabId) {
  const settings = await getSettings();
  const now = new Date().toISOString();
  const record = {
    id: generateUUID(),
    jobTitle: data.jobTitle || 'Unknown Role',
    company: data.company || 'Unknown Company',
    jobUrl: data.jobUrl || '',
    portalUrl: '',
    source: 'linkedin_easy_apply',
    appliedDate: now,
    status: 'Applied',
    followUpDate: computeFollowUpDate(now, settings.followUpDays || 5),
    followUpSent: false,
    hiringManagerName: '',
    hiringManagerEmail: '',
    notes: data.notes || '',
    tags: ['linkedin-easy-apply'],
  };
  await saveRecord(record);
  return record;
}

async function handlePortalApply(data, tabId) {
  const settings = await getSettings();
  const now = new Date().toISOString();
  const record = {
    id: generateUUID(),
    jobTitle: data.jobTitle || 'Unknown Role',
    company: data.company || 'Unknown Company',
    jobUrl: data.linkedInJobUrl || '',
    portalUrl: data.portalUrl || '',
    source: 'linkedin_external',
    appliedDate: now,
    status: 'Applied',
    followUpDate: computeFollowUpDate(now, settings.followUpDays || 5),
    followUpSent: false,
    hiringManagerName: '',
    hiringManagerEmail: '',
    notes: data.notes || '',
    tags: ['linkedin-external'],
  };
  await saveRecord(record);
  return record;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

async function updateBadge() {
  const all = await getAll();
  const count = all.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
}

// ─── Daily Follow-Up Alarm ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('followup-check', {
    when: Date.now() + 5000,
    periodInMinutes: 1440,
  });
  updateBadge();
  console.log('[AppliedIQ] Installed. Daily follow-up alarm set.');
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'followup-check') return;
  await checkFollowUps();
});

async function checkFollowUps() {
  const all = await getAll();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = all.filter((r) => {
    if (r.followUpSent || r.status !== 'Applied' || !r.followUpDate) return false;
    return new Date(r.followUpDate) <= today;
  });

  if (due.length === 0) return;

  if (due.length === 1) {
    const r = due[0];
    chrome.notifications.create(`followup-${r.id}`, {
      type: 'basic',
      iconUrl: 'assets/icons/icon48.png',
      title: 'Follow-up due — AppliedIQ',
      message: `${r.jobTitle} at ${r.company} — applied ${formatDate(r.appliedDate)}`,
      buttons: [{ title: 'Open Dashboard' }],
      priority: 1,
    });
  } else {
    chrome.notifications.create('followup-batch', {
      type: 'basic',
      iconUrl: 'assets/icons/icon48.png',
      title: `${due.length} follow-ups due — AppliedIQ`,
      message: due.map((r) => `${r.company}: ${r.jobTitle}`).slice(0, 3).join('\n'),
      buttons: [{ title: 'Open Dashboard' }],
      priority: 1,
    });
  }
}

// ─── Notification Click ───────────────────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.action.openPopup?.();
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  chrome.action.openPopup?.();
  chrome.notifications.clear(notificationId);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
