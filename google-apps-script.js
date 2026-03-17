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
  const html = buildEmailHtml(name, dayLabel, today, opening, closing, temps, probes, goodsIn, tasks, depts, settings);

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

  // Submission-level compliance — matches screen report model
  // 1 point per expected submission (opening + closing per trading dept)
  const tradingDepts   = depts.filter(d => isTradingAS(d, settings));
  const expectedCheckCount = tradingDepts.length * 2;
  const submittedChecks = tradingDepts.reduce((n, d) => {
    return n + (opening.find(r => r.dept === d) ? 1 : 0) + (closing.find(r => r.dept === d) ? 1 : 0);
  }, 0);
  const anyMissing = submittedChecks < expectedCheckCount;
  const pct = expectedCheckCount > 0 ? Math.round(submittedChecks / expectedCheckCount * 100) : null;

  const headerBorder = anyMissing ? '#ef4444' : pct === null ? '#4a5568' : pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const headerBg     = anyMissing ? '#2d0a0a' : pct === null ? '#1a2332' : pct >= 90 ? '#0d3320' : pct >= 70 ? '#2d1c07' : '#2d0a0a';
  const pctColor     = headerBorder;
  const barWidth     = pct !== null ? pct : 0;

  const badgeHtml = anyMissing
    ? '<div style="display:inline-block;background:#2d0a0a;border:2px solid #ef4444;border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:14px;font-weight:700;color:#ef4444;font-family:Arial,sans-serif;line-height:1.3">Incomplete</p></div>'
    : pct !== null
      ? '<div style="display:inline-block;background:' + headerBg + ';border:2px solid ' + pctColor + ';border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:22px;font-weight:700;color:' + pctColor + ';font-family:Arial,sans-serif;line-height:1">' + pct + '%</p><p style="margin:2px 0 0;font-size:10px;color:' + pctColor + ';font-family:Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;opacity:.8">Compliance</p></div>'
      : '<div style="display:inline-block;background:#1a2332;border:2px solid #4a5568;border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:11px;color:#7d8da8;font-family:Arial,sans-serif">No checks<br>recorded</p></div>';

  // ── Overview section ──────────────────────────────
  const overviewRows = depts.map(d => {
    const trading = isTradingAS(d, settings);
    const op = opening.find(r => r.dept === d);
    const cl = closing.find(r => r.dept === d);
    const missing = trading && (!op || !cl);
    const deptFail = (op && op.failCount > 0) || (cl && cl.failCount > 0);
    const tempFail = temps.filter(r => r.dept === d).some(r => r.status === 'FAIL' || r.status === 'WARNING');

    let pill, bg, color;
    if (!trading)                  { pill = '— Closed today'; bg = '#1e293b'; color = '#64748b'; }
    else if (missing)              { pill = '⛔ ' + (!op ? 'Opening' : '') + (!op && !cl ? ' & ' : '') + (!cl ? 'Closing' : '') + ' missing'; bg = '#fee2e2'; color = '#991b1b'; }
    else if (deptFail || tempFail) { pill = '⚠ Issues recorded · ' + pct + '%'; bg = '#fef3c7'; color = '#92400e'; }
    else                           { pill = '✓ All clear · 100%'; bg = '#dcfce7'; color = '#166534'; }

    return '<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;font-family:Arial,sans-serif"><strong>' + DEPT_LABELS[d] + '</strong></td>' +
      '<td style="text-align:right"><span style="background:' + bg + ';color:' + color + ';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + pill + '</span></td></tr>';
  }).join('');

  // Cleaning overview row (when enabled)
  var cleaningOverviewRow = '';
  if (settings.cleaningEnabled) {
    var cleanCount = cleaning.length;
    var cleanFail  = cleaning.some(function(r) {
      return Object.entries(r.fields||{}).some(function(e) { return e[1] === 'No'; });
    });
    var cpill, cbg, ccolor;
    if (!cleanCount)      { cpill = '— Not recorded'; cbg = '#f1f5f9'; ccolor = '#64748b'; }
    else if (cleanFail)   { cpill = '⚠ Issues recorded'; cbg = '#fef3c7'; ccolor = '#92400e'; }
    else                  { cpill = '✓ All clear'; cbg = '#dcfce7'; ccolor = '#166534'; }
    cleaningOverviewRow = '<tr><td style="padding:6px 0;font-size:13px;color:#1e293b;font-family:Arial,sans-serif"><strong>&#x1F9F9; Cleaning Schedule</strong></td>' +
      '<td style="text-align:right"><span style="background:' + cbg + ';color:' + ccolor + ';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + cpill + '</span></td></tr>';
  }

  // ── Opening/closing check sections ────────────────
  function buildCheckSection(title, records) {
    const rows = depts.map(d => {
      const rec = records.find(r => r.dept === d);
      if (!rec) {
        if (!isTradingAS(d, settings)) {
          return '<tr><td style="padding:5px 0;font-size:13px;color:#64748b;font-family:Arial,sans-serif;font-style:italic">' + DEPT_LABELS[d] + '</td>' +
            '<td style="text-align:right"><span style="background:#1e293b;color:#64748b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:Arial,sans-serif">Closed</span></td></tr>';
        }
        return '<tr><td style="padding:5px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + DEPT_LABELS[d] + '</td>' +
          '<td style="text-align:right"><span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">Not submitted</span></td></tr>';
      }
      const scoreColor = rec.failCount > 0 ? '#d97706' : '#16a34a';
      let failHtml = '';
      if (rec.failCount > 0 && rec.failedLabels.length) {
        var labelMap = {};
        if (settings && settings.checks) { Object.values(settings.checks).forEach(function(dept) { if (dept && typeof dept === 'object') { Object.values(dept).forEach(function(arr) { if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) labelMap[c.id] = c.label; }); }); } }); }
        const items = rec.failedLabels.map(l => { var lbl = labelMap[l] || l.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()); return '<p style="margin:0 0 3px;font-size:12px;color:#92400e;font-family:Arial,sans-serif">&#x2717; &nbsp;' + lbl + '</p>'; }).join('');
        const noteHtml = rec.notes ? '<p style="margin:6px 0 0;font-size:11px;color:#a16207;font-family:Arial,sans-serif;font-style:italic">Note: ' + rec.notes + '</p>' : '';
        failHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;background:#fffbeb;border-radius:4px;border:1px solid #fde68a"><tr><td style="padding:8px 10px">' + items + noteHtml + '</td></tr></table>';
      }
      return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:5px 0"><p style="margin:0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + DEPT_LABELS[d] +
        ' &nbsp;<span style="color:' + scoreColor + ';font-size:12px;font-weight:600">' + rec.passed + '/' + rec.total + '</span>' +
        ' &nbsp;<span style="color:#94a3b8;font-size:12px">' + rec.signedBy + ' · ' + fmtTime(rec.time) + '</span></p>' + failHtml + '</td></tr>';
    }).join('');

    return '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
      sectionHeader(title) +
      '<tr><td style="padding:4px 24px 14px"><table width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr></table>';
  }

  // ── Temperature section ───────────────────────────
  const tempCount = temps.length;
  const tempRows = tempCount === 0
    ? '<tr><td colspan="4" style="padding:10px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No temperature readings recorded today</td></tr>'
    : temps.map(r => {
        const badgeBg = r.status === 'OK' ? '#dcfce7' : r.status === 'WARNING' ? '#fef3c7' : '#fee2e2';
        const badgeFg = r.status === 'OK' ? '#166534' : r.status === 'WARNING' ? '#92400e' : '#991b1b';
        const rowBg   = r.status === 'FAIL' ? 'background:#fef2f2' : r.status === 'WARNING' ? 'background:#fffbeb' : '';
        const actionHtml = r.action && r.action !== 'None required'
          ? '<p style="margin:3px 0 0;font-size:11px;color:#a16207;font-family:Arial,sans-serif">Action: ' + r.action + '</p>' : '';
        return '<tr style="border-bottom:1px solid #f1f5f9;' + rowBg + '">' +
          '<td style="padding:7px 8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
          '<td style="padding:7px 8px;font-size:13px;font-weight:600;color:#334155;font-family:Arial,sans-serif">' + r.temp + '°C</td>' +
          '<td style="padding:7px 8px"><span style="background:' + badgeBg + ';color:' + badgeFg + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + r.status + '</span>' + actionHtml + '</td>' +
          '<td style="padding:7px 8px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + fmtTime(r.time) + '</td></tr>';
      }).join('');

  const expectedChecks = 2;
  const uniqueDays = new Set(temps.map(r => r.time.split(':')[0])).size; // rough proxy
  const tempCountNote = tempCount > 0 && tempCount < expectedChecks
    ? ' &nbsp;<span style="color:#f59e0b;font-weight:400;font-size:11px">only ' + tempCount + ' of ' + expectedChecks + ' expected checks done</span>' : '';

  const tempSection = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
    '<tr><td style="padding:14px 24px 4px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Equipment Temperatures &nbsp;<span style="font-weight:400;color:#cbd5e1">' + tempCount + ' reading' + (tempCount !== 1 ? 's' : '') + '</span>' + tempCountNote + '</p></td></tr>' +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc"><td style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;padding:5px 8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Location</td><td style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;padding:5px 8px;font-weight:600;text-transform:uppercase">Temp</td><td style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;padding:5px 8px;font-weight:600;text-transform:uppercase">Status / Action</td><td style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;padding:5px 8px;font-weight:600;text-transform:uppercase">Time</td></tr>' +
    tempRows + '</table></td></tr></table>';

  // ── Probe section ─────────────────────────────────
  const probeCount = probes.length;
  const probeRows = probeCount === 0
    ? '<td colspan="2" style="padding:10px 0"><span style="background:#fee2e2;color:#991b1b;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;font-family:Arial,sans-serif">⛔ No food probes recorded today</span></td>'
    : probes.map(r => {
        const pass = r.status === 'PASS';
        const bg = pass ? '#dcfce7' : '#fee2e2';
        const fg = pass ? '#166534' : '#991b1b';
        const actionHtml = !pass && r.action && r.action !== 'None required'
          ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;background:#fef2f2;border-radius:4px;border:1px solid #fecaca"><tr><td style="padding:6px 10px;font-size:11px;color:#991b1b;font-family:Arial,sans-serif">Action: ' + r.action + '</td></tr></table>' : '';
        const coolingHtml = r.cooling ? '<p style="margin:3px 0 0;font-size:11px;color:#60a5fa;font-family:Arial,sans-serif">&#x2744; Cooled for ' + r.cooling + '</p>' : '';
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px 0"><p style="margin:0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.product + '</p>' + coolingHtml + actionHtml + '</td>' +
          '<td style="text-align:right;vertical-align:top;padding:6px 0;font-size:12px;font-family:Arial,sans-serif"><strong style="color:#334155">' + r.temp + '°C</strong> <span style="background:' + bg + ';color:' + fg + ';padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;margin-left:6px">' + r.status + '</span> <span style="color:#94a3b8;margin-left:6px">' + r.staff + '</span></td></tr>';
      }).join('');

  const probeSection = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
    '<tr><td style="padding:14px 24px 4px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Food Probes &nbsp;<span style="font-weight:400;color:#cbd5e1">' + (probeCount > 0 ? probeCount + ' reading' + (probeCount !== 1 ? 's' : '') : '') + '</span></p></td></tr>' +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0">' + probeRows + '</table></td></tr></table>';

  // ── Goods In section ──────────────────────────────
  var giRows = '';
  if (!goodsIn.length) {
    giRows = '<tr><td colspan="5" style="padding:10px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No deliveries recorded today</td></tr>';
  } else {
    goodsIn.forEach(function(r) {
      var f = r.fields || {};
      var isAcc = f.gi_outcome === 'accepted';
      var tempColor = f.gi_temp_status === 'FAIL' ? '#ef4444' : f.gi_temp_status === 'WARNING' ? '#f59e0b' : '#22c55e';
      giRows += '<tr>' +
        '<td style="padding:6px 8px;font-size:13px;font-family:Arial,sans-serif;font-weight:600">' + (f.gi_supplier||'—') + '</td>' +
        '<td style="padding:6px 8px;font-size:12px;font-family:Arial,sans-serif;color:#94a3b8">' + (f.gi_type==='frozen'?'&#x2744;':'&#x1F33F;') + ' ' + (f.gi_type||'') + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;font-family:monospace;font-weight:600;color:' + tempColor + '">' + (f.gi_temp ? f.gi_temp+'°C' : '—') + '</td>' +
        '<td style="padding:6px 8px"><span style="background:' + (isAcc?'#dcfce7':'#fee2e2') + ';color:' + (isAcc?'#166534':'#991b1b') + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + (isAcc?'Accepted':'Rejected') + '</span></td>' +
        '<td style="padding:6px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif">' + (f.gi_signed_by||'—') + '</td>' +
        '</tr>';
      if (f.gi_notes) {
        giRows += '<tr><td colspan="5" style="padding:0 8px 8px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">↳ ' + f.gi_notes + '</td></tr>';
      }
    });
  }
  var giSection = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
    sectionHeader('&#x1F4E6; Goods In') +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;font-size:10px;font-family:Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b">Supplier</th>' +
    '<th style="text-align:left;padding:6px 8px;font-size:10px;font-family:Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b">Type</th>' +
    '<th style="text-align:left;padding:6px 8px;font-size:10px;font-family:Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b">Temp</th>' +
    '<th style="text-align:left;padding:6px 8px;font-size:10px;font-family:Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b">Outcome</th>' +
    '<th style="text-align:left;padding:6px 8px;font-size:10px;font-family:Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #1e293b">Signed By</th>' +
    '</tr></thead><tbody>' + giRows + '</tbody></table></td></tr></table>';

  // ── Tasks section ─────────────────────────────────
  const doneCount = tasks.filter(t => t.done).length;
  const taskRows = tasks.length === 0
    ? '<tr><td colspan="2" style="padding:8px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No tasks scheduled today</td></tr>'
    : tasks.map(r => {
        const icon = r.done ? '<span style="color:#16a34a;font-weight:600">✓</span>' : '';
        const taskStyle = r.done ? 'color:#334155' : 'color:#94a3b8;font-style:italic';
        const rightCell = r.done
          ? '<span style="color:#94a3b8;font-size:12px;font-family:Arial,sans-serif">' + r.doneBy + '</span>'
          : '<span style="background:#f1f5f9;color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:Arial,sans-serif">Not done</span>';
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:5px 0;font-size:13px;font-family:Arial,sans-serif;' + taskStyle + '">' + icon + (r.done ? ' ' : '') + r.label + '</td><td style="text-align:right">' + rightCell + '</td></tr>';
      }).join('');

  const taskSection = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
    '<tr><td style="padding:14px 24px 4px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Tasks &nbsp;<span style="font-weight:400;color:#cbd5e1">' + doneCount + ' / ' + tasks.length + ' complete</span></p></td></tr>' +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0">' + taskRows + '</table></td></tr></table>';

  // ── Assemble ──────────────────────────────────────
  const sheetsUrl = getSheetsUrl();

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
  '<style>@media print{body{background:#fff!important}table{page-break-inside:avoid}tr{page-break-inside:avoid;page-break-after:auto}.section-block{page-break-inside:avoid}}</style>' +
  '</head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">' +
  '<div style="background:#f1f5f9;padding:24px 16px">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto"><tr><td>' +

  // Header
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:8px 8px 0 0;overflow:hidden">' +
  '<tr><td style="padding:20px 24px"><p style="margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4a6080;font-family:Arial,sans-serif">Food Safety Report</p>' +
  '<p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#e6edf3;font-family:Arial,sans-serif">' + name + '</p>' +
  '<p style="margin:4px 0 0;font-size:13px;color:#7d8da8;font-family:Arial,sans-serif">' + dayLabel + ' &nbsp;·&nbsp; Generated 23:59</p></td>' +
  '<td style="padding:20px 24px;text-align:right;vertical-align:middle">' + badgeHtml + '</td></tr>' +
  (anyMissing
  ? '<tr><td colspan="2" style="padding:0 24px 16px"><p style="margin:0;font-size:11px;color:#ef4444;font-family:Arial,sans-serif">' + submittedChecks + ' of ' + expectedCheckCount + ' checks submitted &nbsp;&middot;&nbsp; score excluded</p></td></tr>'
  : pct !== null ? '<tr><td colspan="2" style="padding:0 24px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
  '<td style="background:' + headerBg + ';border-radius:3px;height:6px"><div style="width:' + barWidth + '%;height:6px;background:' + pctColor + ';border-radius:3px"></div></td>' +
  '<td style="width:110px;padding-left:12px;font-size:11px;color:' + pctColor + ';font-family:Arial,sans-serif;white-space:nowrap">' + submittedChecks + '/' + expectedCheckCount + ' submissions</td>' +
  '</tr></table></td></tr>' : '') +
  '</table>' +

  // Overview
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
  sectionHeader('Overview') +
  '<tr><td style="padding:8px 24px 16px"><table width="100%" cellpadding="0" cellspacing="0">' + overviewRows + cleaningOverviewRow + '</table></td></tr></table>' +

  // Checks
  buildCheckSection('Opening Checks', opening) +
  buildCheckSection('Closing Checks', closing) +
  (settings.cleaningEnabled && cleaning.length ? buildCheckSection('&#x1F9F9; Cleaning Schedule', cleaning) : '') +

  // Temps, Probes, Goods In, Tasks
  tempSection + probeSection + giSection + taskSection +

  // Footer
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:0 0 8px 8px;margin-top:2px">' +
  '<tr><td style="padding:16px 24px">' +
  (sheetsUrl ? '<p style="margin:0;font-size:12px;color:#4a6080;font-family:Arial,sans-serif">Full records &nbsp;·&nbsp; <a href="' + sheetsUrl + '" style="color:#60a5fa;text-decoration:none">Open in Google Sheets</a></p>' : '') +
  '<p style="margin:6px 0 0;font-size:11px;color:#334a60;font-family:Arial,sans-serif">Sent by SafeChecks &nbsp;·&nbsp; To manage recipients, open Settings in the app</p>' +
  '</td></tr></table>' +

  '</td></tr></table></div></body></html>';
}

