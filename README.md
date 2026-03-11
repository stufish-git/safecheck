# SafeChecks — Restaurant Food Safety PWA

A Progressive Web App for restaurant food safety compliance.  
Installs on any phone/tablet, works offline, syncs to Google Sheets.

---

## 📋 What's Included

| Section | Description |
|---|---|
| **Dashboard** | Today's overview with progress bars and alerts |
| **Opening Checks** | 16 pre-service safety checks |
| **Temperature Log** | Log fridge, freezer & cooking temps with pass/fail |
| **Cleaning Schedule** | 22 daily cleaning tasks |
| **Closing Checks** | 16 end-of-service checks |
| **Weekly Review** | Manager compliance sign-off |
| **History** | View and filter all past records + CSV export |

---

## 🚀 Deploy to GitHub Pages (Free)

### Step 1 — Create GitHub repository

1. Go to [github.com](https://github.com) and sign in (or create a free account)
2. Click **New repository**
3. Name it: `safechecks` (or anything you like)
4. Set to **Public**
5. Click **Create repository**

### Step 2 — Upload the app files

**Option A — GitHub web interface (easiest):**
1. In your new repo, click **uploading an existing file**
2. Drag and drop ALL files and folders from this project:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `css/` folder
   - `js/` folder
   - `icons/` folder
3. Click **Commit changes**

**Option B — Git command line:**
```bash
git init
git add .
git commit -m "Initial SafeChecks deployment"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/safechecks.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. In your repo, go to **Settings** → **Pages**
2. Under "Source", select **Deploy from a branch**
3. Branch: **main** / folder: **/ (root)**
4. Click **Save**
5. After ~60 seconds, your app is live at:
   `https://YOURUSERNAME.github.io/safechecks/`

---

## 📊 Set Up Google Sheets

### Step 1 — Create the spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it: **SafeChecks Records**
4. Copy the spreadsheet URL (you'll need it later)

### Step 2 — Add the Apps Script

1. In the spreadsheet: **Extensions → Apps Script**
2. Delete all existing code
3. Open the file `google-apps-script.js` from this project
4. Copy and paste the entire contents
5. Click the **Save** icon (💾)
6. In the editor, run the `setupSheets` function once:
   - Select `setupSheets` from the function dropdown
   - Click **▶ Run**
   - Authorise when prompted
   - This creates all 5 tabs with headers automatically

### Step 3 — Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon ⚙ → **Web app**
3. Fill in:
   - Description: `SafeChecks v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Click **Authorize access** → sign in → **Allow**
6. **Copy the Web App URL** (starts with `https://script.google.com/macros/s/...`)

### Step 4 — Connect the app

1. Open your SafeChecks app
2. Click **Connect Sheets** in the header
3. Paste the **Web App URL** into the first field
4. Paste the **Spreadsheet URL** into the second field
5. Click **Save & Connect**
6. Done! All future records will sync to your spreadsheet instantly.

---

## 📱 Install as an App

### Android (Chrome)
1. Open the app URL in Chrome
2. Tap the **⋮ menu → Add to Home screen**
3. Tap **Add**
4. Opens full-screen like a native app

### iPhone/iPad (Safari)
1. Open the app URL in Safari
2. Tap the **Share button** (□↑)
3. Tap **Add to Home Screen**
4. Tap **Add**

### Desktop (Chrome/Edge)
1. Open the app URL
2. Click the install icon in the address bar
3. Click **Install**

---

## 📶 Offline Mode

The app works fully offline:
- All forms and checks work without internet
- Records are saved locally in the browser
- When internet returns, **queued records sync automatically**
- A status indicator in the header shows sync state

---

## 🔒 Data & Privacy

- All data is stored in **your own Google Sheet** — nobody else has access
- No data is sent to any third-party servers
- Local records are stored in browser localStorage as a backup
- To share access with staff, share the GitHub Pages URL
- To share the spreadsheet with a manager, share the Google Sheet normally

---

## 🛠 Customisation

To add/remove checklist items, edit `index.html`:
- Each checkbox has a `data-key` attribute — make these unique
- Match the field key in `js/sheets.js` under `FIELD_MAPS`
- Add the column header in `SHEET_HEADERS`

---

## 📁 File Structure

```
safechecks/
├── index.html              ← App shell + all sections
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service worker (offline support)
├── google-apps-script.js   ← Paste into Google Apps Script
├── css/
│   └── style.css           ← All styling
├── js/
│   ├── app.js              ← Core logic, forms, dashboard
│   ├── sheets.js           ← Google Sheets sync
│   └── history.js          ← History view + CSV export
└── icons/
    ├── icon-192.png
    └── icon-512.png
```
