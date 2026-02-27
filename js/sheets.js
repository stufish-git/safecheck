// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Google Sheets Sync v5
//  Now includes Department column on every record
// ═══════════════════════════════════════════════════════

const SYNC_QUEUE_KEY   = 'safechecks_sync_queue';
const REMOTE_CACHE_KEY = 'safechecks_remote_records';
const LAST_PULL_KEY    = 'safechecks_last_pull';
const PULL_INTERVAL_MS = 60 * 1000;

const SHEET_TABS = {
  opening:         'Opening Checks',
  closing:         'Closing Checks',
  temperature:     'Temperature Log',
  food_probe:      'Food Probe Log',
  cleaning:        'Cleaning Schedule',
  weekly:          'Weekly Review',
  task_completion: 'Task Completions',
};

// Headers include Department as 4th column after ID, Date, Time
const SHEET_HEADERS = {
  opening: [
    'ID','Date','Time','Department',
    // Shared checks
    'Fire Exits Clear','Fire Extinguishers OK','First Aid Kit OK','No Slip Hazards',
    // Kitchen
    'Fridge Temps Checked','Raw/Cooked Separated','Date Labels OK','Expired Items Removed',
    'Surfaces Cleaned','Equipment Cleaned','Handwash Stocked','PPE Available',
    'Sanitiser Available','Staff Illness Check','Uniforms OK',
    // FOH
    'Tables Set','Bar Stocked','Display Fridge Checked','Menus Clean','Specials Updated',
    'Allergen Info Current','Till Checked','Toilets Restocked','Furniture Checked',
    'Staff Uniform','Reservations Checked',
    'Notes','Signed By'
  ],
  closing: [
    'ID','Date','Time','Department',
    // Shared
    'Windows Secured','Doors Locked','Lights Off',
    // Kitchen
    'Food Stored Correctly','Waste Removed','Raw/Cooked Separated','Fridge Temps Checked',
    'Equipment Off','Gas Off','Fryer Off','Kitchen Cleaned','Boards Cleaned','Deliveries Logged',
    // FOH
    'Tables Cleared','Bar Cleaned','Fridge Temps FOH','Till Reconciled',
    'Cash Secured','CCTV On','Alarm Set','Toilets Cleaned','FOH Floors','Outdoor Cleared',
    'Notes','Signed By'
  ],
  temperature: [
    'ID','Date','Time','Department','Location','Temperature (°C)','Status','Probe Used',
    'Corrective Action','Logged By'
  ],
  food_probe: [
    'ID','Date','Time','Department','Product / Dish',
    'Core Temperature (°C)','Status','Probe Used',
    'Corrective Action','Logged By'
  ],
  task_completion: [
    'ID','Date','Time','Department','Task ID','Week Start','Completed By',
  ],
  cleaning: [
    'ID','Date','Time','Department',
    // Kitchen cleaning
    'Surfaces Wiped Mid-Service','Spillages Cleaned','Bins Emptied Mid-Service',
    'All Surfaces Deep Cleaned','Ovens/Grills Cleaned','Fryer Cleaned','Sinks Cleaned',
    'Floors Mopped','Waste Removed','Chopping Boards','Utensils Stored',
    'Fridge Wiped','Fridge Seals','Dry Store',
    // FOH cleaning
    'Tables Wiped Between Covers','Bar Surface Clean','Spills Cleaned',
    'Glasses Polished','Toilets Checked','FOH Deep Clean',
    'Bar Equipment Cleaned','Coffee Machine Cleaned','Beer Lines','Menus Wiped','Highchairs',
    'Notes','Signed By'
  ],
  weekly: [
    'ID','Week Start Date','Submitted At','Department',
    'HACCP Reviewed','Temp Logs Complete','No Temp Breaches','Allergen Info Current',
    'FIFO Followed','Kitchen Deep Clean','FOH Deep Clean','Clean Records Signed',
    'Pest Check OK','Drains Cleaned','Fridges Deep Cleaned',
    'Staff Training Current','No Illness Reports','Briefing Held',
    'Equipment Working','Probe Calibrated','Maintenance Logged','First Aid Checked',
    'Rotas Confirmed','Supplier Invoices Checked',
    'Issues This Week','Actions Next Week','Overall Rating','Manager Sign-Off'
  ],
};

