/**
 * storage.js — Chrome storage abstraction layer
 * All application records are stored in chrome.storage.local.
 * Zero data leaves the browser. No external API calls for storage.
 *
 * Schema per record:
 * {
 *   id: string (UUID v4),
 *   jobTitle: string,
 *   company: string,
 *   jobUrl: string,
 *   portalUrl: string,
 *   source: 'linkedin_easy_apply' | 'linkedin_external' | 'manual',
 *   appliedDate: string (ISO 8601),
 *   status: 'Applied' | 'Followed Up' | 'Interview Scheduled' | 'Technical Round' | 'HR Round' | 'Offer' | 'Rejected' | 'Ghosted',
 *   followUpDate: string (ISO 8601),
 *   followUpSent: boolean,
 *   hiringManagerName: string,
 *   hiringManagerEmail: string,
 *   notes: string,
 *   tags: string[]
 * }
 */

const STORAGE_KEY = 'appliediq_applications';
const SETTINGS_KEY = 'appliediq_settings';
const QUERIES_KEY = 'appliediq_queries';

const StorageAPI = {

  /**
   * Get all application records.
   * @returns {Promise<Object[]>}
   */
  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || []);
      });
    });
  },

  /**
   * Get a single application by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getById(id) {
    const all = await this.getAll();
    return all.find((r) => r.id === id) || null;
  },

  /**
   * Save a new application record.
   * @param {Object} record — must include all required fields; id will be set if missing
   * @returns {Promise<Object>} saved record
   */
  async save(record) {
    const all = await this.getAll();
    const existing = all.findIndex((r) => r.id === record.id);
    if (existing >= 0) {
      all[existing] = record;
    } else {
      all.unshift(record); // newest first
    }
    await this._write(all);
    return record;
  },

  /**
   * Update specific fields on an existing record.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<Object|null>}
   */
  async update(id, updates) {
    const all = await this.getAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    all[idx] = { ...all[idx], ...updates };
    await this._write(all);
    return all[idx];
  },

  /**
   * Delete a record by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const all = await this.getAll();
    const filtered = all.filter((r) => r.id !== id);
    if (filtered.length === all.length) return false;
    await this._write(filtered);
    return true;
  },

  /**
   * Query records by status.
   * @param {string} status
   * @returns {Promise<Object[]>}
   */
  async getByStatus(status) {
    const all = await this.getAll();
    return all.filter((r) => r.status === status);
  },

  /**
   * Get records where follow-up is due and not yet sent.
   * @returns {Promise<Object[]>}
   */
  async getDueFollowUps() {
    const all = await this.getAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return all.filter((r) => {
      if (r.followUpSent || r.status !== 'Applied') return false;
      if (!r.followUpDate) return false;
      const due = new Date(r.followUpDate);
      return due <= today;
    });
  },

  /**
   * Check if a job URL has already been recorded.
   * @param {string} jobUrl
   * @returns {Promise<boolean>}
   */
  async isDuplicate(jobUrl) {
    const all = await this.getAll();
    return all.some((r) => r.jobUrl === jobUrl || r.portalUrl === jobUrl);
  },

  // --- Settings ---

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY], (result) => {
        resolve(
          result[SETTINGS_KEY] || {
            followUpDays: 5,
            userName: '',
            currentRole: '',
            yearsOfExperience: '',
            targetRole: 'Senior SDET / SQE',
            location: 'Bengaluru, India',
            noticePeriod: '',
            geminiApiKey: '',
            geminiModel: 'gemini-2.5-flash-preview-04-17',
          }
        );
      });
    });
  },

  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
    });
  },

  // --- Saved Queries ---

  async getQueries() {
    return new Promise((resolve) => {
      chrome.storage.local.get([QUERIES_KEY], (result) => {
        resolve(result[QUERIES_KEY] || getDefaultQueries());
      });
    });
  },

  async saveQueries(queries) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [QUERIES_KEY]: queries }, resolve);
    });
  },

  // --- Internal ---

  async _write(records) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: records }, resolve);
    });
  },

  /**
   * Export all records as JSON string.
   */
  async exportJSON() {
    const all = await this.getAll();
    return JSON.stringify(all, null, 2);
  },

  /**
   * Export all records as CSV string.
   */
  async exportCSV() {
    const all = await this.getAll();
    if (all.length === 0) return '';
    const headers = [
      'id', 'jobTitle', 'company', 'jobUrl', 'portalUrl', 'source',
      'appliedDate', 'status', 'followUpDate', 'followUpSent',
      'hiringManagerName', 'hiringManagerEmail', 'notes', 'tags'
    ];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = all.map((r) =>
      headers.map((h) => escape(h === 'tags' ? (r.tags || []).join(';') : r[h])).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  },
};

