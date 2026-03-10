# AppliedIQ — Standard Operating Procedure

How to install, configure, and use the extension end-to-end.

---

## 1. Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle, top-right corner)
3. Click **Load unpacked**
4. Select the `appliediq/` folder (the one containing `manifest.json`)
5. The AppliedIQ icon appears in your Chrome toolbar
6. Pin it for quick access (click the puzzle piece → pin AppliedIQ)

---

## 2. First-Time Setup (Options Page)

Click the AppliedIQ icon → **Settings** button (gear icon), or right-click the extension icon → **Options**.

### Profile

Fill in your details — these are used in AI-generated follow-up emails:

| Field | Example |
|-------|---------|
| Your Name | Abhishek Srivastava |
| Current Role | Senior SDET |
| Years of Experience | 5 |
| Target Role | Senior SDET / SQE |
| Location | Noida, India |
| Notice Period | 30 days |

Click **Save Profile**.

### Gemini AI (Optional but recommended)

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Paste it into the **Gemini API Key** field
3. Click **List Models** to see available models — click one to select it
   - Recommended: `gemini-2.5-flash-preview-04-17`
4. Click **Save API Key**
5. Click **Test Connection** to verify it works

Without an API key, follow-up emails fall back to a static template (still functional).

### Follow-up Reminder Interval

Set how many days after applying before you get a follow-up reminder (default: 5 days).

---

## 3. Tracking a LinkedIn Easy Apply Job

These are jobs where LinkedIn's own application modal opens (not an external site).

1. Find a job on LinkedIn with the blue **Easy Apply** button
2. Click **Easy Apply** — the modal opens
3. Fill out all required fields across every step
4. On the final page, click **Submit application**
5. AppliedIQ detects the submit and **automatically saves** the job to your tracker
6. A green success toast briefly appears: `Tracked: [Job Title] at [Company]`

No manual action needed. The record appears in your dashboard immediately.

---

## 4. Tracking an External Apply Job (Workday, Greenhouse, Company Career Pages, etc.)

These are jobs where clicking **Apply** on LinkedIn opens an external website — e.g.:
- `agilent.wd5.myworkdayjobs.com`
- `careers.spglobal.com`
- `jobs.greenhouse.io`
- `lever.co`
- Any company-specific careers portal

### How it works

When you click the LinkedIn **Apply** button that opens an external site, AppliedIQ:
1. Captures the job title and company from the LinkedIn listing
2. Tags the new tab when it opens
3. Runs silently in the background on the career portal page

### Step-by-step

1. On LinkedIn, click the **Apply** button (the one that opens an external site — NOT the blue Easy Apply button)
2. A new tab opens with the company's career portal (Workday, Greenhouse, custom, etc.)
3. Fill out the application form completely
4. Click the final **Submit / Apply / Submit Application** button on the career portal
5. A confirmation toast appears: **"Did you just apply? — [Job Title] at [Company]"**
6. Click **Yes, I applied**
7. AppliedIQ saves the record with the company career page URL as `portalUrl`

> **If the toast does not appear automatically:**
> The portal may use a non-standard submit flow. In that case, use **Manual Add** (see Section 6).

---

## 5. What Gets Tracked Automatically

| Field | Easy Apply | External Portal |
|-------|-----------|----------------|
| Job Title | Yes (from LinkedIn) | Yes (from LinkedIn) |
| Company | Yes | Yes |
| LinkedIn Job URL | Yes | Yes |
| Portal/Career Page URL | — | Yes (current URL at confirmation) |
| Applied Date | Auto (now) | Auto (now) |
| Source | `LinkedIn Easy Apply` | `LinkedIn External` |
| Status | Applied | Applied |
| Follow-up Date | Auto (+N days from settings) | Auto (+N days from settings) |

---

## 6. Manual Add

For jobs you applied to directly (not via LinkedIn), or if auto-tracking missed one:

1. Click the AppliedIQ toolbar icon to open the dashboard
2. Click **+ Add Job** button
3. Fill in: Job Title, Company, Job URL, Applied Date, Source
4. Click **Save**

---

## 7. Dashboard Overview

Open the extension popup to see your dashboard.

### Stats Bar
- **Total** — all tracked applications
- **Applied** — awaiting response
- **Follow-up Due** — reminders due today or overdue
- **In Process** — Interview Scheduled / Technical Round / HR Round / Offer

### Table Columns
- **Job / Company** — title, company name, source badge, follow-up badge
- **Applied** — date applied
- **Status** — click the status chip to change it inline

### Filtering & Search
- Type in the search box to filter by job title or company
- Use the **Status** dropdown to filter by a specific status
- Use the **Sort** dropdown to sort by date (newest/oldest) or company name