// ── Section header helper ─────────────────────────────
function sectionHeader(title) {
  return '<tr><td style="padding:14px 24px 4px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">' + title + '</p></td></tr>';
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
  function pctColor(p) { return p >= 90 ? '#22c55e' : p >= 70 ? '#f59e0b' : '#ef4444'; }
  function pctBg(p)    { return p >= 90 ? '#0d3320' : p >= 70 ? '#2d1c07' : '#2d0a0a'; }

  // ── Daily overview grid ──────────────────────────
  function equipCell(date) {
    var recs = temps.filter(function(r) { return r.date === date; });
    if (!recs.length) return '<td style="text-align:center;padding:5px 4px;font-size:12px;color:#4a6080">—</td>';
    var fails  = recs.filter(function(r) { return r.status==='FAIL'||r.status==='WARNING'; }).length;
    var passes = recs.length - fails;
    var hasFail = fails > 0;
    var icon = hasFail ? '⚠' : '✓';
    var iconColor = hasFail ? '#f59e0b' : '#22c55e';
    var countHtml = hasFail
      ? '<span style="font-size:9px;display:block"><span style="color:#22c55e">' + passes + '✓</span> <span style="color:#ef4444">' + fails + '✗</span></span>'
      : '<span style="font-size:9px;display:block;color:#7d8da8">' + recs.length + '</span>';
    return '<td style="text-align:center;padding:5px 4px;font-size:13px;color:' + iconColor + '">' + icon + countHtml + '</td>';
  }

  function simpleCell(date, type, dept) {
    var recs = [];
    if (type === 'opening') recs = opening.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type === 'closing') recs = closing.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type === 'cleaning') recs = cleaning.filter(function(r) { return r.date===date && r.dept===dept; });
    else if (type === 'probe')   recs = probes.filter(function(r) { return r.date===date; });
    else if (type === 'goodsin') recs = goodsIn.filter(function(r) { return r.date===date; });
    if (!recs.length) return '<td style="text-align:center;padding:5px 4px;font-size:13px;color:#4a6080">—</td>';
    var hasFail = false;
    if (type==='opening'||type==='closing'||type==='cleaning') {
      recs.forEach(function(r) { Object.entries(r.fields||{}).forEach(function(e) { if (e[1]==='No') hasFail=true; }); });
    } else if (type==='probe') {
      hasFail = recs.some(function(r) { return r.status==='FAIL'; });
    } else if (type==='goodsin') {
      hasFail = recs.some(function(r) { return (r.fields||{}).gi_outcome==='rejected'||(r.fields||{}).gi_temp_status==='FAIL'; });
    }
    var icon = hasFail ? '⚠' : '✓';
    var color = hasFail ? '#f59e0b' : '#22c55e';
    var count = (type==='probe'||type==='goodsin') ? '<span style="font-size:9px;display:block;color:#7d8da8">' + recs.length + '</span>' : '';
    return '<td style="text-align:center;padding:5px 4px;font-size:13px;color:' + color + '">' + icon + count + '</td>';
  }

  const gridColHeaders = weekDates.map(function(date) {
    const d = new Date(date + 'T12:00:00');
    return '<th style="text-align:center;padding:5px 4px;font-size:11px;color:#4a6080;min-width:36px">' + DAY_ABBR[d.getDay()] + '<br><span style="font-weight:400;font-size:9px">' + d.getDate() + '/' + (d.getMonth()+1) + '</span></th>';
  }).join('');

  const gridDefs = [
    ['opening',     'kitchen', '&#x1F373; Opening'],
    ['opening',     'foh',     '&#x1F37D; Opening'],
    ['closing',     'kitchen', '&#x1F373; Closing'],
    ['closing',     'foh',     '&#x1F37D; Closing'],
    ['equipment',   null,      '&#x1F321; Equipment'],
    ['probe',       null,      '&#x1F356; Probes'],
    ['goodsin',     null,      '&#x1F4E6; Goods In'],
  ].concat(settings.cleaningEnabled ? [
    ['cleaning',    'kitchen', '&#x1F9F9; Cleaning K'],
    ['cleaning',    'foh',     '&#x1F9F9; Cleaning F'],
  ] : []);
  const gridRows = gridDefs.map(function(row) {
    const cells = weekDates.map(function(date) {
      return row[0] === 'equipment' ? equipCell(date) : simpleCell(date, row[0], row[1]);
    }).join('');
    return '<tr><td style="padding:5px 8px;font-size:12px;color:#7d8da8;font-family:Arial,sans-serif;white-space:nowrap">' + row[2] + '</td>' + cells + '</tr>';
  }).join('');

  const gridHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif">' +
    '<tr><th style="text-align:left;padding:5px 8px;font-size:10px;color:#4a6080;text-transform:uppercase;letter-spacing:.05em">Check</th>' +
    gridColHeaders + '</tr>' + gridRows + '</table>';

  // ── Compliance — dept cards ───────────────────────

  // Equipment: batch_id groups; 2 expected per trading day
  function equipBatches(dept, date) {
    var recs = temps.filter(function(r) { return r.date===date && (!dept || r.dept===dept); });
    var batches = {};
    recs.forEach(function(r) { var k = r.batch_id || r.location + r.time; batches[k] = true; });
    return Math.min(Object.keys(batches).length, 2);
  }

  // Probe count for a date (kitchen only)
  function probeOnDate(date) {
    return probes.some(function(r) { return r.date===date; }) ? 1 : 0;
  }

  function complianceRow(label, actual, expected) {
    if (expected === 0) {
      return '<tr><td style="padding:5px 16px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + label + '</td>' +
             '<td style="padding:5px 16px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif;text-align:right">N/A</td></tr>';
    }
    var p = Math.round(actual/expected*100);
    var c = pctColor(p);
    var barBg = '<div style="display:inline-block;width:60px;height:5px;background:#e2e8f0;border-radius:3px;vertical-align:middle;position:relative">' +
                '<div style="position:absolute;left:0;top:0;width:' + Math.round(p*60/100) + 'px;height:5px;background:' + c + ';border-radius:3px"></div></div>';
    return '<tr><td style="padding:5px 16px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + label + '</td>' +
           '<td style="padding:5px 16px;text-align:right;white-space:nowrap">' + barBg +
           '&nbsp;<span style="font-size:12px;font-weight:700;color:' + c + ';font-family:Arial,sans-serif">' + p + '%</span>' +
           '&nbsp;<span style="font-size:11px;color:#94a3b8;font-family:Arial,sans-serif">' + actual + '/' + expected + '</span></td></tr>';
  }

  function deptCard(label, icon, color, openAct, openExp, closeAct, closeExp, equipAct, equipExp, probeAct, probeExp, cleanAct, cleanExp, missingDays, tradingDays) {
    var cats = [{a:openAct,e:openExp},{a:closeAct,e:closeExp},{a:equipAct,e:equipExp}];
    if (probeExp > 0) cats.push({a:probeAct,e:probeExp});
    if (cleanExp > 0) cats.push({a:cleanAct,e:cleanExp});
    var totalA = 0, totalE = 0;
    cats.forEach(function(c) { if (c.e > 0) { totalA += c.a; totalE += c.e; } });
    var overall = totalE > 0 ? Math.round(totalA/totalE*100) : 100;
    var oc = pctColor(overall);
    var barW = Math.round(overall * 120 / 100);
    // Missing days caveat — shown when any trading day lacked opening+closing submission
    var missingNoteHtml = '';
    if (missingDays > 0) {
      var daysWithChecks = tradingDays - missingDays;
      missingNoteHtml = '<tr><td colspan="2" style="padding:2px 16px 10px">' +
        '<p style="margin:0;font-size:11px;color:#f59e0b;font-family:Arial,sans-serif">' +
        '&#x26A0; Score based on ' + daysWithChecks + ' of ' + tradingDays + ' trading day' + (tradingDays!==1?'s':'') +
        ' &middot; ' + missingDays + ' day' + (missingDays!==1?'s':'') + ' missing opening/closing submissions' +
        '</p></td></tr>';
    }
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:8px">' +
      '<tr style="background:#f8fafc"><td style="padding:10px 16px"><span style="font-size:14px;font-weight:700;color:' + color + ';font-family:Arial,sans-serif">' + icon + ' ' + label + '</span></td>' +
      '<td style="padding:10px 16px;text-align:right">' +
      '<div style="display:inline-block;width:120px;height:6px;background:#e2e8f0;border-radius:3px;vertical-align:middle;position:relative">' +
      '<div style="position:absolute;left:0;top:0;width:' + barW + 'px;height:6px;background:' + oc + ';border-radius:3px"></div></div>' +
      '&nbsp;<span style="font-size:18px;font-weight:700;color:' + oc + ';font-family:Arial,sans-serif;vertical-align:middle">' + overall + '%</span></td></tr>' +
      complianceRow('Opening Checks', openAct, openExp) +
      complianceRow('Closing Checks', closeAct, closeExp) +
      complianceRow('Equipment Checks', equipAct, equipExp) +
      (probeExp > 0 ? complianceRow('Food Probes', probeAct, probeExp) : '') +
      (cleanExp > 0 ? complianceRow('Cleaning Schedule', cleanAct, cleanExp) : '') +
      missingNoteHtml +
      '</table>';
  }

  // Count trading days per dept using isTradingAS — same logic as the PWA
  var kTradingDays = 0, fTradingDays = 0;
  weekDates.forEach(function(date) {
    if (isTradingAS('kitchen', settings, date)) kTradingDays++;
    if (isTradingAS('foh',     settings, date)) fTradingDays++;
  });

  // Submission-level compliance: 1 point per expected submission per trading day
  var kOpenAct = 0, kOpenExp = kTradingDays;
  var kCloseAct = 0, kCloseExp = kTradingDays;
  var fOpenAct = 0, fOpenExp = fTradingDays;
  var fCloseAct = 0, fCloseExp = fTradingDays;
  weekDates.forEach(function(date) {
    if (isTradingAS('kitchen', settings, date)) {
      if (opening.some(function(r) { return r.date===date && r.dept==='kitchen'; })) kOpenAct++;
      if (closing.some(function(r) { return r.date===date && r.dept==='kitchen'; })) kCloseAct++;
    }
    if (isTradingAS('foh', settings, date)) {
      if (opening.some(function(r) { return r.date===date && r.dept==='foh'; })) fOpenAct++;
      if (closing.some(function(r) { return r.date===date && r.dept==='foh'; })) fCloseAct++;
    }
  });

  var kEquipAct = 0, kEquipExp = kTradingDays * 2;
  var fEquipAct = 0, fEquipExp = fTradingDays * 2;
  var kProbeAct = 0, kProbeExp = kTradingDays;
  var kCleanAct = 0, kCleanExp = settings.cleaningEnabled ? kTradingDays : 0;
  var fCleanAct = 0, fCleanExp = settings.cleaningEnabled ? fTradingDays : 0;
  weekDates.forEach(function(date) {
    kEquipAct += equipBatches('kitchen', date);
    fEquipAct += equipBatches('foh', date);
    kProbeAct += probeOnDate(date);
    if (settings.cleaningEnabled) {
      if (cleaning.some(function(r) { return r.date===date && r.dept==='kitchen'; })) kCleanAct++;
      if (cleaning.some(function(r) { return r.date===date && r.dept==='foh'; }))     fCleanAct++;
    }
  });

  // ── Missing day detection ─────────────────────────
  // A day counts as "complete" only if BOTH opening and closing were submitted.
  // Used to caveat compliance scores in the dept cards and show an
  // incomplete week banner. Score still shows — based on submitted days only.
  var kDaysWithChecks = 0, fDaysWithChecks = 0;
  weekDates.forEach(function(date) {
    if (isTradingAS('kitchen', settings, date)) {
      var kOpen  = opening.some(function(r) { return r.date===date && r.dept==='kitchen'; });
      var kClose = closing.some(function(r) { return r.date===date && r.dept==='kitchen'; });
      if (kOpen && kClose) kDaysWithChecks++;
    }
    if (isTradingAS('foh', settings, date)) {
      var fOpen  = opening.some(function(r) { return r.date===date && r.dept==='foh'; });
      var fClose = closing.some(function(r) { return r.date===date && r.dept==='foh'; });
      if (fOpen && fClose) fDaysWithChecks++;
    }
  });
  var kMissingDays = kTradingDays - kDaysWithChecks;
  var fMissingDays = fTradingDays - fDaysWithChecks;

  const complianceHtml =
    deptCard('Kitchen', '&#x1F373;', '#f59e0b', kOpenAct, kOpenExp, kCloseAct, kCloseExp, kEquipAct, kEquipExp, kProbeAct, kProbeExp, kCleanAct, kCleanExp, kMissingDays, kTradingDays) +
    deptCard('Front of House', '&#x1F37D;', '#3b82f6', fOpenAct, fOpenExp, fCloseAct, fCloseExp, fEquipAct, fEquipExp, 0, 0, fCleanAct, fCleanExp, fMissingDays, fTradingDays);

  // ── Weekly management review ──────────────────────
  var reviewHtml = '';
  if (!weeklyRec) {
    reviewHtml = '<tr><td style="padding:10px 24px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No weekly review submitted</td></tr>';
  } else {
    const f       = weeklyRec.fields || {};
    const rating  = f.weekly_rating    || '';
    const issues  = f.weekly_issues    || '';
    const actions = f.weekly_actions   || '';
    const signed  = f.weekly_signed_by || '';
    const rc = rating==='Good' ? '#22c55e' : rating==='Satisfactory' ? '#f59e0b' : rating==='Needs Improvement' ? '#ef4444' : '#94a3b8';

    // Build checklist table from settings checks
    var checklistHtml = '';
    var mgmtChecks = (settings.checks && settings.checks.mgmt && settings.checks.mgmt.weekly) ? settings.checks.mgmt.weekly : [];
    if (mgmtChecks.length > 0) {
      var checkRows = mgmtChecks.filter(function(c) { return c.enabled !== false; }).map(function(c, i) {
        var answer = f[c.id];
        if (answer !== 'Yes' && answer !== 'No') return '';
        var ansColor = answer === 'Yes' ? '#22c55e' : '#ef4444';
        var rowBg = i % 2 === 0 ? '' : 'background:#fafafa';
        return '<tr style="border-top:1px solid #f1f5f9;' + rowBg + '">' +
          '<td style="padding:7px 12px;font-size:12px;color:#334155;font-family:Arial,sans-serif">' + c.label + '</td>' +
          '<td style="padding:7px 12px;text-align:right;white-space:nowrap"><span style="font-size:12px;font-weight:700;color:' + ansColor + ';font-family:Arial,sans-serif">' + answer + '</span></td>' +
          '</tr>';
      }).join('');

      if (checkRows) {
        checklistHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px">' +
          '<tr style="background:#f8fafc">' +
          '<td style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-family:Arial,sans-serif">Checklist Item</td>' +
          '<td style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-family:Arial,sans-serif;text-align:right;width:50px">Result</td>' +
          '</tr>' + checkRows + '</table>';
      }
    }

    reviewHtml = '<tr><td style="padding:8px 24px 14px">' +
      // Rating badge + sign-off on same line
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>' +
      '<td>' + (rating ? '<div style="display:inline-block;border:2px solid ' + rc + ';color:' + rc + ';border-radius:8px;padding:5px 14px;font-size:13px;font-weight:700;font-family:Arial,sans-serif">' + rating + '</div>' : '') + '</td>' +
      '<td style="text-align:right;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + (signed ? 'Signed: ' + signed + (weeklyRec.time ? ' &middot; ' + weeklyRec.time : '') : '') + '</td>' +
      '</tr></table>' +
      // Full checklist
      checklistHtml +
      // Issues & Actions
      (issues  ? '<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#94a3b8;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em">Issues</p><p style="margin:0 0 12px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + issues + '</p>' : '') +
      (actions ? '<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#94a3b8;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em">Actions</p><p style="margin:0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + actions + '</p>' : '') +
      '</td></tr>';
  }
  const reviewSection = sectionHeader('&#x1F4CB; Weekly Management Review') + reviewHtml;

  // ── Failed checks ─────────────────────────────────
  // Build a label lookup from settings so we show the real check name, not the raw ID
  var checkLabelMap = {};
  if (settings && settings.checks) {
    Object.values(settings.checks).forEach(function(dept) {
      if (dept && typeof dept === 'object') {
        Object.values(dept).forEach(function(arr) {
          if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id && c.label) checkLabelMap[c.id] = c.label; });
        });
      }
    });
  }
  var failedRows = '';
  opening.concat(closing).forEach(function(r) {
    var type = opening.indexOf(r) >= 0 ? 'Opening' : 'Closing';
    var dept = r.dept === 'kitchen' ? '&#x1F373; Kitchen' : '&#x1F37D; FOH';
    var signed = r.signedBy || '&#8212;';
    Object.entries(r.fields||{}).forEach(function(e) {
      if (e[1] !== 'No') return;
      var label = checkLabelMap[e[0]] || e[0].replace(/_/g,' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      failedRows += '<tr style="border-bottom:1px solid #fee2e2">' +
        '<td style="padding:6px 8px;font-size:12px;color:#991b1b;font-weight:600;font-family:Arial,sans-serif">&#x2717; ' + label + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + dept + ' ' + type + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + signed + '</td></tr>';
    });
  });
  const failedSection = failedRows
    ? sectionHeader('&#x26A0; Failed Checks') +
      '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fef2f2;border-radius:6px">' +
      '<tr style="background:#fee2e2"><td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Check</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Dept</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Day</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Signed</td></tr>' +
      failedRows + '</table></td></tr>'
    : '';

  // ── Temperature breaches ──────────────────────────
  var breachRows = '';
  temps.filter(function(r) { return r.status==='FAIL'; }).forEach(function(r) {
    breachRows += '<tr style="border-bottom:1px solid #fee2e2">' +
      '<td style="padding:6px 8px;font-size:13px;font-weight:600;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
      '<td style="padding:6px 8px;font-size:13px;font-weight:700;color:#ef4444;font-family:monospace">' + (r.temp ? r.temp+'°C' : '—') + '</td>' +
      '<td style="padding:6px 8px"><span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">FAIL</span></td>' +
      '<td style="padding:6px 8px;font-size:11px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + (r.time ? ' · ' + fmtTime(r.time) : '') + '</td>' +
      '<td style="padding:6px 8px;font-size:11px;color:#f59e0b;font-family:Arial,sans-serif;font-style:italic">' + (r.action && r.action!=='See notes' ? '↳ ' + r.action : '') + '</td></tr>';
  });
  const breachSection = breachRows
    ? sectionHeader('&#x1F6A8; Temperature Breaches') +
      '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fef2f2;border-radius:6px">' +
      '<tr style="background:#fee2e2"><td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Equipment</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Reading</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Status</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">When</td>' +
      '<td style="font-size:10px;color:#991b1b;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Action</td></tr>' +
      breachRows + '</table></td></tr>'
    : '';

  // ── Full equipment log ─────────────────────────────
  var tempRows = '';
  if (!temps.length) {
    tempRows = '<tr><td colspan="5" style="padding:10px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No equipment checks this week</td></tr>';
  } else {
    temps.forEach(function(r) {
      const bg = r.status==='OK' ? '#dcfce7' : r.status==='WARNING' ? '#fef3c7' : '#fee2e2';
      const fg = r.status==='OK' ? '#166534' : r.status==='WARNING' ? '#92400e' : '#991b1b';
      const rowBg = r.status==='FAIL' ? 'background:#fef2f2' : r.status==='WARNING' ? 'background:#fffbeb' : '';
      const action = r.action && r.action!=='None required' && r.action!=='See notes' ? r.action : '';
      tempRows += '<tr style="border-bottom:1px solid #f1f5f9;' + rowBg + '">' +
        '<td style="padding:6px 8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.location + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;font-weight:600;color:#334155;font-family:monospace">' + (r.temp ? r.temp+'°C' : '—') + '</td>' +
        '<td style="padding:6px 8px"><span style="background:' + bg + ';color:' + fg + ';padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + r.status + '</span></td>' +
        '<td style="padding:6px 8px;font-size:11px;color:#f59e0b;font-family:Arial,sans-serif;font-style:italic">' + (action ? '↳ ' + action : '—') + '</td></tr>';
    });
  }
  const tempSection = sectionHeader('&#x1F321; Equipment Checks · ' + temps.length + ' reading' + (temps.length!==1?'s':'')) +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Day</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Equipment</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Reading</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Status</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Action</td></tr>' +
    tempRows + '</table></td></tr>';

  // ── Food probe log ────────────────────────────────
  var probeRows = '';
  if (!probes.length) {
    probeRows = '<tr><td colspan="4" style="padding:10px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No food probes this week</td></tr>';
  } else {
    probes.forEach(function(r) {
      const pass = r.status === 'PASS';
      const bg = pass ? '#dcfce7' : '#fee2e2';
      const fg = pass ? '#166534' : '#991b1b';
      const rowBg = pass ? '' : 'background:#fef2f2';
      const coolingHtml = r.cooling ? '<p style="margin:3px 0 0;font-size:11px;color:#60a5fa;font-family:Arial,sans-serif">&#x2744; Cooled for ' + r.cooling + '</p>' : '';
      probeRows += '<tr style="border-bottom:1px solid #f1f5f9;' + rowBg + '">' +
        '<td style="padding:6px 8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.product + coolingHtml + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;font-weight:600;font-family:monospace;color:#334155">' + (r.temp ? r.temp+'°C' : '—') + '</td>' +
        '<td style="padding:6px 8px"><span style="background:' + bg + ';color:' + fg + ';padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + r.status + '</span>' +
        (!pass && r.action ? '<p style="margin:3px 0 0;font-size:11px;color:#f59e0b;font-family:Arial,sans-serif;font-style:italic">↳ ' + r.action + '</p>' : '') + '</td></tr>';
    });
  }
  const probeSection = sectionHeader('&#x1F356; Food Probes · ' + (probes.length || 'none')) +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Day</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Product</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Core Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Result</td></tr>' +
    probeRows + '</table></td></tr>';

  // ── Goods In ──────────────────────────────────────
  var giRows = '';
  if (!goodsIn.length) {
    giRows = '<tr><td colspan="5" style="padding:10px 8px;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No deliveries this week</td></tr>';
  } else {
    goodsIn.forEach(function(r) {
      const f = r.fields || {};
      const isAcc = f.gi_outcome === 'accepted';
      const typeIcon = f.gi_type === 'frozen' ? '&#x2744;' : '&#x1F33F;';
      giRows += '<tr style="border-bottom:1px solid #f1f5f9">' +
        '<td style="padding:6px 8px;font-size:12px;color:#64748b;font-family:Arial,sans-serif">' + dayStr(r.date) + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;font-weight:600;font-family:Arial,sans-serif">' + (f.gi_supplier||'—') + '</td>' +
        '<td style="padding:6px 8px;font-size:12px;font-family:Arial,sans-serif;color:#94a3b8">' + typeIcon + ' ' + (f.gi_type||'') + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;font-family:monospace;font-weight:600">' + (f.gi_temp ? f.gi_temp+'°C' : '—') + '</td>' +
        '<td style="padding:6px 8px"><span style="background:' + (isAcc?'#dcfce7':'#fee2e2') + ';color:' + (isAcc?'#166534':'#991b1b') + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + (isAcc?'Accepted':'Rejected') + '</span></td></tr>';
      if (f.gi_notes) giRows += '<tr><td colspan="5" style="padding:0 8px 6px;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">↳ ' + f.gi_notes + '</td></tr>';
    });
  }
  const giSection = sectionHeader('&#x1F4E6; Goods In · ' + (goodsIn.length || 'none')) +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr style="background:#f8fafc">' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Day</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Supplier</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Type</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Temp</td>' +
    '<td style="font-size:10px;color:#94a3b8;font-family:Arial,sans-serif;padding:4px 8px;font-weight:600;text-transform:uppercase">Outcome</td></tr>' +
    giRows + '</table></td></tr>';

  // ── Tasks ─────────────────────────────────────────
  const doneCount = tasks.filter(function(t) { return t.done; }).length;
  var taskRows = '';
  if (!tasks.length) {
    taskRows = '<tr><td colspan="3" style="padding:10px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">No tasks scheduled this week</td></tr>';
  } else {
    taskRows = tasks.map(function(t) {
      const d = new Date((t.date||'') + 'T12:00:00');
      const ds = t.date ? DAY_ABBR[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth()+1) : '';
      return '<tr style="border-bottom:1px solid #f1f5f9">' +
        '<td style="padding:5px 0;font-size:12px;color:#64748b;font-family:Arial,sans-serif;width:60px">' + ds + '</td>' +
        '<td style="padding:5px 8px;font-size:13px;color:' + (t.done?'#334155':'#94a3b8') + ';font-family:Arial,sans-serif;font-style:' + (t.done?'normal':'italic') + '">' + (t.done?'✓ ':'') + t.label + '</td>' +
        '<td style="text-align:right"><span style="font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + (t.done ? (t.doneBy||'') : '<span style="background:#f1f5f9;color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:11px">Not done</span>') + '</span></td></tr>';
    }).join('');
  }
  const taskSection = sectionHeader('&#x2705; Tasks · ' + doneCount + ' / ' + tasks.length + ' complete') +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0">' + taskRows + '</table></td></tr>';

  // ── Assemble ──────────────────────────────────────
  const sheetsUrl = getSheetsUrl();

  // Incomplete week banner — must be computed before the return statement
  var totalMissingDays = kMissingDays + fMissingDays;
  var incompleteBannerHtml = '';
  if (totalMissingDays > 0) {
    incompleteBannerHtml =
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#2d1c07;border-radius:8px;margin-bottom:2px">' +
      '<tr><td style="padding:12px 24px">' +
      '<p style="margin:0;font-size:13px;font-weight:700;color:#f59e0b;font-family:Arial,sans-serif">&#x26A0; Incomplete week</p>' +
      '<p style="margin:4px 0 0;font-size:12px;color:#d97706;font-family:Arial,sans-serif">' +
      totalMissingDays + ' trading day' + (totalMissingDays!==1?'s':'') + ' missing opening/closing submissions. ' +
      'Compliance scores in the cards below are based on submitted days only.' +
      '</p></td></tr></table>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">' +
  incompleteBannerHtml +
  '<div style="background:#f1f5f9;padding:24px 16px">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto"><tr><td>' +

  // Header
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:8px 8px 0 0">' +
  '<tr><td style="padding:20px 24px"><p style="margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4a6080;font-family:Arial,sans-serif">Weekly Food Safety Report</p>' +
  '<p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#e6edf3;font-family:Arial,sans-serif">' + name + '</p>' +
  '<p style="margin:4px 0 0;font-size:13px;color:#7d8da8;font-family:Arial,sans-serif">Week: ' + weekLabel + '</p>' +
  '</td></tr></table>' +

  // Daily overview
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
  sectionHeader('Daily Overview') +
  '<tr><td style="padding:4px 24px 14px">' + gridHtml + '</td></tr></table>' +

  // Compliance
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
  sectionHeader('Compliance') +
  '<tr><td style="padding:8px 24px 14px">' + complianceHtml + '</td></tr></table>' +

  // Weekly review (directly after compliance)
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + reviewSection + '</table>' +

  // Failed checks (only if any)
  (failedRows ? '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + failedSection + '</table>' : '') +

  // Temperature breaches (only if any)
  (breachRows ? '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + breachSection + '</table>' : '') +

  // Full equipment log
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + tempSection + '</table>' +

  // Food probes
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + probeSection + '</table>' +

  // Goods In + Tasks
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + giSection + '</table>' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' + taskSection + '</table>' +

  // Footer
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:0 0 8px 8px;margin-top:2px">' +
  '<tr><td style="padding:16px 24px">' +
  (sheetsUrl ? '<p style="margin:0;font-size:12px;color:#4a6080;font-family:Arial,sans-serif">Full records &nbsp;·&nbsp; <a href="' + sheetsUrl + '" style="color:#60a5fa;text-decoration:none">Open in Google Sheets</a></p>' : '') +
  '<p style="margin:6px 0 0;font-size:11px;color:#334a60;font-family:Arial,sans-serif">Sent by SafeChecks &nbsp;·&nbsp; On-demand weekly report</p>' +
  '</td></tr></table>' +

  '</td></tr></table></div></body></html>';
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
