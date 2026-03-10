# 🚀 AppliedIQ — Job Application Tracker Chrome Extension

> **Track every job you apply to. From LinkedIn. From company portals. From anywhere it starts on LinkedIn.**  
> No spreadsheets. No memory gaps. No missed follow-ups.

---

## 🧩 The Problem This Solves

You apply on LinkedIn. You apply on Naukri. You apply on company career portals that LinkedIn redirects you to. Then three weeks pass and you have no idea:

- Which companies you already applied to
- Which jobs went cold and need a follow-up
- Which roles are worth chasing vs ghosting back
- What search filters actually surface good SQE/SDET roles

AppliedIQ fixes all of this — automatically, passively, and locally.

---

## 📦 What's Inside

```
appliediq/
├── manifest.json              → Chrome Extension Manifest V3
├── background.js              → Service worker: tab tracking, alarms, notifications
├── content/
│   ├── content-linkedin.js    → Injected on linkedin.com — detects Easy Apply submit
│   └── content-portal.js      → Injected on all pages — detects external form submission
├── popup/
│   ├── popup.html             → Extension popup (dashboard UI)
│   ├── popup.js               → Table rendering, filter/sort, status updates
│   └── popup.css              → Dashboard styles
├── options/
│   ├── options.html           → Saved LinkedIn query builder
│   └── options.js             → Query CRUD and launch
├── utils/
│   ├── storage.js             → Chrome storage abstraction layer (CRUD)
│   ├── uuid.js                → UUID v4 generator
│   └── emailTemplates.js      → Follow-up email copy templates
├── assets/
│   └── icons/                 → 16px, 48px, 128px extension icons
├── .gitignore                 → Git ignore rules
└── README.md                  → This file
```

---

## 🔍 How Tracking Works

### Scenario 1 — LinkedIn Easy Apply

When you click **Easy Apply** and submit the final step inside LinkedIn's modal:

1. `content-linkedin.js` observes the DOM for the final submission button inside the Easy Apply modal
2. On click, it extracts: **Job Title**, **Company Name**, **Job ID**, **Job URL** from the surrounding job card
3. Fires a message to `background.js` → writes record to `chrome.storage.local`
4. Badge count on the extension icon increments by 1

### Scenario 2 — External Portal via LinkedIn

When you click **Apply** on a LinkedIn job and it redirects to a company careers portal:

1. `background.js` listens to `chrome.tabs.onCreated` and `chrome.webNavigation.onBeforeNavigate`
2. Detects referrer = `linkedin.com` → flags new tab as **LinkedIn-originated**
3. Stores the originating job metadata keyed against the new tab's domain
4. `content-portal.js` injected on the new tab watches for:
   - `<form>` submit events
   - Button clicks matching text patterns: `"Submit"`, `"Apply Now"`, `"Send Application"`, `"Complete Application"`
5. On detection → retrieves stored job metadata → shows **confirmation toast**: `"Did you just apply? ✅ Yes / ❌ No"`
6. On user confirmation → writes complete record to storage

### Scenario 3 — Manual Entry (Fallback)

For jobs applied directly on portals with no LinkedIn origin:

- Click the **"+ Add Job"** button in the popup
- Fill: Company, Role, URL, Date Applied
- Record saved immediately

> **Why the toast confirmation on Scenario 2?**  
> Company portals have wildly inconsistent DOM structures. Grepper-style heuristics have false positive rates of ~30% (login forms, search forms, newsletter signups all look like apply forms). User confirmation eliminates false records entirely.

---

## 🗄️ Data Schema

Every application is stored locally in `chrome.storage.local` — **zero data leaves your browser**.

```json
{
  "id": "uuid-v4",
  "jobTitle": "Senior QA Engineer",
  "company": "Razorpay",
  "jobUrl": "https://linkedin.com/jobs/view/3456789",
  "portalUrl": "https://razorpay.com/careers/apply/senior-qa",
  "source": "linkedin_easy_apply | linkedin_external | manual",
  "appliedDate": "2026-03-08T10:30:00Z",
  "status": "Applied | Followed Up | Interview Scheduled | Technical Round | HR Round | Offer | Rejected | Ghosted",
  "followUpDate": "2026-03-13T00:00:00Z",
  "followUpSent": false,
  "hiringManagerEmail": "",
  "notes": "",
  "tags": ["product-company", "remote", "fintech"]
}
```

---

## 📊 Dashboard (Popup UI)

The popup renders a sortable, filterable table of all applications.

| # | Company | Role | Applied | Source | Status | Follow-up | Actions |
|---|---------|------|---------|--------|--------|-----------|---------|
| 1 | Razorpay | Senior QA Engineer | 08 Mar 2026 | LinkedIn Easy Apply | Applied | ⏰ 13 Mar | ✏️ 📋 🗑️ |
| 2 | Atlassian | SDET II | 06 Mar 2026 | External Portal | Interview Scheduled | ✅ Sent | ✏️ 📋 🗑️ |

**Dashboard Features:**

- **Filter** by Status (dropdown)
- **Sort** by Applied Date (asc/desc)
- **Inline status edit** — click the status chip → dropdown appears
- **Follow-up due badge** — red if overdue, orange if due today, grey if sent
- **Notes field** per row — expandable inline
- **Export CSV** — full table exported as `.csv` for offline use
- **Search** — fuzzy search by company or role name
- **Delete** — soft delete with undo (5s window)

---

## 📬 Follow-Up System