### Status Options
`Applied` → `Followed Up` → `Interview Scheduled` → `Technical Round` → `HR Round` → `Offer` → `Rejected` → `Ghosted`

Click any status badge in the table to change it — it auto-saves on selection.

---

## 8. Follow-up Emails

When a follow-up is due (badge turns orange/red):

1. Click the **envelope icon** (✉) on any application row
2. The Follow-up Email modal opens with a pre-generated email
3. If Gemini is configured, the email is AI-generated (specific to the role)
4. Copy the subject and body into your email client
5. After sending, click **Mark as Sent** — this clears the follow-up badge

---

## 9. AI Features (Requires Gemini API Key)

Click the AI toolbar buttons in the dashboard:

| Button | What it does |
|--------|-------------|
| **Analyze** | Summarizes your overall application pipeline — patterns, response rates, insights |
| **Evaluate JD** | Paste a job description → AI scores fit and highlights gaps |
| **Search Links** | AI suggests optimized LinkedIn search URLs based on your profile and target role |
| **Prioritize** | Ranks your current applications by likelihood of response |

---

## 10. Saved LinkedIn Search Queries

Pre-loaded queries open targeted LinkedIn searches with one click.

1. Open **Options** → scroll to **Saved Search Queries**
2. Click **▶ Launch** next to any query to open it in a new tab

### Pre-loaded queries include:

**Broad searches:**
- SDET Remote India (Last 24h)
- Senior QA Java — Product Companies
- QA Lead Bengaluru (This Week)
- Automation Engineer Fintech / SaaS
- Selenium / Playwright QA — Hybrid Bengaluru

**City-specific (posted in last 6 hours — typically <10 applicants):**
- SDET Bengaluru — Last 6 Hours
- SDET Hyderabad — Last 6 Hours
- SDET Pune — Last 6 Hours
- SDET Gurgaon / Delhi NCR — Last 6 Hours
- SDET Noida — Last 6 Hours

**Ultra-fresh (highest chance of <10 applicants):**
- QA/SDET Pan-India — Last 3 Hours
- QA/SDET Pan-India — Last 1 Hour

**Framework-specific:**
- Selenium / REST Assured — Bengaluru (Last 24h)
- Playwright / Cypress — Pune (Last 24h)

### Adding a custom query
1. Click **+ Add Query**
2. Paste the LinkedIn jobs search URL
3. Give it a name and optional description
4. Click **Save Query**

### Resetting to defaults
If you added queries previously and want the new default queries to appear:
Click **Reset to Defaults** (this replaces all saved queries with the full default set).

---

## 11. Follow-up Reminders (Chrome Notifications)

AppliedIQ checks daily for overdue follow-ups and fires a Chrome notification when any are due.

- The notification appears even when Chrome is in the background
- Click the notification → opens the AppliedIQ popup
- Check the **Follow-up Due** stat in the dashboard to see how many are pending

---

## 12. Data Export & Backup

In **Options** → **Data Management**:

| Action | Format | Use case |
|--------|--------|----------|
| Export JSON | `.json` | Full backup, can be re-imported later |
| Export CSV | `.csv` | Open in Excel / Google Sheets for analysis |
| Clear All Data | — | Hard reset (irreversible) |

---

## 13. Editing or Deleting a Record

In the dashboard table:
- Click the **edit icon (✏)** on any row to open the Edit Job modal
- Update any field and click **Save**
- Click the **delete icon (✕)** to remove a record — a 5-second undo bar appears at the bottom

---

## 14. Troubleshooting

### Extension not tracking Easy Apply
- Make sure you click **Submit application** on the last page of the modal (not just "Next")
- Check that the extension is enabled at `chrome://extensions/`

### External portal not showing the confirmation toast
- The portal may use a non-standard form flow
- Use **Manual Add** as a fallback
- Check the browser console on the career page for errors (F12 → Console)

### Gemini API errors
- Open **Options** → click **List Models** to see which models your key has access to
- Select a working model and click **Save API Key**
- Click **Test Connection** to verify

### New default queries not showing
- Go to **Options** → **Saved Search Queries** → click **Reset to Defaults**

### After updating the extension
- Go to `chrome://extensions/` → click the **reload icon** on AppliedIQ
- Refresh any LinkedIn tabs that were open before reloading

---

## 15. Privacy

- All data is stored in `chrome.storage.local` — **nothing leaves your browser**
- The only external calls are to the Gemini API (if you configure an API key) — only the job description text and your profile fields are sent
- No analytics, no telemetry, no external servers

---

*AppliedIQ — Built for SDET / QA job seekers. Zero cloud, full control.*