function getDefaultQueries() {
  return [
    {
      id: 'q1',
      name: 'SDET Remote India — Last 24h',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Senior+QA+Engineer+OR+SDET+OR+%22Senior+Quality+Engineer%22&location=India&f_E=4&f_TPR=r86400&f_WT=2&f_JT=F&sortBy=DD&f_I=96%2C4',
      description: 'Senior level, Remote, Full-time, Last 24 hours',
    },
    {
      id: 'q2',
      name: 'Senior QA Java — Product Companies',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Senior+QA+Engineer+Java+OR+%22Test+Automation%22+OR+%22REST+Assured%22&location=India&f_E=4&f_JT=F&sortBy=DD&f_I=96%2C4',
      description: 'Java keyword, Senior level, India — product company focused',
    },
    {
      id: 'q3',
      name: 'QA Lead Bengaluru — This Week',
      url: 'https://www.linkedin.com/jobs/search/?keywords=QA+Lead+OR+%22Quality+Lead%22+OR+%22Test+Lead%22&location=Bengaluru%2C+Karnataka%2C+India&f_E=4&f_TPR=r604800&f_JT=F&sortBy=DD',
      description: 'Bengaluru, Lead level, Last 7 days',
    },
    {
      id: 'q4',
      name: 'Automation Engineer Fintech / SaaS',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Automation+Engineer+OR+%22SDET%22+OR+%22QA+Automation%22&location=India&f_E=4&f_JT=F&sortBy=DD&f_I=6%2C96',
      description: 'Fintech + Software/IT, Automation keyword, Senior level',
    },
    {
      id: 'q5',
      name: 'SQE Open to Relocation — Funded Startups',
      url: 'https://www.linkedin.com/jobs/search/?keywords=%22Quality+Engineer%22+OR+SDET+OR+%22Software+Engineer+in+Test%22&location=India&f_E=3%2C4&f_JT=F&f_TPR=r604800&sortBy=DD',
      description: 'Multiple exp levels, Full-time, India-wide, Last 7 days',
    },
    {
      id: 'q6',
      name: 'Selenium / Playwright QA — Hybrid Bengaluru',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Selenium+OR+Playwright+OR+Cypress+QA+Engineer&location=Bengaluru%2C+Karnataka%2C+India&f_E=4&f_WT=3&f_JT=F&sortBy=DD',
      description: 'Framework-specific, Hybrid, Bengaluru, Senior level',
    },

    // ── City-specific · Fresh postings (posted in last 6h / 3h / 1h) ───────────
    // LinkedIn time parameters: r3600=1h · r10800=3h · r21600=6h · r86400=24h
    // "Under 10 applicants" has no stable URL param — using <6h as the proxy:
    // a post with <6h age typically has 0–5 applicants before it surfaces in feeds.
    // f_EA=true adds the "Early Applicant" signal (LinkedIn-defined, shown on card).

    {
      id: 'q7',
      name: 'SDET Bengaluru — Last 6 Hours (Early)',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22Senior+QA+Engineer%22+OR+%22Automation+Engineer%22+OR+%22Quality+Engineer%22&location=Bengaluru%2C+Karnataka%2C+India&f_E=3%2C4&f_TPR=r21600&f_JT=F&sortBy=DD',
      description: 'Bengaluru · Senior/Mid · Full-time · Posted last 6 hours · Sort by newest',
    },
    {
      id: 'q8',
      name: 'SDET Hyderabad — Last 6 Hours (Early)',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22Senior+QA+Engineer%22+OR+%22Automation+Engineer%22+OR+%22Quality+Engineer%22&location=Hyderabad%2C+Telangana%2C+India&f_E=3%2C4&f_TPR=r21600&f_JT=F&sortBy=DD',
      description: 'Hyderabad · Senior/Mid · Full-time · Posted last 6 hours · Sort by newest',
    },
    {
      id: 'q9',
      name: 'SDET Pune — Last 6 Hours (Early)',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22Senior+QA+Engineer%22+OR+%22Automation+Engineer%22+OR+%22Quality+Engineer%22&location=Pune%2C+Maharashtra%2C+India&f_E=3%2C4&f_TPR=r21600&f_JT=F&sortBy=DD',
      description: 'Pune · Senior/Mid · Full-time · Posted last 6 hours · Sort by newest',
    },
    {
      id: 'q10',
      name: 'SDET Gurgaon / Delhi NCR — Last 6 Hours (Early)',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22Senior+QA+Engineer%22+OR+%22Automation+Engineer%22+OR+%22Quality+Engineer%22&location=Gurugram%2C+Haryana%2C+India&f_E=3%2C4&f_TPR=r21600&f_JT=F&sortBy=DD',
      description: 'Gurugram + Delhi NCR · Senior/Mid · Posted last 6 hours · Sort by newest',
    },
    {
      id: 'q11',
      name: 'SDET Noida — Last 6 Hours (Early)',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22Senior+QA+Engineer%22+OR+%22Automation+Engineer%22+OR+%22Quality+Engineer%22&location=Noida%2C+Uttar+Pradesh%2C+India&f_E=3%2C4&f_TPR=r21600&f_JT=F&sortBy=DD',
      description: 'Noida · Senior/Mid · Full-time · Posted last 6 hours · Sort by newest',
    },

    // ── Ultra-fresh: last 3 hours — highest chance of <10 applicants ─────────

    {
      id: 'q12',
      name: 'QA/SDET Pan-India — Last 3 Hours',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22QA+Automation%22+OR+%22Senior+Quality+Engineer%22+OR+%22Test+Automation+Engineer%22&location=India&f_E=3%2C4&f_TPR=r10800&f_JT=F&sortBy=DD',
      description: 'All India · Last 3 hours · Highest chance of <10 applicants · Sort by newest',
    },
    {
      id: 'q13',
      name: 'QA/SDET Pan-India — Last 1 Hour',
      url: 'https://www.linkedin.com/jobs/search/?keywords=SDET+OR+%22QA+Automation%22+OR+%22Senior+Quality+Engineer%22+OR+%22Test+Automation+Engineer%22&location=India&f_E=3%2C4&f_TPR=r3600&f_JT=F&sortBy=DD',
      description: 'All India · Last 1 hour · Likely 0–3 applicants · Use morning + evening',
    },

    // ── Hybrid city + framework combos ───────────────────────────────────────

    {
      id: 'q14',
      name: 'Selenium / REST Assured — Bengaluru + Hyderabad — Last 24h',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Selenium+OR+%22REST+Assured%22+OR+%22TestNG%22+QA+Engineer&location=Bengaluru%2C+Karnataka%2C+India&f_E=4&f_TPR=r86400&f_JT=F&sortBy=DD',
      description: 'Framework-specific · Bengaluru · Senior · Last 24h · Full-time',
    },
    {
      id: 'q15',
      name: 'Playwright / Cypress SDET — Pune + Hyderabad — Last 24h',
      url: 'https://www.linkedin.com/jobs/search/?keywords=Playwright+OR+Cypress+OR+%22Automation+Framework%22+QA&location=Pune%2C+Maharashtra%2C+India&f_E=3%2C4&f_TPR=r86400&f_JT=F&sortBy=DD',
      description: 'Modern frameworks · Pune · Mid-Senior · Last 24h',
    },
  ];
}
