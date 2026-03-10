// content-portal.js
// Injected on all non-LinkedIn pages (https all pages)
// Detects application form submissions on external company career portals
// that were opened via LinkedIn.
//
// Strategy:
//  1. On load, ask background.js if this tab has a pending LinkedIn job
//  2. If found, watch for form submits and apply-button clicks
//  3. On detection: show confirmation toast "Did you just apply? Yes / No"
//  4. On Yes: fire PORTAL_APPLY_CONFIRM to background.js
//
// False positive mitigation:
//  - Confirmation toast stops false records from login/search/newsletter forms
//  - XHR/fetch intercept catches SPA portals that skip native form.submit

(function () {
  'use strict';

  // Skip extension pages
  if (
    window.location.protocol === 'chrome-extension:' ||
    window.location.protocol === 'about:' ||
    window.location.hostname === 'newtab'
  ) {
    return;
  }

  var pendingJobData = null;
  var toastActive = false;
  var hasConfirmed = false;

  var APPLY_BUTTON_PATTERNS = [
    /^submit application$/i,
    /^submit$/i,
    /^apply now$/i,
    /^apply$/i,
    /^send application$/i,
    /^complete application$/i,
    /^finish application$/i,
    /^complete my application$/i,
    /^send my application$/i,
    /^confirm application$/i,
    /^confirm & submit$/i,
    /^confirm and submit$/i,
    /^submit & apply$/i,
    /^submit and apply$/i,
    /^review & submit$/i,
    /^review and submit$/i,
    /^submit my application$/i,
    /^apply for this job$/i,
    /^apply for this position$/i,
    /^apply for this role$/i,
    /^apply to this job$/i,
    /^one.?click apply$/i,
    /^quick apply$/i,
    /submit.*application/i,
    /apply.*now/i,
  ];

  var FORM_EXCLUSION_PATTERNS = [
    /login/i, /sign.?in/i, /sign.?up/i,
    /newsletter/i, /subscribe/i,
    /forgot.?password/i, /reset.?password/i,
  ];

  // --- Init ---

  function init() {
    var domain = window.location.hostname;
    chrome.runtime.sendMessage(
      { type: 'GET_PENDING_JOB', domain: domain },
      function (response) {
        if (chrome.runtime.lastError) return;
        if (!response || !response.found) return;
        pendingJobData = response.data;
        attachDetectors();
      }
    );
  }

  // --- Form & Button Detection ---

  function attachDetectors() {
    document.addEventListener('submit', onFormSubmit, true);
    document.addEventListener('click', onButtonClick, true);
    interceptXHR();
    interceptFetch();
  }

  function onFormSubmit(e) {
    if (hasConfirmed || toastActive) return;
    var form = e.target;
    if (!form || !(form instanceof HTMLFormElement)) return;
    if (isExcludedForm(form)) return;
    showConfirmationToast();
  }

  function onButtonClick(e) {
    if (hasConfirmed || toastActive) return;
    var btn = e.target.closest('button, input[type="submit"], a[role="button"]');
    if (!btn) return;
    var text = (btn.textContent || btn.value || '').trim();
    if (!APPLY_BUTTON_PATTERNS.some(function (p) { return p.test(text); })) return;
    showConfirmationToast();
  }

  function isExcludedForm(form) {
    var parts = [
      form.action,
      form.id,
      form.className,
      form.getAttribute('name'),
    ];
    var inputs = form.querySelectorAll('input[name]');
    for (var i = 0; i < inputs.length; i++) {
      parts.push(inputs[i].name);
    }
    var formText = parts.filter(Boolean).join(' ').toLowerCase();
    return FORM_EXCLUSION_PATTERNS.some(function (p) { return p.test(formText); });
  }

  // --- XHR / Fetch Intercept (SPA portals like Workday/Greenhouse) ---

  function interceptXHR() {
    var OrigXHR = window.XMLHttpRequest;
    if (!OrigXHR) return;
    var OrigOpen = OrigXHR.prototype.open;
    var OrigSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (method, url) {
      this._aiqUrl = url;
      this._aiqMethod = method;
      return OrigOpen.apply(this, arguments);
    };

    OrigXHR.prototype.send = function (body) {
      var self = this;
      if (
        !hasConfirmed &&
        !toastActive &&
        self._aiqMethod &&
        self._aiqMethod.toUpperCase() === 'POST' &&
        isApplyEndpoint(self._aiqUrl)
      ) {
        self.addEventListener('load', function () {
          if (self.status >= 200 && self.status < 300) {
            showConfirmationToast();
          }
        });
      }
      return OrigSend.apply(this, arguments);
    };
  }

  function interceptFetch() {
    if (!window.fetch) return;
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
      var method = ((init && init.method) || 'GET').toUpperCase();
      var promise = origFetch.apply(this, arguments);
      if (!hasConfirmed && !toastActive && method === 'POST' && isApplyEndpoint(url)) {
        promise.then(function (response) {
          if (response.ok) showConfirmationToast();
        }).catch(function () {});
      }
      return promise;
    };
  }

  function isApplyEndpoint(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    return (
      lower.indexOf('/apply') !== -1 ||
      lower.indexOf('/application') !== -1 ||
      lower.indexOf('/submit') !== -1 ||
      lower.indexOf('/candidate') !== -1 ||
      lower.indexOf('/job-application') !== -1 ||
      lower.indexOf('/job-apply') !== -1 ||
      lower.indexOf('/createapplication') !== -1 ||
      lower.indexOf('/confirmapplication') !== -1 ||
      lower.indexOf('/applyonline') !== -1 ||
      lower.indexOf('/jobapply') !== -1 ||
      lower.indexOf('/questionnaire') !== -1 ||
      lower.indexOf('/careerapply') !== -1
    );
  }

  // --- Confirmation Toast ---

  function showConfirmationToast() {
    if (toastActive || hasConfirmed) return;
    toastActive = true;

    injectStyles();

    var jobTitle = (pendingJobData && pendingJobData.jobTitle) ? pendingJobData.jobTitle : 'This job';
    var company = (pendingJobData && pendingJobData.company) ? pendingJobData.company : 'this company';

    var toast = document.createElement('div');
    toast.id = 'appliediq-confirm-toast';
    toast.innerHTML =
      '<div class="aiq-toast-icon">&#128203;</div>' +
      '<div class="aiq-toast-content">' +
        '<div class="aiq-toast-title">Did you just apply?</div>' +
        '<div class="aiq-toast-company">' + escapeHtml(jobTitle) + ' at ' + escapeHtml(company) + '</div>' +
        '<div class="aiq-toast-actions">' +
          '<button id="aiq-yes" class="aiq-btn aiq-btn-yes">Yes, I applied</button>' +
          '<button id="aiq-no" class="aiq-btn aiq-btn-no">No</button>' +
        '</div>' +
      '</div>' +
      '<button id="aiq-close" class="aiq-toast-close" title="Dismiss">x</button>';

    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('aiq-visible');
    });

    document.getElementById('aiq-yes').addEventListener('click', function () {
      hasConfirmed = true;
      dismissToast(toast);
      confirmApplication();
    });

    document.getElementById('aiq-no').addEventListener('click', function () {
      dismissToast(toast);
    });

    document.getElementById('aiq-close').addEventListener('click', function () {
      dismissToast(toast);
    });

    setTimeout(function () {
      if (document.getElementById('appliediq-confirm-toast')) {
        dismissToast(toast);
      }
    }, 30000);
  }

  function dismissToast(toast) {
    toast.classList.remove('aiq-visible');
    toast.classList.add('aiq-hiding');
    setTimeout(function () { toast.remove(); }, 300);
    toastActive = false;
  }

  function confirmApplication() {
    chrome.runtime.sendMessage(
      {
        type: 'PORTAL_APPLY_CONFIRM',
        data: {
          jobTitle: (pendingJobData && pendingJobData.jobTitle) ? pendingJobData.jobTitle : 'Unknown Role',
          company: (pendingJobData && pendingJobData.company) ? pendingJobData.company : 'Unknown Company',
          linkedInJobUrl: (pendingJobData && pendingJobData.linkedInJobUrl) ? pendingJobData.linkedInJobUrl : '',
          portalUrl: window.location.href,
          targetDomain: window.location.hostname,
        },
      },
      function (response) {
        if (chrome.runtime.lastError) return;
        if (response && response.success) {
          showSuccessToast(
            (pendingJobData && pendingJobData.jobTitle) || '',
            (pendingJobData && pendingJobData.company) || ''
          );
        }
      }
    );
  }

  function showSuccessToast(jobTitle, company) {
    injectStyles();
    var toast = document.createElement('div');
    toast.id = 'appliediq-success-toast';
    toast.innerHTML =
      '<span>Tracked: <strong>' + escapeHtml(jobTitle || 'Application') +
      '</strong> at <strong>' + escapeHtml(company || '') + '</strong></span>';
    document.body.appendChild(toast);

    requestAnimationFrame(function () { toast.classList.add('aiq-visible'); });

    setTimeout(function () {
      toast.classList.remove('aiq-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
  }

  // --- Styles ---

  function injectStyles() {
    if (document.getElementById('appliediq-styles')) return;
    var style = document.createElement('style');
    style.id = 'appliediq-styles';
    style.textContent = [
      '#appliediq-confirm-toast {',
      '  position: fixed; bottom: 24px; right: 24px;',
      '  background: #1e293b; color: #f1f5f9;',
      '  border-radius: 12px; padding: 16px 20px;',
      '  display: flex; align-items: flex-start; gap: 14px;',
      '  z-index: 2147483647;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.4);',
      '  max-width: 380px;',
      '  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;',
      '  font-size: 14px;',
      '  transform: translateY(120%); opacity: 0;',
      '  transition: transform 0.3s ease, opacity 0.3s ease;',
      '  border: 1px solid #334155;',
      '}',
      '#appliediq-confirm-toast.aiq-visible { transform: translateY(0); opacity: 1; }',
      '#appliediq-confirm-toast.aiq-hiding  { transform: translateY(120%); opacity: 0; }',
      '.aiq-toast-icon { font-size: 24px; flex-shrink: 0; margin-top: 2px; }',
      '.aiq-toast-content { flex: 1; }',
      '.aiq-toast-title { font-weight: 700; font-size: 15px; margin-bottom: 4px; color: #f8fafc; }',
      '.aiq-toast-company { font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.4; }',
      '.aiq-toast-actions { display: flex; gap: 8px; }',
      '.aiq-btn { border: none; border-radius: 6px; padding: 7px 14px;',
      '  font-size: 13px; font-weight: 600; cursor: pointer;',
      '  transition: opacity 0.15s; font-family: inherit; }',
      '.aiq-btn:hover { opacity: 0.85; }',
      '.aiq-btn-yes { background: #2563eb; color: #fff; }',
      '.aiq-btn-no  { background: #334155; color: #cbd5e1; }',
      '.aiq-toast-close {',
      '  background: none; border: none; color: #64748b;',
      '  font-size: 20px; cursor: pointer; padding: 0;',
      '  line-height: 1; flex-shrink: 0; align-self: flex-start; margin-top: -2px;',
      '}',
      '.aiq-toast-close:hover { color: #f1f5f9; }',
      '#appliediq-success-toast {',
      '  position: fixed; bottom: 24px; right: 24px;',
      '  background: #166534; color: #dcfce7;',
      '  border-radius: 8px; padding: 12px 18px;',
      '  display: flex; align-items: center; gap: 10px;',
      '  z-index: 2147483647;',
      '  box-shadow: 0 4px 20px rgba(0,0,0,0.3);',
      '  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;',
      '  font-size: 14px;',
      '  transform: translateY(120%); opacity: 0;',
      '  transition: transform 0.3s ease, opacity 0.3s ease;',
      '  max-width: 360px; border: 1px solid #15803d;',
      '}',
      '#appliediq-success-toast.aiq-visible { transform: translateY(0); opacity: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Run ---

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
