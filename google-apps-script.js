/**
 * ═══════════════════════════════════════════════════════
 *  SAFECHECKS — Google Apps Script v5.5
 *
 *  CHANGES FROM v5:
 *  - doGet now converts Date cell values back to YYYY-MM-DD strings
 *    (Sheets auto-converts date strings to Date objects; this fixes
 *    the PWA receiving "Thu Feb 27 2026 00:00:00..." instead of
 *    "2026-02-27", which caused parseSheetRow to return null for
 *    every row — history showing 0 records)
 *  - setupSheets updated to match new compact checklist headers
 *    (with Fields JSON column for full round-trip reconstruction)
 *
 *  HOW TO UPDATE (you've already deployed v5):
 *  1. Open your Google Sheet
 *  2. Extensions → Apps Script
 *  3. Replace ALL code with this file → Save
 *  4. Run setupSheets() once — this recreates all tabs with
 *     correct headers (existing data will be cleared)
 *  5. Deploy → Manage deployments → Edit (pencil icon)
 *     → Version: New version → Deploy
 *     The URL stays the same — no reconnection needed.
 * ═══════════════════════════════════════════════════════
 */

const SETTINGS_TAB = 'Settings';

// ── POST: Receive and save a new record ──────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'saveSettings') return handleSaveSettings(data);

    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = data.sheetTab || 'General';
    let   sheet   = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      if (data.headers && data.headers.length > 0) {
        applyHeaders(sheet, data.headers);
      }
    }

    // Upsert action — for draft tick state (overwrites matching row by upsertKey)
    if (data.action === 'upsert' && data.upsertKey) {
      return handleUpsert(ss, data);
    }

    if (data.row && data.row.length > 0) {
      sheet.appendRow(data.row);

      // Status is at array index 6 for both Temperature Log and Food Probe Log
      // (ID=0, Date=1, Time=2, Department=3, Location/Product=4, Temp=5, Status=6)
      if (tabName === 'Temperature Log' || tabName === 'Food Probe Log') {
        colourStatusRow(sheet, data.row, 6);
      }
    }

    return jsonResponse({ status: 'ok', tab: tabName, rows: sheet.getLastRow() - 1 });

  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── GET: Return all rows from a tab ─────────────────────
function doGet(e) {
  try {
    const action  = e.parameter.action || 'read';
    const tabName = e.parameter.tab    || 'Opening Checks';
    const ss      = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'readSettings') return handleReadSettings();
    if (action === 'readDrafts')   return handleReadDrafts(ss);

    if (action === 'read') {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet || sheet.getLastRow() < 2) {
        return jsonResponse({ status: 'ok', tab: tabName, rows: [] });
      }

      const data    = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h).trim());
      const rows    = data.slice(1)
        .filter(row => row.some(cell => cell !== ''))
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => {
            let val = row[i];

            // KEY FIX: Sheets stores dates as Date objects.
            // Convert them back to YYYY-MM-DD strings so the PWA
            // can parse them reliably regardless of locale.
            if (val instanceof Date) {
              const y  = val.getFullYear();
              const m  = String(val.getMonth() + 1).padStart(2, '0');
              const d  = String(val.getDate()).padStart(2, '0');
              val = `${y}-${m}-${d}`;
            }

            obj[h] = String(val ?? '');
          });
          return obj;
        });

      return jsonResponse({ status: 'ok', tab: tabName, rows });
    }

    return jsonResponse({ status: 'ok', action });

  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Helpers ───────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function applyHeaders(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground('#0d1117');
  range.setFontColor('#22c55e');
  range.setFontFamily('Courier New');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  const dataRange = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), headers.length);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ISEVEN(ROW())')
    .setBackground('#161b22')
    .setRanges([dataRange])
    .build();
  sheet.setConditionalFormatRules([rule]);
}

function colourStatusRow(sheet, row, statusArrayIndex) {
  const lastRow  = sheet.getLastRow();
  const rowRange = sheet.getRange(lastRow, 1, 1, row.length);
  const status   = String(row[statusArrayIndex] || '').toUpperCase();
  if      (status === 'FAIL')    rowRange.setBackground('#3d0000');
  else if (status === 'WARNING') rowRange.setBackground('#3d2800');
}

