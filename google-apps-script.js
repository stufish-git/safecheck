/**
 * ═══════════════════════════════════════════════════════
 *  SAFECHECKS — Google Apps Script v5.2
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
    '✅ SafeChecks v5.2 — All sheets recreated!\n\n' +
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
  SpreadsheetApp.getUi().alert('✅ Daily email trigger installed — will fire at 23:59 every night.');
}

function removeDailyEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailySummary') ScriptApp.deleteTrigger(t);
  });
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
  const tasks      = getTodayTasks(ss, today, settings);

  // ── Determine subject prefix ────────────────────────
  const depts = ['kitchen', 'foh'];
  const hasAnyMissing = depts.some(d => {
    const noOpen  = !opening.find(r  => r.dept === d);
    const noClose = !closing.find(r => r.dept === d);
    return noOpen || noClose;
  });
  const hasAnyFail = [...temps, ...probes].some(r =>
    r.status === 'FAIL' || r.status === 'WARNING');
  const hasCheckFail = [...opening, ...closing].some(r => r.failCount > 0);

  const prefix = hasAnyMissing ? '⛔' : (hasAnyFail || hasCheckFail) ? '⚠' : '✓';
  const subject = prefix + ' Daily Summary — ' + name + ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEE d MMM yyyy");

  // ── Build HTML ──────────────────────────────────────
  const html = buildEmailHtml(name, dayLabel, today, opening, closing, temps, probes, tasks, depts, settings);

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
function buildEmailHtml(name, dayLabel, today, opening, closing, temps, probes, tasks, depts, settings) {
  const DEPT_LABELS = { kitchen: '🍳 Kitchen', foh: '🍽 Front of House' };

  // Compliance score
  let totalChecks = 0, passedChecks = 0;
  [...opening, ...closing].forEach(r => { totalChecks += r.total; passedChecks += r.passed; });
  const pct = totalChecks > 0 ? Math.round(passedChecks / totalChecks * 100) : null;

  const anyMissing = depts.some(d => !opening.find(r => r.dept === d) || !closing.find(r => r.dept === d));
  const headerBorder = anyMissing ? '#ef4444' : pct === null ? '#4a5568' : pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const headerBg     = anyMissing ? '#2d0a0a' : pct === null ? '#1a2332' : pct >= 90 ? '#0d3320' : pct >= 70 ? '#2d1c07' : '#2d0a0a';
  const pctColor     = headerBorder;
  const barWidth     = pct !== null ? pct : 0;

  const badgeHtml = anyMissing
    ? '<div style="display:inline-block;background:#2d0a0a;border:2px solid #ef4444;border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:14px;font-weight:700;color:#ef4444;font-family:Arial,sans-serif;line-height:1.3">Checks<br>Missing</p></div>'
    : pct !== null
      ? '<div style="display:inline-block;background:' + headerBg + ';border:2px solid ' + pctColor + ';border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:22px;font-weight:700;color:' + pctColor + ';font-family:Arial,sans-serif;line-height:1">' + pct + '%</p><p style="margin:2px 0 0;font-size:10px;color:' + pctColor + ';font-family:Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;opacity:.8">Compliance</p></div>'
      : '<div style="display:inline-block;background:#1a2332;border:2px solid #4a5568;border-radius:8px;padding:8px 16px;text-align:center"><p style="margin:0;font-size:11px;color:#7d8da8;font-family:Arial,sans-serif">No checks<br>recorded</p></div>';

  // ── Overview section ──────────────────────────────
  const overviewRows = depts.map(d => {
    const op = opening.find(r => r.dept === d);
    const cl = closing.find(r => r.dept === d);
    const missing = !op || !cl;
    const deptFail = (op && op.failCount > 0) || (cl && cl.failCount > 0);
    const tempFail = temps.filter(r => r.dept === d).some(r => r.status === 'FAIL' || r.status === 'WARNING');

    let pill, bg, color;
    if (missing)          { pill = '⛔ ' + (!op ? 'Opening' : '') + (!op && !cl ? ' & ' : '') + (!cl ? 'Closing' : '') + ' missing'; bg = '#fee2e2'; color = '#991b1b'; }
    else if (deptFail || tempFail) { pill = '⚠ Issues recorded · ' + pct + '%'; bg = '#fef3c7'; color = '#92400e'; }
    else                  { pill = '✓ All clear · 100%'; bg = '#dcfce7'; color = '#166534'; }

    return '<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;font-family:Arial,sans-serif"><strong>' + DEPT_LABELS[d] + '</strong></td>' +
      '<td style="text-align:right"><span style="background:' + bg + ';color:' + color + ';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">' + pill + '</span></td></tr>';
  }).join('');

  // ── Opening/closing check sections ────────────────
  function buildCheckSection(title, records) {
    const rows = depts.map(d => {
      const rec = records.find(r => r.dept === d);
      if (!rec) {
        return '<tr><td style="padding:5px 0;font-size:13px;color:#94a3b8;font-family:Arial,sans-serif;font-style:italic">' + DEPT_LABELS[d] + '</td>' +
          '<td style="text-align:right"><span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:Arial,sans-serif">Not submitted</span></td></tr>';
      }
      const scoreColor = rec.failCount > 0 ? '#d97706' : '#16a34a';
      let failHtml = '';
      if (rec.failCount > 0 && rec.failedLabels.length) {
        const items = rec.failedLabels.map(l => '<p style="margin:0 0 3px;font-size:12px;color:#92400e;font-family:Arial,sans-serif">✗ &nbsp;' + l + '</p>').join('');
        const noteHtml = rec.notes ? '<p style="margin:6px 0 0;font-size:11px;color:#a16207;font-family:Arial,sans-serif;font-style:italic">Note: ' + rec.notes + '</p>' : '';
        failHtml = '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;background:#fffbeb;border-radius:4px;border:1px solid #fde68a"><tr><td style="padding:8px 10px">' + items + noteHtml + '</td></tr></table>';
      }
      return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:5px 0"><p style="margin:0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + DEPT_LABELS[d] +
        ' &nbsp;<span style="color:' + scoreColor + ';font-size:12px;font-weight:600">' + rec.passed + '/' + rec.total + '</span>' +
        ' &nbsp;<span style="color:#94a3b8;font-size:12px">' + rec.signedBy + ' · ' + rec.time + '</span></p>' + failHtml + '</td></tr>';
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
          '<td style="padding:7px 8px;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif">' + r.time + '</td></tr>';
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
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px 0"><p style="margin:0;font-size:13px;color:#334155;font-family:Arial,sans-serif">' + r.product + '</p>' + actionHtml + '</td>' +
          '<td style="text-align:right;vertical-align:top;padding:6px 0;font-size:12px;font-family:Arial,sans-serif"><strong style="color:#334155">' + r.temp + '°C</strong> <span style="background:' + bg + ';color:' + fg + ';padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;margin-left:6px">' + r.status + '</span> <span style="color:#94a3b8;margin-left:6px">' + r.staff + '</span></td></tr>';
      }).join('');

  const probeSection = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
    '<tr><td style="padding:14px 24px 4px"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-family:Arial,sans-serif">Food Probes &nbsp;<span style="font-weight:400;color:#cbd5e1">' + (probeCount > 0 ? probeCount + ' reading' + (probeCount !== 1 ? 's' : '') : '') + '</span></p></td></tr>' +
    '<tr><td style="padding:0 24px 14px"><table width="100%" cellpadding="0" cellspacing="0">' + probeRows + '</table></td></tr></table>';

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

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">' +
  '<div style="background:#f1f5f9;padding:24px 16px">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto"><tr><td>' +

  // Header
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2332;border-radius:8px 8px 0 0;overflow:hidden">' +
  '<tr><td style="padding:20px 24px"><p style="margin:0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4a6080;font-family:Arial,sans-serif">Food Safety Report</p>' +
  '<p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#e6edf3;font-family:Arial,sans-serif">' + name + '</p>' +
  '<p style="margin:4px 0 0;font-size:13px;color:#7d8da8;font-family:Arial,sans-serif">' + dayLabel + ' &nbsp;·&nbsp; Generated 23:59</p></td>' +
  '<td style="padding:20px 24px;text-align:right;vertical-align:middle">' + badgeHtml + '</td></tr>' +
  (pct !== null ? '<tr><td colspan="2" style="padding:0 24px 16px"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
  '<td style="background:' + headerBg + ';border-radius:3px;height:6px"><div style="width:' + barWidth + '%;height:6px;background:' + pctColor + ';border-radius:3px"></div></td>' +
  '<td style="width:110px;padding-left:12px;font-size:11px;color:' + pctColor + ';font-family:Arial,sans-serif;white-space:nowrap">' + passedChecks + '/' + totalChecks + ' checks</td>' +
  '</tr></table></td></tr>' : '') +
  '</table>' +

  // Overview
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:2px">' +
  sectionHeader('Overview') +
  '<tr><td style="padding:8px 24px 16px"><table width="100%" cellpadding="0" cellspacing="0">' + overviewRows + '</table></td></tr></table>' +

  // Checks
  buildCheckSection('Opening Checks', opening) +
  buildCheckSection('Closing Checks', closing) +

  // Temps, Probes, Tasks
  tempSection + probeSection + taskSection +

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
      results.push({
        dept:     String(row[deptCol] || '').toLowerCase(),
        location: String(row[locCol]  || ''),
        temp:     String(row[tempCol] || ''),
        status:   String(row[statusCol] || ''),
        action:   String(row[actionCol] || ''),
        time:     String(row[timeCol]   || ''),
      });
    } else if (tabName === 'Food Probe Log') {
      results.push({
        product: String(row[prodCol]    || ''),
        temp:    String(row[tempCol]    || ''),
        status:  String(row[statusCol]  || ''),
        action:  String(row[actionCol]  || ''),
        staff:   String(row[staffCol]   || ''),
        time:    String(row[timeCol]    || ''),
      });
    } else {
      // Opening / Closing Checks — parse Fields JSON for individual items
      let fields = {};
      try { fields = JSON.parse(String(row[fieldsCol] || '{}')); } catch(e) {}

      const checkEntries = Object.entries(fields).filter(([,v]) => v === 'Yes' || v === 'No');
      const passed = checkEntries.filter(([,v]) => v === 'Yes').length;
      const total  = checkEntries.length;
      const failed = checkEntries.filter(([,v]) => v === 'No').map(([k]) => k.replace(/_/g,' ').replace(/\w/g, c => c.toUpperCase()));

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

function getTodayTasks(ss, today, settings) {
  // Determine today's day name for scheduled tasks
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const todayName = dayNames[new Date().getDay()];

  const scheduledTasks = (settings.tasks || []).filter(t => t.enabled && t.day === todayName);
  if (!scheduledTasks.length) return [];

  // Get current week start (Monday)
  const d = new Date();
  const monOffset = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - monOffset);
  const weekStart = getDateStr(mon);

  // Pull task completion records
  const sheet = ss.getSheetByName('Task Completions');
  const completions = {};
  if (sheet && sheet.getLastRow() >= 2) {
    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const tidCol  = headers.indexOf('Task ID');
    const wkCol   = headers.indexOf('Week Start');
    const byCol   = headers.indexOf('Completed By');
    for (let i = 1; i < data.length; i++) {
      const taskId = String(data[i][tidCol] || '');
      let   wk     = data[i][wkCol];
      if (wk instanceof Date) wk = getDateStr(wk);
      if (String(wk) === weekStart && taskId) {
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