- `followUpDate` = `appliedDate + 5 days` (configurable in Options: 3, 4, 5, 7 days)
- `background.js` registers a daily `chrome.alarms` event
- On alarm fire → queries all jobs where:
  - `followUpDate <= today`
  - `followUpSent === false`
  - `status === "Applied"`
- Triggers `chrome.notifications.create` with job details
- Clicking the notification → opens popup focused on that job row
- Pre-filled follow-up email template copies to clipboard on one click:

```
Subject: Follow-up on my application — [Job Title] at [Company]

Hi [Hiring Team / Hiring Manager's Name],

I recently applied for the [Job Title] position at [Company] on [Applied Date] 
and wanted to briefly follow up to express my continued interest.

I have X years of experience in [relevant skills], and I believe my background 
in [specific area] aligns well with the role's requirements.

Please let me know if you need any additional information.

Looking forward to hearing from you.

Best regards,  
[Your Name]  
[LinkedIn Profile URL]
```

> **Limitation:** Hiring manager email must be added manually to each record. AppliedIQ cannot scrape private contact data.

---

## 🔎 LinkedIn Search Query Builder

The **Options page** includes a saved query panel with pre-built LinkedIn job search URLs, optimized for SQE/SDET roles.

### Pre-Built Queries

| Query Name | Filters Applied |
|---|---|
| SDET Remote India — Last 24h | Senior level, Remote, Full-time, Last 24 hours |
| Senior QA Java — Product Companies | Java keyword, Senior level, India |
| QA Lead Bangalore — This Week | Bangalore, Lead level, Last 7 days |
| Automation Engineer Fintech/SaaS | Fintech tag, Automation keyword |
| SQE Open to Relocation — Funded Startups | Multiple locations, Startup filter |

### Query URL Structure

```
https://www.linkedin.com/jobs/search/?
  keywords=Senior+QA+Engineer+OR+SDET+OR+%22Senior+Quality+Engineer%22
  &location=India
  &f_E=4              → Experience: Senior level
  &f_TPR=r86400       → Time: Last 24 hours (r604800 = last week)
  &f_WT=2             → Work Type: Remote (1=On-site, 3=Hybrid)
  &f_JT=F             → Job Type: Full-time
  &sortBy=DD          → Sort: Date (newest first)
  &f_I=96,4           → Industry: Software & IT Services, Internet
```

One click on any saved query → opens LinkedIn in a new tab with all filters pre-applied.

**Custom Query Builder:** Dropdown-based UI in Options to build and save your own queries without touching URLs manually.

---

## 🔐 Permissions Breakdown

```json
{
  "permissions": [
    "storage",       → Stores application records locally
    "alarms",        → Daily follow-up check
    "notifications", → Follow-up reminders
    "tabs",          → Detects LinkedIn-originated tab opens
    "activeTab",     → Reads current tab for job data extraction
    "scripting"      → Injects content scripts dynamically
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",  → LinkedIn Easy Apply detection
    "https://*/*"                  → External portal form detection
  ]
}
```

> **Privacy:** `https://*/*` sounds broad. It is. But all processing happens client-side. No analytics, no external API calls, no telemetry. Verify in `background.js` — outbound network requests: zero.

---

## ⚙️ Installation (Developer Mode)

```bash
# 1. Clone the repository
git clone https://github.com/abhishek-admin/appliediq.git
cd appliediq

# 2. Open Chrome and navigate to
chrome://extensions/

# 3. Enable "Developer mode" (top right toggle)

# 4. Click "Load unpacked"

# 5. Select the /appliediq folder

# 6. Pin the extension from the puzzle icon in your toolbar
```

No build step. No npm install. Plain Manifest V3 — loads directly.

---

## 🚨 Known Limitations & Failure Points

| Failure | Cause | Current Mitigation |
|---|---|---|
| SPA portal detection miss | React/Angular apps don't fire native `<form>` submit | XHR/fetch intercept via injected page script |
| LinkedIn DOM selector drift | LinkedIn updates UI — selectors break | Multiple fallback selectors + version-pinned mutation observer |
| Easy Apply multi-step miss | Tracking fires on first click, not final submit | Modal step observer — only fires on final "Submit" button |
| False positive form detection | Login/search/newsletter forms match patterns | Confirmation toast — user validates before record is written |
| Follow-up email delivery | Can't auto-fetch hiring manager emails | Manual email field on each record; template copies to clipboard |
| Storage limits | `chrome.storage.local` capped at 5MB by default | ~10,000 records before limit; CSV export for archival |

---

## 🗺️ Roadmap

- [ ] **v1.0** — Core tracking (Easy Apply + External Portal + Manual)
- [ ] **v1.1** — Follow-up alarm + notification system
- [ ] **v1.2** — LinkedIn query builder panel
- [ ] **v1.3** — CSV export + import
- [ ] **v1.4** — Naukri.com detection support
- [ ] **v2.0** — Optional Google Sheets sync (OAuth, explicit user action)
- [ ] **v2.1** — Recruiter name + email scraper from LinkedIn job posts
- [ ] **v2.2** — Application analytics dashboard (response rate, avg time to reply by company size)

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/portal-detection-v2`
3. Commit with context: `git commit -m "feat: add Workday portal XHR intercept"`
4. Push and open a PR with a description of what broke before and what works now

**Bug reports:** Open an issue with the company portal URL, browser version, and what the extension did vs what you expected.

---

## 📄 License

MIT License. Use it, fork it, ship it.

---

## 👤 Author

Built by **Abhishek (Happy)** — Senior SDET @ Tavant Technologies  
Tired of losing track of 200+ applications with 4 callbacks.  

> *"Track everything. Follow up on everything. Let nothing fall through the cracks."*