// ── One-time setup ────────────────────────────────────────
// Select setupSheets in the dropdown and click Run.
// This clears and recreates all tabs with correct v5.1 headers.
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const configs = [
    {
      // Compact schema: full check data stored in Fields JSON column
      name: 'Opening Checks',
      headers: ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
    },
    {
      name: 'Closing Checks',
      headers: ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
    },
    {
      name: 'Cleaning Schedule',
      headers: ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
    },
    {
      name: 'Weekly Review',
      headers: ['ID','Date','Time','Department','Summary','Issues','Actions','Rating','Signed By','Fields JSON'],
    },
    {
      // Temperature: named columns for easy reading in Sheets + Fields JSON
      name: 'Temperature Log',
      headers: [
        'ID','Date','Time','Department',
        'Location','Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
        'Fields JSON',
      ],
    },
    {
      name: 'Food Probe Log',
      headers: [
        'ID','Date','Time','Department',
        'Product / Dish','Core Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
        'Fields JSON',
      ],
    },
    {
      name: 'Task Completions',
      headers: ['ID','Date','Time','Department','Task ID','Week Start','Completed By'],
    },
  ];

  configs.forEach(config => {
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) sheet = ss.insertSheet(config.name);
    else sheet.clearContents();
    applyHeaders(sheet, config.headers);
  });

  // Settings tab
  let settingsSheet = ss.getSheetByName(SETTINGS_TAB);
  if (!settingsSheet) settingsSheet = ss.insertSheet(SETTINGS_TAB);
  else settingsSheet.clearContents();
  const sr = settingsSheet.getRange(1, 1, 1, 2);
  sr.setValues([['key','value']]);
  sr.setFontWeight('bold').setBackground('#0d1117').setFontColor('#22c55e');

  // Remove default blank sheet if still present
  try {
    const def = ss.getSheetByName('Sheet1');
    if (def && ss.getNumSheets() > 1) ss.deleteSheet(def);
  } catch(e) {}

  SpreadsheetApp.getUi().alert(
    '✅ SafeChecks v5.1 — All sheets recreated!\n\n' +
    'Tabs: Opening Checks, Closing Checks, Temperature Log,\n' +
    'Food Probe Log, Cleaning Schedule, Weekly Review,\n' +
    'Task Completions, Settings\n\n' +
    'Now: Deploy → Manage deployments → Edit → New version → Deploy'
  );
}

// ── Drafts: upsert ───────────────────────────────────────
// Stores one row per upsertKey, overwriting if already exists.
// Used for checklist draft tick state — one row per type+dept+date.
function handleUpsert(ss, data) {
  let sheet = ss.getSheetByName('Drafts');
  if (!sheet) {
    sheet = ss.insertSheet('Drafts');
    const hdr = sheet.getRange(1, 1, 1, 3);
    hdr.setValues([['upsertKey', 'date', 'data']]);
    hdr.setFontWeight('bold').setBackground('#0d1117').setFontColor('#22c55e');
    sheet.setFrozenRows(1);
  }

  const key     = String(data.upsertKey);
  const dateStr = String(data.data?.date || '');
  const payload = JSON.stringify(data.data || {});

  // Search for existing row with matching key
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) {
        // Overwrite existing row
        sheet.getRange(i + 2, 1, 1, 3).setValues([[key, dateStr, payload]]);
        return jsonResponse({ status: 'ok', action: 'upsert', updated: true });
      }
    }
  }

  // No existing row — append
  sheet.appendRow([key, dateStr, payload]);
  return jsonResponse({ status: 'ok', action: 'upsert', updated: false });
}

// ── Drafts: read all today's drafts ──────────────────────
function handleReadDrafts(ss) {
  const sheet = ss.getSheetByName('Drafts');
  if (!sheet || sheet.getLastRow() < 2) {
    return jsonResponse({ status: 'ok', drafts: [] });
  }

  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const data = sheet.getDataRange().getValues();
  const drafts = [];

  for (let i = 1; i < data.length; i++) {
    const rowDate = String(data[i][1]);
    if (rowDate !== todayStr) continue;   // only return today's drafts
    try {
      const parsed = JSON.parse(String(data[i][2]));
      if (parsed && parsed.type && parsed.dept && parsed.draft) {
        drafts.push(parsed);
      }
    } catch(e) {}
  }

  return jsonResponse({ status: 'ok', drafts });
}

// ── Settings: save ────────────────────────────────────────
function handleSaveSettings(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SETTINGS_TAB);
  if   (!sheet) sheet = ss.insertSheet(SETTINGS_TAB);
  sheet.clearContents();

  const settingsJson = JSON.stringify(data.settings || {});
  sheet.getRange(1,1,1,2).setValues([['key','value']]);
  sheet.getRange(2,1,1,2).setValues([['settings', settingsJson]]);
  sheet.getRange(1,1,1,2).setFontWeight('bold').setBackground('#0d1117').setFontColor('#22c55e');

  return jsonResponse({ status: 'ok', action: 'saveSettings' });
}

// ── Settings: read ────────────────────────────────────────
function handleReadSettings() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SETTINGS_TAB);
  if (!sheet || sheet.getLastRow() < 2) {
    return jsonResponse({ status: 'ok', settings: null });
  }
  try {
    const val      = sheet.getRange(2, 2).getValue();
    const settings = JSON.parse(val);
    return jsonResponse({ status: 'ok', settings });
  } catch(e) {
    return jsonResponse({ status: 'error', message: e.toString() });
  }
}
