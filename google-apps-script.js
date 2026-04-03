/**
 * ═══════════════════════════════════════════════════════
 *  SAFECHECKS — Google Apps Script v5.4
 *
 *  CHANGES FROM v5.3:
 *  - setupSheets: added missing 'Cooling Time' column to Food Probe Log
 *  - setupSheets: added missing 'Action' column (col H) to Task Completions
 *  - getTodayTasks: reads Action column — untick records no longer counted
 *    as done in nightly and on-demand emails
 *  - buildEmailHtml: fixed daily Goods In section — bare <tr> was outside
 *    any <table>, producing invalid HTML and broken email rendering
 *
 *  CHANGES FROM v5.2:
 *  - Added Goods In Log tab to setupSheets
 *  - getTodayRecords now handles Goods In Log tab correctly
 *  - setupSheets alert updated
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
 *  HOW TO UPDATE (you've already deployed v5.2):
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

    if (data.action === 'saveSettings')   return handleSaveSettings(data);
    if (data.action === 'wipeAllData')      return handleWipeAllData();
    if (data.action === 'sendDailyEmail')   return handleSendDailyEmail(data);
    if (data.action === 'sendWeeklyEmail')  return handleSendWeeklyEmail(data);

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

    if (action === 'readSettings')  return handleReadSettings();
    if (action === 'readDrafts')    return handleReadDrafts(ss);
    if (action === 'sendDailyEmail')  return handleSendDailyEmailGet(e, ss);
    if (action === 'sendWeeklyEmail') return handleSendWeeklyEmailGet(e, ss);

    if (action === 'read') {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet || sheet.getLastRow() < 2) {
        return jsonResponse({ status: 'ok', tab: tabName, rows: [] });
      }

      // Optional date range filter — from/to are YYYY-MM-DD strings.
      // Applied to the Date column (column index 1 in all tabs).
      // Used by the PWA to implement the local retention window:
      //   - Normal pulls pass ?from=CUTOFF to stay within the 60-day window
      //   - History "Load older" requests pass an explicit from+to range
      const filterFrom = e.parameter.from || null;   // YYYY-MM-DD or null
      const filterTo   = e.parameter.to   || null;   // YYYY-MM-DD or null

      const data    = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h).trim());
      const dateIdx = headers.indexOf('Date');       // column index for date filtering

      const rows = data.slice(1)
        .filter(row => row.some(cell => cell !== ''))
        .filter(row => {
          // If no date filter requested, return all rows
          if (!filterFrom && !filterTo) return true;
          if (dateIdx < 0) return true;   // no Date column found — include row

          // Normalise the cell value to YYYY-MM-DD for comparison
          let val = row[dateIdx];
          let dateStr;
          if (val instanceof Date) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
          } else {
            dateStr = String(val ?? '').trim();
            // Handle DD/MM/YYYY
            const gbMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (gbMatch) {
              dateStr = `${gbMatch[3]}-${gbMatch[2].padStart(2,'0')}-${gbMatch[1].padStart(2,'0')}`;
            }
          }
          if (!dateStr) return true;    // unparseable — include to avoid silent data loss
          if (filterFrom && dateStr < filterFrom) return false;
          if (filterTo   && dateStr > filterTo)   return false;
          return true;
        })
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => {
            let val = row[i];
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
        'Product / Dish','Core Temperature (°C)','Status','Probe Used','Corrective Action','Cooling Time','Logged By',
        'Fields JSON',
      ],
    },
    {
      name: 'Task Completions',
      headers: ['ID','Date','Time','Department','Task ID','Week Start','Completed By','Action'],
    },
    {
      name: 'Goods In Log',
      headers: [
        'ID','Date','Time','Department',
        'Supplier','Type','Temperature (°C)','Temp Status',
        'Expiry Checked','Outcome','Notes','Signed By',
        'Fields JSON',
      ],
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
    '&#x2705; SafeChecks v5.4 — All sheets recreated!\n\n' +
    'Tabs: Opening Checks, Closing Checks, Temperature Log,\n' +
    'Food Probe Log (incl. Cooling Time), Cleaning Schedule,\n' +
    'Weekly Review, Task Completions (incl. Action),\n' +
    'Goods In Log, Settings\n\n' +
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
    // Sheets auto-converts date strings to Date objects — normalise back
    let rawDate = data[i][1];
    if (rawDate instanceof Date) {
      const ry = rawDate.getFullYear();
      const rm = String(rawDate.getMonth() + 1).padStart(2, '0');
      const rd = String(rawDate.getDate()).padStart(2, '0');
      rawDate = `${ry}-${rm}-${rd}`;
    }
    const rowDate = String(rawDate);
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
// ── Wipe all data ─────────────────────────────────────────────────────────
function handleWipeAllData() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dataTabs = [
      'Opening Checks', 'Closing Checks', 'Cleaning Schedule',
      'Weekly Review', 'Temperature Log', 'Food Probe Log',
      'Task Completions', 'Goods In Log', 'Drafts'
    ];
    dataTabs.forEach(function(tabName) {
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
    });
    return jsonResponse({ status: 'ok', wiped: dataTabs });
  } catch(e) {
    return jsonResponse({ status: 'error', message: e.toString() });
  }
}

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

// ════════════════════════════════════════════════════════
//  DAILY EMAIL SUMMARY
//  Sends an HTML summary at 23:59 every night.
//
//  SETUP:
//  1. Paste this updated file into Apps Script → Save
//  2. Run installDailyEmailTrigger() ONCE from the editor
//  3. To stop: run removeDailyEmailTrigger()
// ════════════════════════════════════════════════════════

// ── Trigger management ────────────────────────────────
function installDailyEmailTrigger() {
  // Remove any existing trigger first to avoid duplicates
  removeDailyEmailTrigger();
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .atHour(23)
    .nearMinute(59)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert('&#x2705; Daily email trigger installed — will fire at 23:59 every night.');
}

function removeDailyEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailySummary') ScriptApp.deleteTrigger(t);
  });
}

// ── Trading calendar check (Apps Script side) ───────────
function isTradingAS(dept, settings, date) {
  if (dept === 'mgmt') return true;
  const td = settings.tradingDays;
  if (!td) return true;
  // Master switch
  if (td.open === false) return false;
  // Per-day dept schedule — use provided date or today
  const dayNames = ['sun','mon','tue','wed','thu','fri','sat'];
  const d = date ? new Date(date + 'T12:00:00') : new Date();
  const day = dayNames[d.getDay()];
  if (td[dept] && td[dept][day] === false) return false;
  return true;
}

// ── Main send function ────────────────────────────────
function sendDailySummary() {
  const settings = getSettingsObj();
  if (!settings) { Logger.log('sendDailySummary: no settings found'); return; }
  if (!settings.emailEnabled) { Logger.log('sendDailySummary: email disabled in settings'); return; }

  const recipients = settings.emailRecipients || [];
  if (!recipients.length) { Logger.log('sendDailySummary: no recipients configured'); return; }

  const today    = getDateStr(new Date());
  const dayLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE d MMMM yyyy");
  const name     = settings.restaurantName || 'SafeChecks';

  // ── Pull all records for today ──────────────────────
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const opening    = getTodayRecords(ss, 'Opening Checks',  today);
  const closing    = getTodayRecords(ss, 'Closing Checks',  today);
  const temps      = getTodayRecords(ss, 'Temperature Log', today);
  const probes     = getTodayRecords(ss, 'Food Probe Log',  today);
  const goodsIn    = getTodayRecords(ss, 'Goods In Log',   today);
  const cleaning   = settings.cleaningEnabled ? getTodayRecords(ss, 'Cleaning Schedule', today) : [];
  const tasks      = getTodayTasks(ss, today, settings);

  // ── Determine subject prefix ────────────────────────
  const depts = ['kitchen', 'foh'];
  const hasAnyMissing = depts.some(d => {
    if (!isTradingAS(d, settings)) return false;  // closed — not missing
    const noOpen  = !opening.find(r => r.dept === d);
    const noClose = !closing.find(r => r.dept === d);
    return noOpen || noClose;
  });
  const hasAnyFail = [...temps, ...probes].some(r =>
    r.status === 'FAIL' || r.status === 'WARNING');
  const hasCheckFail = [...opening, ...closing].some(r => r.failCount > 0);

  const prefix = hasAnyMissing ? '⛔' : (hasAnyFail || hasCheckFail) ? '⚠' : '✓';
  const subject = prefix + ' Daily Summary — ' + name + ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE d MMM yyyy");

  // ── Build HTML ──────────────────────────────────────
  const html = buildEmailHtml(name, dayLabel, today, opening, closing, temps, probes, goodsIn, cleaning, tasks, depts, settings);

  // ── Send ────────────────────────────────────────────
  recipients.forEach(addr => {
    try {
      GmailApp.sendEmail(addr, subject, '', { htmlBody: html, name: name + ' · SafeChecks' });
      Logger.log('Email sent to ' + addr);
    } catch(e) {
      Logger.log('Failed to send to ' + addr + ': ' + e.toString());
    }
  });
}

// ── HTML builder ──────────────────────────────────────
function buildEmailHtml(name, dayLabel, today, opening, closing, temps, probes, goodsIn, cleaning, tasks, depts, settings) {
  const DEPT_LABELS = { kitchen: '&#x1F373; Kitchen', foh: '&#x1F37D; Front of House' };

  // Compliance scoring
  const tradingDepts       = depts.filter(d => isTradingAS(d, settings));
  const expectedCheckCount = tradingDepts.length * 2;
  const submittedChecks    = tradingDepts.reduce((n, d) => {
    return n + (opening.find(r => r.dept === d) ? 1 : 0) + (closing.find(r => r.dept === d) ? 1 : 0);
  }, 0);
  const anyMissing = submittedChecks < expectedCheckCount;
  const pct        = expectedCheckCount > 0 ? Math.round(submittedChecks / expectedCheckCount * 100) : null;

  const badgeColor = anyMissing ? '#dc2626' : pct === null ? '#64748b' : pct >= 90 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626';
  const badgeBg    = anyMissing ? '#fef2f2' : pct === null ? '#f8fafc' : pct >= 90 ? '#f0fdf4' : pct >= 70 ? '#fffbeb' : '#fef2f2';
  const badgeBorder= badgeColor;
  const barColor   = badgeColor;
  const barWidth   = pct !== null ? pct : 0;

  const badgeHtml = anyMissing
    ? '<div style="display:inline-block;background:' + badgeBg + ';border:2px solid ' + badgeBorder + ';border-radius:10px;padding:10px 18px;text-align:center"><p style="margin:0;font-size:14px;font-weight:700;color:' + badgeColor + ';font-family:Arial,sans-serif">Incomplete</p></div>'
    : pct !== null
      ? '<div style="display:inline-block;background:' + badgeBg + ';border:2px solid ' + badgeBorder + ';border-radius:10px;padding:10px 18px;text-align:center"><p style="margin:0;font-size:24px;font-weight:700;color:' + badgeColor + ';font-family:Arial,sans-serif;line-height:1">' + pct + '%</p><p style="margin:3px 0 0;font-size:10px;color:' + badgeColor + ';font-family:Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase">Compliance</p></div>'
      : '<div style="display:inline-block;background:#f8fafc;border:2px solid #cbd5e1;border-radius:10px;padding:10px 18px;text-align:center"><p style="margin:0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif">No checks<br>recorded</p></div>';

  // ── Dot helper ───────────────────────────────────────
  function dot(color) {
    return '<span style="font-size:9px;color:' + color + '">&#x25CF;</span>';
  }
  function dotText(color, text) {
    return dot(color) + ' <span style="font-size:12px;font-weight:600;color:' + color + ';font-family:Arial,sans-serif">' + text + '</span>';
  }

  // ── Overview rows ────────────────────────────────────
  const overviewRows = depts.map(function(d) {
    const trading  = isTradingAS(d, settings);
    const op       = opening.find(r => r.dept === d);
    const cl       = closing.find(r => r.dept === d);
    const missing  = trading && (!op || !cl);
    const deptFail = (op && op.failCount > 0) || (cl && cl.failCount > 0);
    const tempFail = temps.filter(r => r.dept === d).some(r => r.status === 'FAIL' || r.status === 'WARNING');
    var deptExp = 2, deptAct = (op ? 1 : 0) + (cl ? 1 : 0);
    var deptPct = Math.round(deptAct / deptExp * 100);

    var status;
    if (!trading)               { status = dotText('#94a3b8', 'Closed today'); }
    else if (!op && !cl)        { status = dotText('#dc2626', 'Opening &amp; Closing missing'); }
    else if (!op)               { status = dotText('#dc2626', 'Opening missing'); }
    else if (!cl)               { status = dotText('#dc2626', 'Closing missing'); }
    else if (deptFail||tempFail){ status = dotText('#d97706', deptPct + '% submitted &middot; issues recorded'); }
    else                        { status = dotText('#16a34a', 'All clear &middot; ' + deptPct + '%'); }

    return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;font-size:13px;color:#1e293b;font-family:Arial,sans-serif"><strong>' + DEPT_LABELS[d] + '</strong></td>' +
      '<td style="text-align:right;padding:10px 0;white-space:nowrap">' + status + '</td></tr>';
  }).join('');

  // Cleaning overview row
  var cleaningOverviewRow = '';
  if (settings.cleaningEnabled) {
    var cleanCount = cleaning.length;
    var cleanFail  = cleaning.some(function(r) { return Object.entries(r.fields||{}).some(function(e) { return e[1] === 'No'; }); });
    var cStatus;
    if (!cleanCount)    { cStatus = dotText('#94a3b8', 'Not recorded'); }
    else if (cleanFail) { cStatus = dotText('#d97706', 'Issues recorded'); }
    else                { cStatus = dotText('#16a34a', 'All clear'); }
    cleaningOverviewRow = '<tr><td style="padding:10px 0;font-size:13px;color:#1e293b;font-family:Arial,sans-serif"><strong>&#x1F9F9; Cleaning Schedule</strong></td>' +
      '<td style="text-align:right;padding:10px 0;white-space:nowrap">' + cStatus + '</td></tr>';
  }

  // ── Check section builder ─────────────────────────────
  function buildCheckSection(title, records) {
    const rows = depts.map(function(d) {
      const rec = records.find(r => r.dept === d);
      if (!rec) {
        if (!isTradingAS(d, settings)) {
          return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + DEPT_LABELS[d] + '</td>' +
            '<td style="text-align:right;padding:10px 0;white-space:nowrap">' + dotText('#94a3b8', 'Closed') + '</td></tr>';
        }
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + DEPT_LABELS[d] + '</td>' +
          '<td style="text-align:right;padding:10px 0;white-space:nowrap">' + dotText('#dc2626', 'Not submitted') + '</td></tr>';
      }
      var failHtml = '';
      if (rec.failCount > 0 && rec.failedLabels.length) {
        var labelMap = {};
        if (settings && settings.checks) { Object.values(settings.checks).forEach(function(dept) { if (dept && typeof dept === 'object') { Object.values(dept).forEach(function(arr) { if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) labelMap[c.id] = c.label; }); }); } }); }
        if (settings && settings.sharedChecks) { Object.values(settings.sharedChecks).forEach(function(arr) { if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) labelMap[c.id] = c.label; }); }); }
        const items = rec.failedLabels.map(function(l) {
          var lbl = labelMap[l] || l.replace(/_/g,' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
          return '<p style="margin:0 0 3px;font-size:12px;font-weight:600;color:#d97706;font-family:Arial,sans-serif">&#x2717; &nbsp;' + lbl + '</p>';
        }).join('');
        const noteHtml = rec.notes ? '<p style="margin:5px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">Note: ' + rec.notes + '</p>' : '';
        failHtml = '<div style="margin-top:6px">' + items + noteHtml + '</div>';
      }
      var statusHtml = rec.failCount > 0
        ? dotText('#d97706', rec.failCount + ' fail' + (rec.failCount !== 1 ? 's' : ''))
        : dotText('#16a34a', 'Submitted');
      return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 0;font-size:13px;color:#334155;font-family:Arial,sans-serif;vertical-align:top">' +
        DEPT_LABELS[d] + ' &nbsp;<span style="font-size:11px;color:#94a3b8">' + rec.signedBy + ' &middot; ' + fmtTime(rec.time) + '</span>' + failHtml + '</td>' +
        '<td style="padding:10px 0;text-align:right;vertical-align:top;white-space:nowrap">' + statusHtml + '</td></tr>';
    }).join('');
    return sectionBlock(title, '<table width="100%" cellpadding="0" cellspacing="0">' + rows + '</table>');
  }

  // ── Temperature section ──────────────────────────────
  const tempCount = temps.length;
  const tempRows  = tempCount === 0
    ? '<tr><td colspan="4" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No temperature readings recorded today</td></tr>'
    : temps.map(function(r) {
        var dotColor = r.status === 'OK' ? '#16a34a' : r.status === 'WARNING' ? '#d97706' : '#dc2626';
        var actionHtml = r.action && r.action !== 'None required'
          ? '<p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">Action: ' + r.action + '</p>' : '';
        return '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:9px 8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
          '<td style="padding:9px 8px;font-size:13px;font-weight:600;color:#334155;font-family:monospace">' + (r.temp ? r.temp + '&deg;C' : '&mdash;') + '</td>' +
          '<td style="padding:9px 8px">' + dot(dotColor) + ' <span style="font-size:12px;font-weight:600;color:' + dotColor + ';font-family:Arial,sans-serif">' + r.status + '</span>' + actionHtml + '</td>' +
          '<td style="padding:9px 8px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + fmtTime(r.time) + '</td></tr>';
      }).join('');

  const tempSection = sectionBlock(
    'Equipment Temperatures &nbsp;<span style="font-weight:400;color:#94a3b8">' + tempCount + ' reading' + (tempCount !== 1 ? 's' : '') + '</span>',
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Location</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Status / Action</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Time</td></tr>' +
    tempRows + '</table>'
  );

  // ── Probe section ────────────────────────────────────
  const probeCount = probes.length;
  const probeRows  = probeCount === 0
    ? '<tr><td colspan="2" style="padding:10px 0">' + dotText('#dc2626', 'No food probes recorded today') + '</td></tr>'
    : probes.map(function(r) {
        var pass = r.status === 'PASS';
        var dotColor = pass ? '#16a34a' : '#dc2626';
        var actionHtml = !pass && r.action && r.action !== 'None required'
          ? '<p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">Action: ' + r.action + '</p>' : '';
        var coolingHtml = r.cooling ? '<p style="margin:3px 0 0;font-size:11px;color:#60a5fa;font-family:Arial,sans-serif">&#x2744; Cooled for ' + r.cooling + '</p>' : '';
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:9px 0;font-size:13px;color:#334155;font-family:Arial,sans-serif;vertical-align:top">' +
          r.product + coolingHtml + actionHtml + '</td>' +
          '<td style="text-align:right;vertical-align:top;padding:9px 0;font-size:13px;font-family:Arial,sans-serif;white-space:nowrap">' +
          '<strong style="color:#334155;margin-right:10px">' + r.temp + '&deg;C</strong>' +
          dot(dotColor) + ' <span style="font-size:12px;font-weight:600;color:' + dotColor + ';font-family:Arial,sans-serif">' + r.status + '</span>' +
          ' <span style="color:#94a3b8;margin-left:8px;font-size:12px">' + r.staff + '</span></td></tr>';
      }).join('');

  const probeSection = sectionBlock(
    'Food Probes &nbsp;<span style="font-weight:400;color:#94a3b8">' + (probeCount > 0 ? probeCount + ' reading' + (probeCount !== 1 ? 's' : '') : '') + '</span>',
    '<table width="100%" cellpadding="0" cellspacing="0">' + probeRows + '</table>'
  );

  // ── Goods In section ─────────────────────────────────
  var giRows = '';
  if (!goodsIn.length) {
    giRows = '<tr><td colspan="5" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No deliveries recorded today</td></tr>';
  } else {
    goodsIn.forEach(function(r) {
      var f       = r.fields || {};
      var isAcc   = f.gi_outcome === 'accepted';
      var isAmb   = f.gi_type === 'ambient';
      var typeIcon = f.gi_type === 'frozen' ? '&#x2744;' : isAmb ? '&#x1F4E6;' : '&#x1F33F;';
      var tempColor = isAmb ? '#94a3b8' : f.gi_temp_status === 'FAIL' ? '#dc2626' : f.gi_temp_status === 'WARNING' ? '#d97706' : '#16a34a';
      var outColor  = isAcc ? '#16a34a' : '#dc2626';
      giRows += '<tr style="border-bottom:1px solid #f1f5f9">' +
        '<td style="padding:9px 8px;font-size:13px;font-weight:600;font-family:Arial,sans-serif;color:#1e293b">' + (f.gi_supplier||'&mdash;') + '</td>' +
        '<td style="padding:9px 8px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + typeIcon + ' ' + (f.gi_type||'') + '</td>' +
        '<td style="padding:9px 8px;font-size:13px;font-family:monospace;font-weight:600;color:' + tempColor + '">' + (f.gi_temp ? f.gi_temp + '&deg;C' : '&mdash;') + '</td>' +
        '<td style="padding:9px 8px;font-size:12px;font-weight:700;color:' + outColor + ';font-family:Arial,sans-serif">' + (isAcc ? 'Accepted' : 'Rejected') + '</td>' +
        '<td style="padding:9px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif">' + (f.gi_signed_by||'&mdash;') + '</td></tr>';
      if (f.gi_notes) {
        giRows += '<tr><td colspan="5" style="padding:0 8px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">&#x21B3; ' + f.gi_notes + '</td></tr>';
      }
    });
  }
  const giSection = sectionBlock(
    '&#x1F4E6; Goods In',
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Supplier</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Type</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Outcome</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Signed By</td></tr>' +
    giRows + '</table>'
  );

  // ── Tasks section ─────────────────────────────────────
  const doneCount = tasks.filter(t => t.done).length;
  const taskRows  = tasks.length === 0
    ? '<tr><td colspan="2" style="padding:9px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No tasks scheduled today</td></tr>'
    : tasks.map(function(r) {
        if (r.done) {
          return '<tr style="border-bottom:1px solid #f1f5f9">' +
            '<td style="padding:9px 0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' +
            '<span style="color:#16a34a;font-weight:700">&#x2713;</span> ' + r.label + '</td>' +
            '<td style="text-align:right;padding:9px 0;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif;white-space:nowrap">' + r.doneBy + '</td></tr>';
        }
        return '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:9px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + r.label + '</td>' +
          '<td style="text-align:right;padding:9px 0;white-space:nowrap">' + dotText('#94a3b8', 'Not done') + '</td></tr>';
      }).join('');

  const taskSection = sectionBlock(
    'Tasks &nbsp;<span style="font-weight:400;color:#94a3b8">' + doneCount + ' / ' + tasks.length + ' complete</span>',
    '<table width="100%" cellpadding="0" cellspacing="0">' + taskRows + '</table>'
  );

  // ── Assemble ──────────────────────────────────────────
  const sheetsUrl = getSheetsUrl();
  const divider   = '<div style="height:1px;background:#e2e8f0"></div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<style>@media print{body{background:#fff!important}}</style>' +
    '</head><body style="margin:0;padding:24px 16px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:600px;margin:0 auto">' +

    // Header
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px 12px 0 0;border:1px solid #e2e8f0;border-bottom:none">' +
    '<tr><td style="padding:28px 28px 20px">' +
    '<p style="margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Food Safety Report</p>' +
    '<p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#0f172a;font-family:Arial,sans-serif">' + name + '</p>' +
    '<p style="margin:4px 0 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif">' + dayLabel + ' &nbsp;&middot;&nbsp; Generated 23:59</p></td>' +
    '<td style="padding:28px 28px 20px;text-align:right;vertical-align:middle">' + badgeHtml + '</td></tr>' +
    (pct !== null ? '<tr><td colspan="2" style="padding:0 28px 24px"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="background:#f1f5f9;border-radius:4px;height:4px"><div style="width:' + barWidth + '%;height:4px;background:' + barColor + ';border-radius:4px"></div></td>' +
    '<td style="width:110px;padding-left:12px;font-size:11px;color:' + barColor + ';font-family:Arial,sans-serif;white-space:nowrap">' + submittedChecks + '/' + expectedCheckCount + ' submitted</td>' +
    '</tr></table></td></tr>' : '') +
    '</table>' + divider +

    // Overview
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">' +
    sectionHeader('Overview') +
    '<tr><td style="padding:0 28px 20px"><table width="100%" cellpadding="0" cellspacing="0">' + overviewRows + cleaningOverviewRow + '</table></td></tr></table>' + divider +

    // Check sections
    buildCheckSection('Opening Checks', opening) + divider +
    buildCheckSection('Closing Checks', closing) + divider +
    (settings.cleaningEnabled && cleaning.length ? buildCheckSection('&#x1F9F9; Cleaning Schedule', cleaning) + divider : '') +

    // Data sections
    tempSection + divider + probeSection + divider + giSection + divider + taskSection + divider +

    // Footer
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none">' +
    '<tr><td style="padding:20px 28px">' +
    (sheetsUrl ? '<p style="margin:0;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">Full records &nbsp;&middot;&nbsp; <a href="' + sheetsUrl + '" style="color:#3b82f6;text-decoration:none">Open in Google Sheets</a></p>' : '') +
    '<p style="margin:6px 0 0;font-size:11px;color:#cbd5e1;font-family:Arial,sans-serif">Sent by SafeChecks &nbsp;&middot;&nbsp; To manage recipients, open Settings in the app</p>' +
    '</td></tr></table>' +

    '</div></body></html>';
}

// ── Section block helper ──────────────────────────────
function sectionBlock(title, innerHtml) {
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">' +
    sectionHeader(title) +
    '<tr><td style="padding:0 28px 20px">' + innerHtml + '</td></tr></table>';
}

// ── Section header helper ─────────────────────────────
function sectionHeader(title) {
  return '<tr><td style="padding:20px 28px 8px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;font-family:Arial,sans-serif">' + title + '</p></td></tr>';
}


// ── Data helpers ──────────────────────────────────────
// ── Format time for display — extracts HH:MM from any timestamp string ──
function fmtTime(t) {
  if (!t) return '';
  // Already HH:MM or HH:MM:SS
  var m = String(t).match(/(\d{2}:\d{2})(?::\d{2})?/);
  if (m) return m[1];
  // JS Date string: "Tue Mar 03 2026 09:40:25 GMT+0000..."
  var d = new Date(t);
  if (!isNaN(d)) {
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  return String(t);
}

function getDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function getSheetsUrl() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch(e) { return null; }
}

function getSettingsObj() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SETTINGS_TAB);
    if (!sheet || sheet.getLastRow() < 2) return null;
    return JSON.parse(sheet.getRange(2,2).getValue());
  } catch(e) { Logger.log('getSettingsObj error: ' + e); return null; }
}

function getTodayRecords(ss, tabName, today) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const getCol  = name => headers.indexOf(name);

  const dateCol   = getCol('Date');
  const deptCol   = getCol('Department');
  const timeCol   = getCol('Time');
  const signedCol = getCol('Signed By');
  const fieldsCol = getCol('Fields JSON');
  const notesCol  = getCol('Notes');

  // Temperature / Probe tabs have different column names
  const locCol    = getCol('Location');
  const prodCol   = getCol('Product / Dish');
  const tempCol   = getCol('Temperature (°C)') >= 0 ? getCol('Temperature (°C)') : getCol('Core Temperature (°C)');
  const statusCol = getCol('Status');
  const actionCol = getCol('Corrective Action');
  const staffCol  = getCol('Logged By');

  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row  = data[i];
    let   date = row[dateCol];
    if (date instanceof Date) date = getDateStr(date);
    if (String(date) !== today) continue;

    if (tabName === 'Temperature Log') {
      let batchId = '';
      if (fieldsCol >= 0) {
        try { batchId = (JSON.parse(String(row[fieldsCol] || '{}')) || {}).batch_id || ''; } catch(e) {}
      }
      results.push({
        dept:     String(row[deptCol] || '').toLowerCase(),
        location: String(row[locCol]  || ''),
        temp:     String(row[tempCol] || ''),
        status:   String(row[statusCol] || ''),
        action:   String(row[actionCol] || ''),
        time:     String(row[timeCol]   || ''),
        batch_id: batchId,
      });
    } else if (tabName === 'Food Probe Log') {
      const coolingCol = headers.indexOf('Cooling Time');
      results.push({
        product: String(row[prodCol]                          || ''),
        temp:    String(row[tempCol]                          || ''),
        status:  String(row[statusCol]                        || ''),
        action:  String(row[actionCol]                        || ''),
        cooling: String(coolingCol >= 0 ? (row[coolingCol] || '') : ''),
        staff:   String(row[staffCol]                         || ''),
        time:    String(row[timeCol]                          || ''),
      });
    } else if (tabName === 'Goods In Log') {
      // Goods In — parse Fields JSON
      let fields = {};
      try { fields = JSON.parse(String(row[fieldsCol] || '{}')); } catch(e) {}
      // Fall back to named columns if no Fields JSON
      if (!Object.keys(fields).length) {
        const supCol   = headers.indexOf('Supplier');
        const typeCol  = headers.indexOf('Type');
        const tmpCol   = headers.indexOf('Temperature (°C)');
        const stCol    = headers.indexOf('Temp Status');
        const expCol   = headers.indexOf('Expiry Checked');
        const outCol   = headers.indexOf('Outcome');
        const notCol   = headers.indexOf('Notes');
        const sgnCol   = headers.indexOf('Signed By');
        fields = {
          gi_supplier:      String(row[supCol]  || ''),
          gi_type:          String(row[typeCol] || ''),
          gi_temp:          String(row[tmpCol]  || ''),
          gi_temp_status:   String(row[stCol]   || ''),
          gi_expiry_checked:String(row[expCol]  || ''),
          gi_outcome:       String(row[outCol]  || ''),
          gi_notes:         String(row[notCol]  || ''),
          gi_signed_by:     String(row[sgnCol]  || ''),
        };
      }
      results.push({
        dept:   String(row[deptCol] || '').toLowerCase(),
        time:   String(row[timeCol] || ''),
        fields,
      });

    } else {
      // Opening / Closing Checks — parse Fields JSON for individual items
      let fields = {};
      try { fields = JSON.parse(String(row[fieldsCol] || '{}')); } catch(e) {}

      const checkEntries = Object.entries(fields).filter(([,v]) => v === 'Yes' || v === 'No');
      const passed = checkEntries.filter(([,v]) => v === 'Yes').length;
      const total  = checkEntries.length;
      const failed = checkEntries.filter(([,v]) => v === 'No').map(([k]) => k);

      results.push({
        dept:        String(row[deptCol]   || '').toLowerCase(),
        time:        String(row[timeCol]   || ''),
        signedBy:    String(row[signedCol] || ''),
        notes:       String(row[notesCol]  || ''),
        passed, total,
        failCount:   total - passed,
        failedLabels: failed,
        fields,
      });
    }
  }
  return results;
}

// ── Task frequency helpers (mirrors tasks.js) ─────────────────────────────
// Returns which week-of-month (1–4) a given Monday-based weekStart falls in.
// Week 1 = the week containing the 1st of the month.
// If the month has a 5th week it wraps back to week 1.
function getWeekOfMonth(weekStartStr) {
  const mon = new Date(weekStartStr + 'T12:00:00');
  const firstOfMonth = new Date(mon.getFullYear(), mon.getMonth(), 1);
  const dow = firstOfMonth.getDay(); // 0=Sun,1=Mon...
  const firstMonday = new Date(firstOfMonth);
  firstMonday.setDate(firstOfMonth.getDate() + (dow === 0 ? -6 : 1 - dow));
  const diff = Math.round((mon - firstMonday) / (7 * 24 * 60 * 60 * 1000));
  return (diff % 4) + 1; // 1–4, wraps at 4
}

function taskMatchesFrequencyAS(task, weekStartStr) {
  const freq = task.frequency || 'every';
  if (freq === 'every') return true;
  const w = getWeekOfMonth(weekStartStr);
  if (freq === 'first') return w === 1;
  if (freq === 'last') {
    // Last week = week where next Monday is in a different month
    const mon  = new Date(weekStartStr + 'T12:00:00');
    const next = new Date(mon); next.setDate(mon.getDate() + 7);
    return next.getMonth() !== mon.getMonth();
  }
  if (freq === 'odd')  return w === 1 || w === 3;
  if (freq === 'even') return w === 2 || w === 4;
  return true;
}

function getTodayTasks(ss, today, settings) {
  // Determine today's day name for scheduled tasks
  // Use the passed-in today date, not new Date(), so historical reports work correctly
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const d = new Date(today + 'T12:00:00');
  const todayName = dayNames[d.getDay()];

  // Get week start (Monday) for the given date — needed for frequency check
  const monOffset = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - monOffset);
  const weekStart = getDateStr(mon);

  // Filter by day AND frequency — matches the behaviour of getAllTasksForWeek() in the PWA
  const scheduledTasks = (settings.tasks || []).filter(t =>
    t.enabled &&
    t.day === todayName &&
    taskMatchesFrequencyAS(t, weekStart)
  );
  if (!scheduledTasks.length) return [];

  // Pull task completion records
  // Last row for a given taskId+week wins (sheet is append-only, latest = bottom).
  // Action 'untick' means the user deliberately un-ticked — treat as not done.
  const sheet = ss.getSheetByName('Task Completions');
  const completions = {};
  if (sheet && sheet.getLastRow() >= 2) {
    const data      = sheet.getDataRange().getValues();
    const headers   = data[0].map(h => String(h).trim());
    const tidCol    = headers.indexOf('Task ID');
    const wkCol     = headers.indexOf('Week Start');
    const byCol     = headers.indexOf('Completed By');
    const actionCol = headers.indexOf('Action');   // col H — may be -1 on old sheets
    for (let i = 1; i < data.length; i++) {
      const taskId = String(data[i][tidCol] || '');
      let   wk     = data[i][wkCol];
      if (wk instanceof Date) wk = getDateStr(wk);
      if (String(wk) !== weekStart || !taskId) continue;

      const action = actionCol >= 0 ? String(data[i][actionCol] || 'done').trim() : 'done';
      if (action === 'untick') {
        // Explicit untick — remove any earlier completion for this task
        delete completions[taskId];
      } else {
        // 'done' (or blank/legacy row) — record as completed; last row wins
        completions[taskId] = String(data[i][byCol] || '');
      }
    }
  }

  return scheduledTasks.map(t => ({
    label:  t.label,
    dept:   t.dept,
    done:   completions.hasOwnProperty(t.id),
    doneBy: completions[t.id] || '',
  }));
}

// ════════════════════════════════════════════════════════
//  ON-DEMAND EMAIL HANDLERS
// ════════════════════════════════════════════════════════

// ── Daily email for any date ──────────────────────────
function handleSendDailyEmail(data) {
  try {
    const date       = data.date;
    const settings   = getSettingsObj();
    if (!settings)   return jsonResponse({ status: 'error', message: 'No settings found' });

    const recipients = (data.recipients && data.recipients.length)
      ? data.recipients
      : (settings.emailRecipients || []);
    if (!recipients.length) return jsonResponse({ status: 'error', message: 'No recipients' });

    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const dateObj  = new Date(date + 'T12:00:00');
    const dayLabel = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");
    const name     = settings.restaurantName || 'SafeChecks';

    const opening = getTodayRecords(ss, 'Opening Checks',  date);
    const closing = getTodayRecords(ss, 'Closing Checks',  date);
    const temps   = getTodayRecords(ss, 'Temperature Log', date);
    const probes  = getTodayRecords(ss, 'Food Probe Log',  date);
    const goodsIn = getTodayRecords(ss, 'Goods In Log',    date);
    const cleaning = settings.cleaningEnabled ? getTodayRecords(ss, 'Cleaning Schedule', date) : [];
    const tasks   = getTodayTasks(ss, date, settings);
    const depts   = ['kitchen', 'foh'];

    const hasAnyFail = [...temps, ...probes].some(r => r.status === 'FAIL' || r.status === 'WARNING');
    const subject    = 'Daily Report — ' + name + ' — ' + Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "EEE d MMM yyyy");
    const html       = buildEmailHtml(name, dayLabel, date, opening, closing, temps, probes, goodsIn, cleaning, tasks, depts, settings);

    recipients.forEach(addr => {
      try { GmailApp.sendEmail(addr, subject, '', { htmlBody: html, name: name + ' · SafeChecks' }); }
      catch(e) { Logger.log('Failed to send to ' + addr + ': ' + e); }
    });

    return jsonResponse({ status: 'ok', sent: recipients.length });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Weekly email for a week starting on weekStart ────
function handleSendWeeklyEmail(data) {
  try {
    const weekStart  = data.weekStart;
    const settings   = getSettingsObj();
    if (!settings)   return jsonResponse({ status: 'error', message: 'No settings found' });

    const recipients = (data.recipients && data.recipients.length)
      ? data.recipients
      : (settings.emailRecipients || []);
    if (!recipients.length) return jsonResponse({ status: 'error', message: 'No recipients' });

    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const name = settings.restaurantName || 'SafeChecks';

    // Build the 7 dates of the week (Mon–Sun)
    const weekDates = [];
    const mon = new Date(weekStart + 'T12:00:00');
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon); d.setDate(mon.getDate() + i);
      weekDates.push(getDateStr(d));
    }
    const sun     = new Date(mon); sun.setDate(mon.getDate() + 6);
    const weekLabel = Utilities.formatDate(mon, Session.getScriptTimeZone(), "d MMM") + ' – ' +
                      Utilities.formatDate(sun, Session.getScriptTimeZone(), "d MMM yyyy");

    // Pull all records for the week
    var allTemps  = [], allProbes = [], allGoodsIn = [], allOpening = [], allClosing = [], allTasks = [], allCleaning = [];
    weekDates.forEach(function(date) {
      getTodayRecords(ss, 'Temperature Log', date).forEach(function(r) { r.date = date; allTemps.push(r); });
      getTodayRecords(ss, 'Food Probe Log',  date).forEach(function(r) { r.date = date; allProbes.push(r); });
      getTodayRecords(ss, 'Goods In Log',    date).forEach(function(r) { r.date = date; allGoodsIn.push(r); });
      getTodayRecords(ss, 'Opening Checks',  date).forEach(function(r) { r.date = date; allOpening.push(r); });
      getTodayRecords(ss, 'Closing Checks',  date).forEach(function(r) { r.date = date; allClosing.push(r); });
      getTodayTasks(ss, date, settings).forEach(function(t)  { t.date = date; allTasks.push(t); });
      if (settings.cleaningEnabled) {
        getTodayRecords(ss, 'Cleaning Schedule', date).forEach(function(r) { r.date = date; allCleaning.push(r); });
      }
    });

    // Weekly review record
    const sheet = ss.getSheetByName('Weekly Review');
    var weeklyRec = null;
    if (sheet && sheet.getLastRow() >= 2) {
      const data2   = sheet.getDataRange().getValues();
      const headers = data2[0].map(function(h) { return String(h).trim(); });
      const fieldsCol = headers.indexOf('Fields JSON');
      const timeCol   = headers.indexOf('Time');
      for (var j = 1; j < data2.length; j++) {
        // Match on week_start inside Fields JSON — more reliable than the Date column
        // which Google Sheets can auto-reformat (e.g. DD/MM/YYYY).
        var fields = {};
        try { fields = JSON.parse(String(data2[j][fieldsCol] || '{}')); } catch(e) {}
        if (fields.week_start === weekStart) {
          weeklyRec = { fields: fields, time: String(data2[j][timeCol] || '') };
          break;
        }
      }
    }

    const subject = 'Weekly Report — ' + name + ' — w/c ' + weekLabel;
    const html    = buildWeeklyEmailHtml(name, weekLabel, weekDates, allOpening, allClosing, allTemps, allProbes, allGoodsIn, allCleaning, allTasks, weeklyRec, settings);

    recipients.forEach(function(addr) {
      try { GmailApp.sendEmail(addr, subject, '', { htmlBody: html, name: name + ' · SafeChecks' }); }
      catch(e) { Logger.log('Failed to send to ' + addr + ': ' + e); }
    });

    return jsonResponse({ status: 'ok', sent: recipients.length });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ── Weekly email HTML builder ─────────────────────────
function buildWeeklyEmailHtml(name, weekLabel, weekDates, opening, closing, temps, probes, goodsIn, cleaning, tasks, weeklyRec, settings) {
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function dayStr(date) {
    const d = new Date(date + 'T12:00:00');
    return DAY_ABBR[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1);
  }
  function pctColor(p) { return p >= 90 ? '#16a34a' : p >= 70 ? '#d97706' : '#dc2626'; }
  function dot(color) { return '<span style="font-size:9px;color:' + color + '">&#x25CF;</span>'; }
  function dotText(color, text) { return dot(color) + ' <span style="font-size:12px;font-weight:600;color:' + color + ';font-family:Arial,sans-serif">' + text + '</span>'; }
  // Split free-text into sentence dot lines
  function sentenceDots(text, color) {
    if (!text) return '';
    return text.split(/\.\s+/).filter(Boolean).map(function(s) {
      var clean = s.replace(/\.$/, '').trim();
      return '<p style="margin:0 0 5px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + dot(color) + ' &nbsp;' + clean + '</p>';
    }).join('');
  }
  const divider = '<div style="height:1px;background:#e2e8f0"></div>';
  const sheetsUrl = getSheetsUrl();

  // ── Daily overview grid ──────────────────────────────
  function equipCell(date) {
    var recs   = temps.filter(function(r) { return r.date === date; });
    if (!recs.length) return '<td style="text-align:center;padding:6px 4px;font-size:12px;color:#94a3b8">—</td>';
    var fails  = recs.filter(function(r) { return r.status==='FAIL'||r.status==='WARNING'; }).length;
    var passes = recs.length - fails;
    var icon   = fails > 0 ? '⚠' : '✓';
    var color  = fails > 0 ? '#d97706' : '#16a34a';
    var sub    = fails > 0
      ? '<span style="font-size:9px;display:block"><span style="color:#16a34a">' + passes + '✓</span> <span style="color:#dc2626">' + fails + '✗</span></span>'
      : '<span style="font-size:9px;display:block;color:#94a3b8">' + recs.length + '</span>';
    return '<td style="text-align:center;padding:6px 4px;font-size:13px;color:' + color + '">' + icon + sub + '</td>';
  }
  function simpleCell(date, type, dept) {
    var recs = [];
    if (type==='opening') recs = opening.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type==='closing') recs = closing.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type==='cleaning') recs = cleaning.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type==='probe')   recs = probes.filter(function(r) { return r.date===date; });
    else if (type==='goodsin') recs = goodsIn.filter(function(r) { return r.date===date; });
    if (!recs.length) return '<td style="text-align:center;padding:6px 4px;font-size:13px;color:#94a3b8">—</td>';
    var hasFail = false;
    if (type==='opening'||type==='closing'||type==='cleaning') {
      recs.forEach(function(r) { Object.entries(r.fields||{}).forEach(function(e) { if (e[1]==='No') hasFail=true; }); });
    } else if (type==='probe') {
      hasFail = recs.some(function(r) { return r.status==='FAIL'; });
    } else if (type==='goodsin') {
      hasFail = recs.some(function(r) { return (r.fields||{}).gi_outcome==='rejected'||(r.fields||{}).gi_temp_status==='FAIL'; });
    }
    var icon  = hasFail ? '⚠' : '✓';
    var color = hasFail ? '#d97706' : '#16a34a';
    var count = (type==='probe'||type==='goodsin') ? '<span style="font-size:9px;display:block;color:#94a3b8">' + recs.length + '</span>' : '';
    return '<td style="text-align:center;padding:6px 4px;font-size:13px;color:' + color + '">' + icon + count + '</td>';
  }

  const gridColHeaders = weekDates.map(function(date) {
    const d = new Date(date + 'T12:00:00');
    return '<th style="text-align:center;padding:5px 4px;font-size:11px;color:#94a3b8;font-weight:600;min-width:36px">' + DAY_ABBR[d.getDay()] + '<br><span style="font-weight:400;font-size:9px">' + d.getDate() + '/' + (d.getMonth()+1) + '</span></th>';
  }).join('');

  const gridDefs = [
    ['opening','kitchen','&#x1F373; Opening'],
    ['opening','foh',    '&#x1F37D; Opening'],
    ['closing','kitchen','&#x1F373; Closing'],
    ['closing','foh',    '&#x1F37D; Closing'],
    ['equipment',null,   '&#x1F321; Equipment'],
    ['probe',null,       '&#x1F356; Probes'],
    ['goodsin',null,     '&#x1F4E6; Goods In'],
  ].concat(settings.cleaningEnabled ? [
    ['cleaning','kitchen','&#x1F9F9; Cleaning K'],
    ['cleaning','foh',    '&#x1F9F9; Cleaning F'],
  ] : []);

  const gridRows = gridDefs.map(function(row) {
    const cells = weekDates.map(function(date) {
      return row[0]==='equipment' ? equipCell(date) : simpleCell(date, row[0], row[1]);
    }).join('');
    return '<tr style="border-top:1px solid #f1f5f9"><td style="padding:6px 8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif;white-space:nowrap">' + row[2] + '</td>' + cells + '</tr>';
  }).join('');

  const gridHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif">' +
    '<tr><th style="text-align:left;padding:5px 8px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Check</th>' +
    gridColHeaders + '</tr>' + gridRows + '</table>';

  // ── Compliance ───────────────────────────────────────
  function equipBatches(dept, date) {
    var recs = temps.filter(function(r) { return r.date===date && (!dept || r.dept===dept); });
    var batches = {};
    recs.forEach(function(r) { var k = r.batch_id || r.location + r.time; batches[k] = true; });
    return Math.min(Object.keys(batches).length, 2);
  }
  function probeOnDate(date) { return probes.some(function(r) { return r.date===date; }) ? 1 : 0; }

  function complianceRow(label, actual, expected) {
    if (expected === 0) return '';
    var p  = Math.round(actual/expected*100);
    var c  = pctColor(p);
    var bw = Math.round(p);
    return '<tr style="border-top:1px solid #f1f5f9"><td style="padding:10px 16px" colspan="2">' +
      '<p style="margin:0 0 5px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + label +
      '<span style="float:right;font-size:13px;font-weight:700;color:' + c + ';font-family:Arial,sans-serif">' + p + '% ' +
      '<span style="font-size:11px;font-weight:400;color:#94a3b8">' + actual + '/' + expected + '</span></span></p>' +
      '<div style="width:100%;height:4px;background:#f1f5f9;border-radius:3px">' +
      '<div style="width:' + bw + '%;height:4px;background:' + c + ';border-radius:3px"></div></div>' +
      '</td></tr>';
  }

  function deptCard(label, icon, color, rows, missingLines) {
    var totalA = 0, totalE = 0;
    rows.forEach(function(r) { if (r.e > 0) { totalA += r.a; totalE += r.e; } });
    var overall = totalE > 0 ? Math.round(totalA/totalE*100) : 100;
    var oc = pctColor(overall);
    var missingHtml = '';
    if (missingLines && missingLines.length) {
      missingHtml = '<tr style="border-top:1px solid #f1f5f9"><td colspan="2" style="padding:10px 16px 14px">' +
        '<p style="margin:0 0 5px;font-size:11px;font-weight:600;color:#d97706;font-family:Arial,sans-serif">Score based on submitted days only</p>' +
        missingLines.map(function(line) {
          return '<p style="margin:0 0 3px;font-size:11px;color:' + line.color + ';font-family:Arial,sans-serif"><span style="font-size:8px">&#x25CF;</span> &nbsp;' + line.text + '</p>';
        }).join('') + '</td></tr>';
    }
    var rowsHtml = rows.map(function(r) { return r.e > 0 ? complianceRow(r.label, r.a, r.e) : ''; }).join('');
    var lastPad  = missingLines && missingLines.length ? '' : ' style="padding-bottom:14px"';
    // patch last complianceRow padding if no missing note
    if (!missingLines || !missingLines.length) {
      rowsHtml = rowsHtml.replace(/(<tr style="border-top:1px solid #f1f5f9"><td style="padding:10px 16px" colspan="2">)(?!.*<tr style)/, function(m) {
        return m.replace('padding:10px 16px', 'padding:10px 16px 14px');
      });
    }
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:collapse;margin-bottom:10px">' +
      '<tr style="background:#f8fafc"><td style="padding:14px 16px;font-size:15px;font-weight:700;color:' + color + ';font-family:Arial,sans-serif">' + icon + ' ' + label + '</td>' +
      '<td style="padding:14px 16px;text-align:right;font-size:22px;font-weight:700;color:' + oc + ';font-family:Arial,sans-serif">' + overall + '%</td></tr>' +
      rowsHtml + missingHtml + '</table>';
  }

  // Count trading days
  var kTradingDays = 0, fTradingDays = 0;
  weekDates.forEach(function(date) {
    if (isTradingAS('kitchen', settings, date)) kTradingDays++;
    if (isTradingAS('foh',     settings, date)) fTradingDays++;
  });

  var kOpenAct=0,kCloseAct=0,fOpenAct=0,fCloseAct=0;
  var kEquipAct=0,fEquipAct=0,kProbeAct=0;
  var kCleanAct=0,fCleanAct=0;
  var kMissingOpen=0,kMissingClose=0,fMissingOpen=0,fMissingClose=0;
  var kDaysOk=0,fDaysOk=0;

  weekDates.forEach(function(date) {
    if (isTradingAS('kitchen', settings, date)) {
      var kOp = opening.some(function(r) { return r.date===date && r.dept==='kitchen'; });
      var kCl = closing.some(function(r) { return r.date===date && r.dept==='kitchen'; });
      if (kOp) kOpenAct++;  else kMissingOpen++;
      if (kCl) kCloseAct++; else kMissingClose++;
      if (kOp && kCl) kDaysOk++;
      kEquipAct += equipBatches('kitchen', date);
      kProbeAct += probeOnDate(date);
      if (settings.cleaningEnabled && cleaning.some(function(r) { return r.date===date && r.dept==='kitchen'; })) kCleanAct++;
    }
    if (isTradingAS('foh', settings, date)) {
      var fOp = opening.some(function(r) { return r.date===date && r.dept==='foh'; });
      var fCl = closing.some(function(r) { return r.date===date && r.dept==='foh'; });
      if (fOp) fOpenAct++;  else fMissingOpen++;
      if (fCl) fCloseAct++; else fMissingClose++;
      if (fOp && fCl) fDaysOk++;
      fEquipAct += equipBatches('foh', date);
      if (settings.cleaningEnabled && cleaning.some(function(r) { return r.date===date && r.dept==='foh'; })) fCleanAct++;
    }
  });

  var kMissingDays = kTradingDays - kDaysOk;
  var fMissingDays = fTradingDays - fDaysOk;

  function missingLines(missingOpen, missingClose) {
    var lines = [];
    if (missingOpen  > 0) lines.push({ color: '#d97706', text: missingOpen  + ' day' + (missingOpen !==1?'s':'') + ' missing opening submission' });
    if (missingClose > 0) lines.push({ color: '#dc2626', text: missingClose + ' day' + (missingClose!==1?'s':'') + ' missing closing submission' });
    return lines;
  }

  var kRows = [
    { label: 'Opening Checks',   a: kOpenAct,  e: kTradingDays },
    { label: 'Closing Checks',   a: kCloseAct, e: kTradingDays },
    { label: 'Equipment Checks', a: kEquipAct, e: kTradingDays * 2 },
    { label: 'Food Probes',      a: kProbeAct, e: kTradingDays },
  ];
  if (settings.cleaningEnabled) kRows.push({ label: 'Cleaning Schedule', a: kCleanAct, e: kTradingDays });
  var fRows = [
    { label: 'Opening Checks',   a: fOpenAct,  e: fTradingDays },
    { label: 'Closing Checks',   a: fCloseAct, e: fTradingDays },
    { label: 'Equipment Checks', a: fEquipAct, e: fTradingDays * 2 },
  ];
  if (settings.cleaningEnabled) fRows.push({ label: 'Cleaning Schedule', a: fCleanAct, e: fTradingDays });

  const complianceHtml =
    deptCard('Kitchen',        '&#x1F373;', '#d97706', kRows, kMissingDays > 0 ? missingLines(kMissingOpen, kMissingClose) : null) +
    deptCard('Front of House', '&#x1F37D;', '#3b82f6', fRows, fMissingDays > 0 ? missingLines(fMissingOpen, fMissingClose) : null);

  // ── Incomplete week banner ───────────────────────────
  var totalMissingDays = kMissingDays + fMissingDays;
  var incompleteBanner = '';
  if (totalMissingDays > 0) {
    var parts = [];
    if (kMissingDays > 0) {
      var kLines = '';
      if (kMissingOpen  > 0) kLines += '<p style="margin:0 0 3px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><span style="font-size:9px;color:#d97706">&#x25CF;</span> <span style="font-weight:600;color:#d97706">Opening missing on ' + kMissingOpen + ' day' + (kMissingOpen!==1?'s':'') + '</span></p>';
      if (kMissingClose > 0) kLines += '<p style="margin:0 0 3px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><span style="font-size:9px;color:#dc2626">&#x25CF;</span> <span style="font-weight:600;color:#dc2626">Closing missing on ' + kMissingClose + ' day' + (kMissingClose!==1?'s':'') + '</span></p>';
      parts.push('<p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#1e293b;font-family:Arial,sans-serif">&#x1F373; Kitchen</p>' + kLines);
    }
    if (fMissingDays > 0) {
      var fLines = '';
      if (fMissingOpen  > 0) fLines += '<p style="margin:0 0 3px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><span style="font-size:9px;color:#d97706">&#x25CF;</span> <span style="font-weight:600;color:#d97706">Opening missing on ' + fMissingOpen + ' day' + (fMissingOpen!==1?'s':'') + '</span></p>';
      if (fMissingClose > 0) fLines += '<p style="margin:0 0 3px;font-size:12px;color:#64748b;font-family:Arial,sans-serif"><span style="font-size:9px;color:#dc2626">&#x25CF;</span> <span style="font-weight:600;color:#dc2626">Closing missing on ' + fMissingClose + ' day' + (fMissingClose!==1?'s':'') + '</span></p>';
      parts.push('<p style="margin:12px 0 5px;font-size:12px;font-weight:700;color:#1e293b;font-family:Arial,sans-serif">&#x1F37D; Front of House</p>' + fLines);
    }
    incompleteBanner = divider +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">' +
      '<tr><td style="padding:16px 28px">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>' +
      '<td style="font-size:16px;font-weight:700;color:#0f172a;font-family:Arial,sans-serif">Incomplete week</td>' +
      '<td style="text-align:right;font-size:18px">&#x26A0;</td></tr></table>' +
      parts.join('') +
      '<p style="margin:12px 0 0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">Compliance scores are based on submitted days only.</p>' +
      '</td></tr></table>';
  }

  // ── Weekly management review ─────────────────────────
  var reviewBody = '';
  if (!weeklyRec) {
    reviewBody = '<p style="margin:0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No weekly review submitted</p>';
  } else {
    const f      = weeklyRec.fields || {};
    const rating = f.weekly_rating    || '';
    const issues = f.weekly_issues    || '';
    const actions= f.weekly_actions   || '';
    const signed = f.weekly_signed_by || '';
    const rc     = rating==='Good' ? '#16a34a' : rating==='Satisfactory' ? '#d97706' : rating==='Needs Improvement' ? '#dc2626' : '#94a3b8';

    var checklistHtml = '';
    var mgmtChecks = (settings.checks && settings.checks.mgmt && settings.checks.mgmt.weekly) ? settings.checks.mgmt.weekly : [];
    if (mgmtChecks.length) {
      var checkRows = mgmtChecks.filter(function(c) { return c.enabled !== false; }).map(function(c, i) {
        var answer = f[c.id];
        if (answer !== 'Yes' && answer !== 'No') return '';
        var ac = answer === 'Yes' ? '#16a34a' : '#dc2626';
        return '<tr style="border-top:1px solid #f1f5f9' + (i%2===1?';background:#fafafa':'') + '">' +
          '<td style="padding:7px 12px;font-size:12px;color:#334155;font-family:Arial,sans-serif">' + c.label + '</td>' +
          '<td style="padding:7px 12px;text-align:right"><span style="font-size:12px;font-weight:700;color:' + ac + ';font-family:Arial,sans-serif">' + answer + '</span></td></tr>';
      }).join('');
      if (checkRows) {
        checklistHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px">' +
          '<tr style="background:#f8fafc"><td style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-family:Arial,sans-serif">Checklist Item</td>' +
          '<td style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-family:Arial,sans-serif;text-align:right;width:50px">Result</td></tr>' +
          checkRows + '</table>';
      }
    }

    reviewBody =
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px"><tr>' +
      '<td>' + (rating ? '<div style="display:inline-block;border:2px solid ' + rc + ';color:' + rc + ';border-radius:8px;padding:5px 14px;font-size:13px;font-weight:700;font-family:Arial,sans-serif">' + rating + '</div>' : '') + '</td>' +
      '<td style="text-align:right;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + (signed ? 'Signed: ' + signed + (weeklyRec.time ? ' &middot; ' + weeklyRec.time : '') : '') + '</td>' +
      '</tr></table>' +
      checklistHtml +
      (issues  ? '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#94a3b8;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em">Issues</p>' + sentenceDots(issues, '#64748b') + '<div style="margin-bottom:14px"></div>' : '') +
      (actions ? '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#94a3b8;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em">Actions</p>' + sentenceDots(actions, '#64748b') : '');
  }

  // ── Failed checks ─────────────────────────────────────
  var checkLabelMap = {};
  if (settings && settings.checks) { Object.values(settings.checks).forEach(function(dept) { if (dept && typeof dept==='object') { Object.values(dept).forEach(function(arr) { if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) checkLabelMap[c.id]=c.label; }); }); } }); }
  if (settings && settings.sharedChecks) { Object.values(settings.sharedChecks).forEach(function(arr) { if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) checkLabelMap[c.id]=c.label; }); }); }

  var failedRows = '';
  opening.concat(closing).forEach(function(r) {
    var checkType = opening.indexOf(r) >= 0 ? 'Opening' : 'Closing';
    var deptLabel = r.dept==='kitchen' ? '&#x1F373; Kitchen' : '&#x1F37D; FOH';
    Object.entries(r.fields||{}).forEach(function(e) {
      if (e[1] !== 'No') return;
      var label = checkLabelMap[e[0]] || e[0].replace(/_/g,' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      failedRows += '<tr style="border-bottom:1px solid #f1f5f9">' +
        '<td style="padding:8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif;white-space:nowrap">' + dayStr(r.date) + '</td>' +
        '<td style="padding:8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif;white-space:nowrap">' + deptLabel + ' ' + checkType + '</td>' +
        '<td style="padding:8px;font-size:12px;font-weight:600;color:#dc2626;font-family:Arial,sans-serif">&#x2717; ' + label + '</td>' +
        '<td style="padding:8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + (r.signedBy||'&mdash;') + '</td></tr>';
    });
  });
  const failedSection = failedRows
    ? sectionBlock('&#x26A0; Failed Checks',
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
        '<tr style="background:#f8fafc"><td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Date</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Dept</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Check</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Signed</td></tr>' +
        failedRows + '</table>')
    : '';

  // ── Temperature breaches ──────────────────────────────
  var breachRows = '';
  temps.filter(function(r) { return r.status==='FAIL'; }).forEach(function(r) {
    var timeStr = r.time ? fmtTime(r.time) : '';
    breachRows += '<tr style="border-bottom:1px solid #f1f5f9">' +
      '<td style="padding:9px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + (timeStr ? '<br><span style="color:#94a3b8">' + timeStr + '</span>' : '') + '</td>' +
      '<td style="padding:9px 8px;font-size:13px;font-weight:600;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
      '<td style="padding:9px 8px;font-size:13px;font-weight:700;color:#dc2626;font-family:monospace">' + (r.temp ? r.temp + '&deg;C' : '&mdash;') + '</td>' +
      '<td style="padding:9px 8px;white-space:nowrap">' + dot('#dc2626') + ' <span style="font-size:12px;font-weight:600;color:#dc2626;font-family:Arial,sans-serif">FAIL</span></td>' +
      '<td style="padding:9px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif;font-style:italic">' + (r.action && r.action!=='None required' ? r.action : '&mdash;') + '</td></tr>';
  });
  const breachSection = breachRows
    ? sectionBlock('&#x1F6A8; Temperature Breaches',
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
        '<tr style="background:#f8fafc">' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Date</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Equipment</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Reading</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Status</td>' +
        '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Action</td></tr>' +
        breachRows + '</table>')
    : '';

  // ── Equipment log ─────────────────────────────────────
  var tempRows = !temps.length
    ? '<tr><td colspan="5" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No equipment checks this week</td></tr>'
    : temps.map(function(r) {
        var dc = r.status==='OK' ? '#16a34a' : r.status==='WARNING' ? '#d97706' : '#dc2626';
        var action = r.action && r.action!=='None required' && r.action!=='See notes' ? r.action : '&mdash;';
        return '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
          '<td style="padding:8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
          '<td style="padding:8px;font-size:13px;font-weight:600;color:#334155;font-family:monospace">' + (r.temp ? r.temp + '&deg;C' : '&mdash;') + '</td>' +
          '<td style="padding:8px;white-space:nowrap">' + dot(dc) + ' <span style="font-size:12px;font-weight:600;color:' + dc + ';font-family:Arial,sans-serif">' + r.status + '</span></td>' +
          '<td style="padding:8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif;font-style:italic">' + action + '</td></tr>';
      }).join('');

  const tempSection = sectionBlock(
    '&#x1F321; Equipment Checks &nbsp;<span style="font-weight:400;color:#94a3b8">' + temps.length + ' reading' + (temps.length!==1?'s':'') + '</span>',
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Date</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Equipment</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Reading</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Status</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Action</td></tr>' +
    tempRows + '</table>'
  );

  // ── Food probes ───────────────────────────────────────
  var probeRows = !probes.length
    ? '<tr><td colspan="4" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No food probes this week</td></tr>'
    : probes.map(function(r) {
        var pass = r.status === 'PASS';
        var dc   = pass ? '#16a34a' : '#dc2626';
        var coolingHtml = r.cooling ? '<p style="margin:3px 0 0;font-size:11px;color:#60a5fa;font-family:Arial,sans-serif">&#x2744; Cooled for ' + r.cooling + '</p>' : '';
        var rows = '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
          '<td style="padding:8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.product + coolingHtml + '</td>' +
          '<td style="padding:8px;font-size:13px;font-weight:600;color:#334155;font-family:monospace">' + (r.temp ? r.temp + '&deg;C' : '&mdash;') + '</td>' +
          '<td style="padding:8px;white-space:nowrap">' + dot(dc) + ' <span style="font-size:12px;font-weight:600;color:' + dc + ';font-family:Arial,sans-serif">' + r.status + '</span></td></tr>';
        if (!pass && r.action && r.action!=='None required') {
          rows += '<tr style="border-bottom:1px solid #f1f5f9"><td colspan="4" style="padding:0 8px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">&#x21B3; Action: ' + r.action + '</td></tr>';
        }
        return rows;
      }).join('');

  const probeSection = sectionBlock(
    '&#x1F356; Food Probes &nbsp;<span style="font-weight:400;color:#94a3b8">' + (probes.length || 'none') + '</span>',
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Date</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Product</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Core Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Result</td></tr>' +
    probeRows + '</table>'
  );

  // ── Goods In ──────────────────────────────────────────
  var giRows = !goodsIn.length
    ? '<tr><td colspan="5" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No deliveries this week</td></tr>'
    : goodsIn.map(function(r) {
        const f      = r.fields || {};
        const isAcc  = f.gi_outcome === 'accepted';
        const isAmb  = f.gi_type === 'ambient';
        const tIcon  = f.gi_type==='frozen' ? '&#x2744;' : isAmb ? '&#x1F4E6;' : '&#x1F33F;';
        const tColor = isAmb ? '#94a3b8' : f.gi_temp_status==='FAIL' ? '#dc2626' : f.gi_temp_status==='WARNING' ? '#d97706' : '#16a34a';
        const oColor = isAcc ? '#16a34a' : '#dc2626';
        var rows = '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
          '<td style="padding:8px;font-size:13px;font-weight:600;font-family:Arial,sans-serif;color:#1e293b">' + (f.gi_supplier||'&mdash;') + '</td>' +
          '<td style="padding:8px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + tIcon + ' ' + (f.gi_type||'') + '</td>' +
          '<td style="padding:8px;font-size:13px;font-family:monospace;font-weight:600;color:' + tColor + '">' + (f.gi_temp ? f.gi_temp + '&deg;C' : '&mdash;') + '</td>' +
          '<td style="padding:8px;font-size:12px;font-weight:700;color:' + oColor + ';font-family:Arial,sans-serif">' + (isAcc ? 'Accepted' : 'Rejected') + '</td></tr>';
        if (f.gi_notes) rows += '<tr style="border-bottom:1px solid #f1f5f9"><td colspan="5" style="padding:0 8px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">&#x21B3; ' + f.gi_notes + '</td></tr>';
        return rows;
      }).join('');

  const giSection = sectionBlock(
    '&#x1F4E6; Goods In &nbsp;<span style="font-weight:400;color:#94a3b8">' + (goodsIn.length || 'none') + '</span>',
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Date</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Supplier</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Type</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:6px 8px;font-weight:600;text-transform:uppercase">Outcome</td></tr>' +
    giRows + '</table>'
  );

  // ── Tasks ─────────────────────────────────────────────
  const doneCount = tasks.filter(function(t) { return t.done; }).length;
  var taskRows = !tasks.length
    ? '<tr><td colspan="3" style="padding:9px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No tasks scheduled this week</td></tr>'
    : tasks.map(function(t) {
        const d  = new Date((t.date||'') + 'T12:00:00');
        const ds = t.date ? DAY_ABBR[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) : '';
        if (t.done) {
          return '<tr style="border-bottom:1px solid #f1f5f9">' +
            '<td style="padding:9px 0;font-size:12px;color:#64748b;font-family:Arial,sans-serif;width:60px">' + ds + '</td>' +
            '<td style="padding:9px 8px;font-size:13px;color:#334155;font-family:Arial,sans-serif"><span style="color:#16a34a;font-weight:700">&#x2713;</span> ' + t.label + '</td>' +
            '<td style="text-align:right;padding:9px 0;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif;white-space:nowrap">' + (t.doneBy||'') + '</td></tr>';
        }
        return '<tr style="border-bottom:1px solid #f1f5f9">' +
          '<td style="padding:9px 0;font-size:12px;color:#64748b;font-family:Arial,sans-serif;width:60px">' + ds + '</td>' +
          '<td style="padding:9px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + t.label + '</td>' +
          '<td style="text-align:right;padding:9px 0;white-space:nowrap"><span style="font-size:9px;color:#94a3b8">&#x25CF;</span> <span style="font-size:12px;font-weight:600;color:#94a3b8;font-family:Arial,sans-serif">Not done</span></td></tr>';
      }).join('');

  const taskSection = sectionBlock(
    '&#x2705; Tasks &nbsp;<span style="font-weight:400;color:#94a3b8">' + doneCount + ' / ' + tasks.length + ' complete</span>',
    '<table width="100%" cellpadding="0" cellspacing="0">' + taskRows + '</table>'
  );

  // ── Assemble ──────────────────────────────────────────
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<style>@media print{body{background:#fff!important}}</style>' +
    '</head><body style="margin:0;padding:24px 16px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:640px;margin:0 auto">' +

    // Header
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px 12px 0 0;border:1px solid #e2e8f0;border-bottom:none">' +
    '<tr><td style="padding:28px 28px 24px">' +
    '<p style="margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Weekly Food Safety Report</p>' +
    '<p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#0f172a;font-family:Arial,sans-serif">' + name + '</p>' +
    '<p style="margin:4px 0 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif">Week: ' + weekLabel + '</p>' +
    '</td></tr></table>' +

    incompleteBanner + divider +

    // Daily overview
    sectionBlock('Daily Overview', gridHtml) + divider +

    // Compliance
    sectionBlock('Compliance', complianceHtml) + divider +

    // Weekly review
    sectionBlock('&#x1F4CB; Weekly Management Review', reviewBody) + divider +

    // Conditional sections
    (failedRows ? failedSection + divider : '') +
    (breachRows ? breachSection + divider : '') +

    // Always-on sections
    tempSection + divider + probeSection + divider + giSection + divider + taskSection + divider +

    // Footer
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none">' +
    '<tr><td style="padding:20px 28px">' +
    (sheetsUrl ? '<p style="margin:0;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">Full records &nbsp;&middot;&nbsp; <a href="' + sheetsUrl + '" style="color:#3b82f6;text-decoration:none">Open in Google Sheets</a></p>' : '') +
    '<p style="margin:6px 0 0;font-size:11px;color:#cbd5e1;font-family:Arial,sans-serif">Sent by SafeChecks &nbsp;&middot;&nbsp; To manage recipients, open Settings in the app</p>' +
    '</td></tr></table>' +

    '</div></body></html>';
}


// ── GET wrappers for on-demand email (called from PWA via GET) ────
function handleSendDailyEmailGet(e, ss) {
  const date       = e.parameter.date || getDateStr(new Date());
  const recipStr   = e.parameter.recipients || '';
  const recipients = recipStr.split(',').map(function(r) { return r.trim(); }).filter(Boolean);
  return handleSendDailyEmail({ date: date, recipients: recipients });
}

function handleSendWeeklyEmailGet(e, ss) {
  const weekStart  = e.parameter.weekStart || '';
  const recipStr   = e.parameter.recipients || '';
  const recipients = recipStr.split(',').map(function(r) { return r.trim(); }).filter(Boolean);
  return handleSendWeeklyEmail({ weekStart: weekStart, recipients: recipients });
}