// ── PUSH ──────────────────────────────────────────────
async function syncRecordToSheets(record) {
  if (!state.config.sheetsUrl) { queueForSync(record); return; }
  setSyncStatus('syncing','Syncing…');
  try {
    const payload = buildPayload(record);
    await fetch(state.config.sheetsUrl, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    setSyncStatus('connected','Connected');
    markSynced(record.id);
    setTimeout(()=>pullAllRecords(true), 2000);
  } catch(err) {
    console.error('Push failed:', err);
    setSyncStatus('error','Sync failed');
    queueForSync(record);
    showToast('Saved locally — will sync when online','error');
  }
}

function buildPayload(record) {
  const dept = record.dept || currentDept();
  const f    = record.fields || {};

  let rowData;
  if (record.type === 'temperature') {
    rowData = [record.id, record.date, record.timestamp, dept,
      f.temp_location, f.temp_value, f.temp_status, f.temp_probe,
      f.temp_corrective_action, f.temp_logged_by];
  } else if (record.type === 'food_probe') {
    rowData = [record.id, record.date, record.timestamp, dept,
      f.probe_product, f.probe_temp, f.probe_status, f.probe_used,
      f.probe_action, f.probe_staff];
  } else if (record.type === 'task_completion') {
    rowData = [record.id, record.date, record.timestamp, record.dept||'',
      f.task_id, f.task_week, f.task_done_by];
  } else {
    const fieldVals = Object.values(f).map(v=>v??'');
    rowData = [record.id, record.date, record.timestamp, dept, ...fieldVals];
  }

  return {
    action:   'append',
    sheetTab: SHEET_TABS[record.type] || record.type,
    headers:  SHEET_HEADERS[record.type] || [],
    row:      rowData,
    type:     record.type,
  };
}

// ── PULL ──────────────────────────────────────────────
async function pullAllRecords(force=false) {
  if (!state.config.sheetsUrl) return;
  const lastPull = parseInt(localStorage.getItem(LAST_PULL_KEY)||'0');
  if (!force && Date.now()-lastPull < PULL_INTERVAL_MS) return;

  setSyncStatus('syncing','Refreshing…');
  try {
    const remoteRecords = [];
    for (const [type, tabName] of Object.entries(SHEET_TABS)) {
      try {
        const url  = `${state.config.sheetsUrl}?action=read&tab=${encodeURIComponent(tabName)}`;
        const resp = await fetch(url, { method:'GET', mode:'cors' });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.status==='ok' && Array.isArray(data.rows)) {
          data.rows.map(row=>parseSheetRow(row,type)).filter(Boolean).forEach(r=>remoteRecords.push(r));
        }
      } catch(e) { console.warn(`Pull failed for ${tabName}:`, e); }
    }

    state.records = mergeRecords(state.records, remoteRecords);
    saveState();
    localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(remoteRecords));
    localStorage.setItem(LAST_PULL_KEY, Date.now().toString());
    setSyncStatus('connected','Up to date');
    updateDashboard(); renderTempLog(); renderFoodProbeLog(); updateFoodProbeDayStatus();
  } catch(err) {
    setSyncStatus('error','Offline');
  }
}

function parseSheetRow(row, type) {
  try {
    const id        = String(row['ID']||row['id']||'').trim();
    const date      = String(row['Date']||row['date']||'').trim();
    const timestamp = String(row['Time']||row['Submitted At']||'').trim();
    const dept      = String(row['Department']||'').trim() || null;
    if (!id||!date) return null;

    const fields = {};
    if (type==='temperature') {
      fields.temp_location          = row['Location']||'';
      fields.temp_value             = row['Temperature (°C)']||'';
      fields.temp_status            = row['Status']||'';
      fields.temp_probe             = row['Probe Used']||'';
      fields.temp_corrective_action = row['Corrective Action']||'';
      fields.temp_logged_by         = row['Logged By']||'';
    } else if (type==='food_probe') {
      fields.probe_product = row['Product / Dish']||'';
      fields.probe_temp    = row['Core Temperature (°C)']||'';
      fields.probe_status  = row['Status']||'';
      fields.probe_used    = row['Probe Used']||'';
      fields.probe_action  = row['Corrective Action']||'';
      fields.probe_staff   = row['Logged By']||'';
    }

    const checks   = Object.values(fields).filter(v=>v==='Yes'||v==='No');
    const passed   = checks.filter(v=>v==='Yes').length;
    const signed   = fields.temp_logged_by || '';
    const summary  = type==='temperature'
      ? `${fields.temp_location}: ${fields.temp_value}°C (${fields.temp_status}) · ${fields.temp_logged_by}`
      : `${passed}/${checks.length} checks passed · Signed: ${signed}`;

    return { id, type, dept, date, timestamp, iso:dateToISO(date,timestamp), fields, summary, source:'remote' };
  } catch(e) { return null; }
}

function dateToISO(dateStr, timeStr) {
  try {
    if (!dateStr) return new Date().toISOString();
    const [d,m,y] = dateStr.split('/');
    if (!y) return new Date().toISOString();
    const base = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const time = timeStr ? timeStr.split(',').pop().trim() : '00:00:00';
    return new Date(`${base}T${time}`).toISOString();
  } catch(e) { return new Date().toISOString(); }
}

function mergeRecords(local, remote) {
  const map = new Map();
  local.forEach(r=>map.set(r.id,r));
  remote.forEach(r=>map.set(r.id,{...map.get(r.id)||{},...r}));
  return Array.from(map.values());
}

// ── Offline queue ─────────────────────────────────────
function queueForSync(record) {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)||'[]');
    if (!q.find(r=>r.id===record.id)) q.push(record);
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
  } catch(e) {}
}
function markSynced(id) {
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)||'[]');
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q.filter(r=>r.id!==id)));
  } catch(e) {}
}
async function retryQueue() {
  if (!state.config.sheetsUrl) return;
  try {
    const q = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)||'[]');
    if (!q.length) return;
    showToast(`Syncing ${q.length} offline record${q.length>1?'s':''}…`);
    for (const r of q) { await syncRecordToSheets(r); await new Promise(res=>setTimeout(res,400)); }
  } catch(e) {}
}

// ── Status / polling ──────────────────────────────────
function setSyncStatus(cls, label) {
  const el = document.getElementById('sync-status');
  el?.classList.remove('connected','error','syncing');
  if (cls) el?.classList.add(cls);
  const lbl = el?.querySelector('.sync-label');
  if (lbl) lbl.textContent = label;
}

let pullTimer = null;
function startAutoPoll() {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = setInterval(()=>{ if (document.visibilityState==='visible') pullAllRecords(); }, PULL_INTERVAL_MS);
}

document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState==='visible' && state.config.sheetsUrl) pullAllRecords();
});
window.addEventListener('online', ()=>{
  showToast('Back online — syncing…');
  setTimeout(()=>{ retryQueue(); pullAllRecords(true); }, 1000);
});
