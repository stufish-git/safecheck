/**
 * ═══════════════════════════════════════════════════════
 *  SAFECHECKS — Google Apps Script v5
 *  Departments: Kitchen · Front of House · Management
 *  Tabs: Opening Checks, Closing Checks, Temperature Log,
 *        Food Probe Log, Cleaning Schedule, Weekly Review,
 *        Task Completions, Settings
 *
 *  HOW TO USE:
 *  1. Open your Google Sheet
 *  2. Click Extensions → Apps Script
 *  3. Delete all existing code and paste this entire file
 *  4. Click Save (Ctrl+S / Cmd+S)
 *  5. In the function dropdown select setupSheets and click Run
 *     — authorise when prompted, then all tabs are created
 *  6. Click Deploy → New deployment
 *       Type: Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *  7. Click Deploy → Authorise → Allow
 *  8. Copy the Web App URL and paste it into SafeChecks
 *
 *  TO UPDATE LATER: Deploy → Manage deployments → Edit (pencil)
 *  → Version: New version → Deploy
 *  Never create a new deployment — the URL would change.
 * ═══════════════════════════════════════════════════════
 */

const SETTINGS_TAB = 'Settings';

// ── POST: Receive and save a new record ──────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Settings save — handle before sheet lookup
    if (data.action === 'saveSettings') return handleSaveSettings(data);

    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = data.sheetTab || 'General';
    let   sheet   = ss.getSheetByName(tabName);

    // Auto-create tab with headers if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      if (data.headers && data.headers.length > 0) {
        applyHeaders(sheet, data.headers);
      }
    }

    // Append the row
    if (data.row && data.row.length > 0) {
      sheet.appendRow(data.row);

      // Colour-code status rows for visibility
      // Both Temperature Log and Food Probe Log have Status at array index 6
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
          headers.forEach((h, i) => { obj[h] = String(row[i] ?? ''); });
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

// Colour the last appended row based on status value
// statusArrayIndex: 0-based index in the row array where status lives
function colourStatusRow(sheet, row, statusArrayIndex) {
  const lastRow  = sheet.getLastRow();
  const rowRange = sheet.getRange(lastRow, 1, 1, row.length);
  const status   = String(row[statusArrayIndex] || '').toUpperCase();
  if      (status === 'FAIL')    rowRange.setBackground('#3d0000');
  else if (status === 'WARNING') rowRange.setBackground('#3d2800');
  // PASS / OK rows stay default (dark theme base)
}

// ── One-time setup ────────────────────────────────────────
// Select this function in the dropdown and click Run
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const configs = [
    {
      name: 'Opening Checks',
      headers: [
        'ID','Date','Time','Department',
        'Fire Exits Clear','Fire Extinguishers OK','First Aid Kit OK','No Slip Hazards',
        'Fridge Temps Checked','Raw/Cooked Separated','Date Labels OK','Expired Items Removed',
        'Surfaces Cleaned','Equipment Cleaned','Handwash Stocked','PPE Available',
        'Sanitiser Available','Staff Illness Check','Uniforms OK',
        'Tables Set','Bar Stocked','Display Fridge Checked','Menus Clean','Specials Updated',
        'Allergen Info Current','Till Checked','Toilets Restocked','Furniture Checked',
        'Staff Uniform FOH','Reservations Checked',
        'Notes','Signed By',
      ],
    },
    {
      name: 'Closing Checks',
      headers: [
        'ID','Date','Time','Department',
        'Windows Secured','Doors Locked','Lights Off',
        'Food Stored Correctly','Waste Removed','Raw/Cooked Separated','Fridge Temps Checked',
        'Equipment Off','Gas Off','Fryer Off','Kitchen Cleaned','Boards Cleaned','Deliveries Logged',
        'Tables Cleared','Bar Cleaned','Fridge Temps FOH','Till Reconciled',
        'Cash Secured','CCTV On','Alarm Set','Toilets Cleaned','FOH Floors','Outdoor Cleared',
        'Notes','Signed By',
      ],
    },
    {
      name: 'Temperature Log',
      headers: [
        'ID','Date','Time','Department',
        'Location','Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
      ],
    },
    {
      name: 'Food Probe Log',
      headers: [
        'ID','Date','Time','Department',
        'Product / Dish','Core Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
      ],
    },
    {
      name: 'Cleaning Schedule',
      headers: [
        'ID','Date','Time','Department',
        'Surfaces Wiped Mid-Service','Spillages Cleaned','Bins Emptied Mid-Service',
        'All Surfaces Deep Cleaned','Ovens/Grills Cleaned','Fryer Cleaned','Sinks Cleaned',
        'Floors Mopped','Waste Removed','Chopping Boards','Utensils Stored',
        'Fridge Wiped','Fridge Seals','Dry Store',
        'Tables Wiped Between Covers','Bar Surface Clean','Spills Cleaned',
        'Glasses Polished','Toilets Checked','FOH Deep Clean',
        'Bar Equipment Cleaned','Coffee Machine Cleaned','Beer Lines','Menus Wiped','Highchairs',
        'Notes','Signed By',
      ],
    },
    {
      name: 'Weekly Review',
      headers: [
        'ID','Week Start Date','Submitted At','Department',
        'HACCP Reviewed','Temp Logs Complete','No Temp Breaches','Allergen Info Current',
        'FIFO Followed','Kitchen Deep Clean','FOH Deep Clean','Clean Records Signed',
        'Pest Check OK','Drains Cleaned','Fridges Deep Cleaned',
        'Staff Training Current','No Illness Reports','Briefing Held',
        'Equipment Working','Probe Calibrated','Maintenance Logged','First Aid Checked',
        'Rotas Confirmed','Supplier Invoices Checked',
        'Issues This Week','Actions Next Week','Overall Rating','Manager Sign-Off',
      ],
    },
    {
      name: 'Task Completions',
      headers: [
        'ID','Date','Time','Department',
        'Task ID','Week Start','Completed By',
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

  // Remove default blank sheet if present
  try {
    const def = ss.getSheetByName('Sheet1');
    if (def && ss.getNumSheets() > 1) ss.deleteSheet(def);
  } catch(e) {}

  SpreadsheetApp.getUi().alert(
    '✅ SafeChecks v5 — All sheets created successfully!\n\n' +
    'Tabs created:\n' +
    '  • Opening Checks\n' +
    '  • Closing Checks\n' +
    '  • Temperature Log\n' +
    '  • Food Probe Log\n' +
    '  • Cleaning Schedule\n' +
    '  • Weekly Review\n' +
    '  • Task Completions\n' +
    '  • Settings\n\n' +
    'Next step: Deploy → New deployment → Web app'
  );
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
