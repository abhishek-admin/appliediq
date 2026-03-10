/**
 * content-linkedin.js — Injected on https://www.linkedin.com/*
 *
 * Detects LinkedIn Easy Apply modal final submission and extracts job metadata.
 *
 * Strategy:
 *  - Use MutationObserver to watch for the Easy Apply modal
 *  - Track the modal steps; fire only on the FINAL "Submit application" click
 *  - Extract job data from the surrounding job card DOM
 *  - Multiple fallback selectors guard against LinkedIn UI drift
 *  - Dedup: skip if same jobUrl already tracked in this session
 */

(function () {
  'use strict';

  const TRACKED_JOBS = new Set(); // session-level dedup (no storage read needed)
  let modalObserver = null;
  let pageObserver = null;

  // ─── Selector groups (multiple fallbacks per field) ───────────────────────

  const MODAL_SELECTORS = [
    '.jobs-easy-apply-modal',
    '[data-test-modal-id="easy-apply-modal"]',
    '.artdeco-modal--layer-middle',
    '[role="dialog"][aria-labelledby*="jobs-apply"]',
  ];

  const SUBMIT_BUTTON_TEXTS = [
    'submit application',
    'submit',
    'send application',
    'complete application',
  ];

  const JOB_TITLE_SELECTORS = [
    '.jobs-unified-top-card__job-title',
    '.job-details-jobs-unified-top-card__job-title',
    'h1.t-24',
    '.jobs-details__main-content h1',
    '[data-test-app-aware-link] h1',
    '.jobs-top-card__job-title',
  ];

  const COMPANY_SELECTORS = [
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__company-name a',
    '.jobs-top-card__company-name a',
    '.jobs-top-card__company-name',
    'a[data-tracking-control-name*="company"]',
  ];

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function trySelect(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el;
      } catch {}
    }
    return null;
  }

  function getJobUrl() {
    // Canonical LinkedIn job URL from current page
    const url = new URL(window.location.href);
    // /jobs/view/12345/ pattern
    const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (match) {
      return `https://www.linkedin.com/jobs/view/${match[1]}/`;
    }
    return window.location.href;
  }

  function getJobId() {
    const url = new URL(window.location.href);
    const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : url.searchParams.get('currentJobId') || '';
  }

  function extractJobData() {
    const titleEl = trySelect(JOB_TITLE_SELECTORS);
    const companyEl = trySelect(COMPANY_SELECTORS);
    return {
      jobTitle: titleEl?.textContent?.trim() || document.title?.replace('| LinkedIn', '').trim() || 'Unknown Role',
      company: companyEl?.textContent?.trim() || 'Unknown Company',
      jobUrl: getJobUrl(),
      jobId: getJobId(),
    };
  }

  function isSubmitButton(el) {
    if (!el) return false;
    const text = el.textContent?.toLowerCase().trim();
    return SUBMIT_BUTTON_TEXTS.some((t) => text === t || text.startsWith(t));
  }

  function findModal() {
    for (const sel of MODAL_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {}
    }
    return null;
  }

  // ─── Submit Detection ─────────────────────────────────────────────────────

  function attachModalListeners(modal) {
    if (modal._appliediqListenerAttached) return;
    modal._appliediqListenerAttached = true;

    modal.addEventListener(
      'click',
      (e) => {
        const target = e.target.closest('button') || e.target;
        if (!isSubmitButton(target)) return;

        const jobData = extractJobData();
        if (!jobData.jobUrl || TRACKED_JOBS.has(jobData.jobUrl)) return;

        // Small delay to let LinkedIn's own handlers fire first
        setTimeout(() => {
          // Verify the modal is closing / closed (indicates successful submit)
          const modalStillOpen = !!findModal();
          // Fire even if modal is still transitioning — LinkedIn might keep it briefly
          sendApplicationRecord(jobData);
        }, 800);
      },
      true // capture phase — fires before LinkedIn's own listeners
    );
  }

  function sendApplicationRecord(jobData) {
    if (TRACKED_JOBS.has(jobData.jobUrl)) return;
    TRACKED_JOBS.add(jobData.jobUrl);

    chrome.runtime.sendMessage(
      {
        type: 'LINKEDIN_APPLY',
        data: {
          jobTitle: jobData.jobTitle,
          company: jobData.company,
          jobUrl: jobData.jobUrl,
          jobId: jobData.jobId,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[AppliedIQ] Could not send apply message:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          showBriefToast(`Tracked: ${jobData.jobTitle} at ${jobData.company}`);
        }
      }
    );
  }

  // ─── External Apply Button Detection ─────────────────────────────────────

  /**
   * LinkedIn's external "Apply" button is a <button> — NOT an <a> tag — so
   * btn.href is always empty. We cannot reliably know the target domain at
   * click time (Workday uses company-specific subdomains).
   *
   * Instead: fire LINKEDIN_EXTERNAL_NAVIGATE keyed by the SOURCE TAB ID.
   * background.js then links the next new tab (via chrome.tabs.onCreated
   * openerTabId) to this pending job, so content-portal.js can retrieve it
   * by its own tab ID — no domain matching needed.
   *
   * Detection strategy (multiple signals, LinkedIn UI changes frequently):
   *  1. Click on `.jobs-apply-button` that does NOT contain "Easy Apply"
   *  2. Click on any button/a containing text "Apply" (not "Easy Apply")
   *     when on a LinkedIn job page
   *  3. mousedown used (fires before LinkedIn's own click handler which
   *     may suppress propagation)
   */
  function watchForExternalApplyClicks() {
    // LinkedIn's dedicated apply button class
    const APPLY_BUTTON_SELECTORS = [
      '.jobs-apply-button',
      '[data-control-name="jobdetails_topcard_inapply"]',
      '[data-control-name="topcard-inline-menuitems-apply"]',
      'button[aria-label*="Apply"]',
      'a[aria-label*="Apply"]',
    ];

    function isExternalApplyTarget(el) {
      if (!el) return false;
      const btn = el.closest(APPLY_BUTTON_SELECTORS.join(', ')) || el.closest('button, a');
      if (!btn) return false;

      const text = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();

      // Must say "apply" or "apply now" but NOT "easy apply"
      const hasApply = text === 'apply' || text.startsWith('apply now') || text === 'apply on company website';
      const isEasyApply = text.includes('easy') || text.includes('1-click') || btn.closest('.jobs-easy-apply-modal');
      return hasApply && !isEasyApply;
    }

    document.addEventListener(
      'mousedown',
      (e) => {
        if (!isExternalApplyTarget(e.target)) return;

        // Must be on a LinkedIn jobs page
        if (!window.location.pathname.includes('/jobs/')) return;

        const jobData = extractJobData();
        if (!jobData.company || jobData.company === 'Unknown Company') return;

        console.log(`[AppliedIQ] External Apply detected: ${jobData.jobTitle} at ${jobData.company}`);

        chrome.runtime.sendMessage(
          {
            type: 'LINKEDIN_EXTERNAL_NAVIGATE',
            data: {
              jobTitle: jobData.jobTitle,
              company: jobData.company,
              linkedInJobUrl: jobData.jobUrl,
              jobId: jobData.jobId,
              // targetDomain intentionally omitted — background.js uses tab ID linkage instead
            },
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.warn('[AppliedIQ] External navigate message failed:', chrome.runtime.lastError.message);
            }
          }
        );
      },
      true // capture phase — fires before LinkedIn's handlers
    );
  }

  // ─── Toast Notification ───────────────────────────────────────────────────

  function showBriefToast(message) {
    const existing = document.getElementById('appliediq-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appliediq-toast';
    toast.textContent = `✅ AppliedIQ: ${message}`;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      background: '#1d4ed8',
      color: '#fff',
      padding: '12px 20px',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      zIndex: '2147483647',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s ease',
      maxWidth: '380px',
      lineHeight: '1.4',
    });
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // ─── Page-Level MutationObserver ──────────────────────────────────────────

  function startObserving() {
    pageObserver = new MutationObserver(() => {
      const modal = findModal();
      if (modal) {
        attachModalListeners(modal);
      }
    });

    pageObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        startObserving();
        watchForExternalApplyClicks();
      });
    } else {
      startObserving();
      watchForExternalApplyClicks();
    }
  }

  init();
})();
