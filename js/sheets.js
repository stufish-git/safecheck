// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Google Sheets Sync v5.1
//  Root cause fixes:
//  1. Date format normalisation (Sheets returns dates as Date objects)
//  2. Fields JSON column — full round-trip for all checklist types
//  3. mergeRecords — never overwrites local fields with empty remote
// ═══════════════════════════════════════════════════════

const SYNC_QUEUE_KEY   = 'safechecks_sync_queue';
const REMOTE_CACHE_KEY = 'safechecks_remote_records';
const LAST_PULL_KEY    = 'safechecks_last_pull';
const PULL_INTERVAL_MS = 15 * 1000;  // 15s — fast enough for multi-device, within Apps Script limits

const SHEET_TABS = {
  opening:         'Opening Checks',
  closing:         'Closing Checks',
  temperature:     'Temperature Log',
  food_probe:      'Food Probe Log',
  cleaning:        'Cleaning Schedule',
  weekly:          'Weekly Review',
  task_completion: 'Task Completions',
};

// Checklist types use a compact schema + Fields JSON for full reconstruction.
// Temperature / food_probe keep named columns (easily read in Sheets) + Fields JSON.
const SHEET_HEADERS = {
  opening:  ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
  closing:  ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
  cleaning: ['ID','Date','Time','Department','Summary','Notes','Signed By','Fields JSON'],
  weekly:   ['ID','Date','Time','Department','Summary','Issues','Actions','Rating','Signed By','Fields JSON'],
  temperature: [
    'ID','Date','Time','Department',
    'Location','Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
    'Fields JSON',
  ],
  food_probe: [
    'ID','Date','Time','Department',
    'Product / Dish','Core Temperature (°C)','Status','Probe Used','Corrective Action','Logged By',
    'Fields JSON',
  ],
  task_completion: ['ID','Date','Time','Department','Task ID','Week Start','Completed By'],
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
  const json = JSON.stringify(f);   // Full field data — always stored

  let rowData;

  if (record.type === 'temperature') {
    rowData = [record.id, record.date, record.timestamp, dept,
      f.temp_location, f.temp_value, f.temp_status, f.temp_probe,
      f.temp_corrective_action, f.temp_logged_by, json];

  } else if (record.type === 'food_probe') {
    rowData = [record.id, record.date, record.timestamp, dept,
      f.probe_product, f.probe_temp, f.probe_status, f.probe_used,
      f.probe_action, f.probe_staff, json];

  } else if (record.type === 'task_completion') {
    rowData = [record.id, record.date, record.timestamp, dept,
      f.task_id, f.task_week, f.task_done_by];

  } else if (record.type === 'weekly') {
    rowData = [record.id, record.date, record.timestamp, dept,
      record.summary || '',
      f.weekly_issues  || '',
      f.weekly_actions || '',
      f.weekly_rating  || '',
      f.weekly_signed_by || '',
      json];

  } else {
    // opening / closing / cleaning
    const signed = f.open_signed_by || f.close_signed_by || f.clean_signed_by || '';
    const notes  = f.open_notes     || f.close_notes     || f.clean_notes     || '';
    rowData = [record.id, record.date, record.timestamp, dept,
      record.summary || '', notes, signed, json];
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
          data.rows
            .map(row => parseSheetRow(row, type))
            .filter(Boolean)
            .forEach(r => remoteRecords.push(r));
        }
      } catch(e) { console.warn(`Pull failed for ${tabName}:`, e); }
    }

    state.records = mergeRecords(state.records, remoteRecords);
    saveState();
    localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(remoteRecords));
    localStorage.setItem(LAST_PULL_KEY, Date.now().toString());

    // Sync remote task completions into the task completions localStorage
    // Tasks store completions separately (not in state.records) for fast lookup
    syncRemoteTaskCompletions(remoteRecords);

    // Pull and merge checklist drafts (persistent tick state across devices)
    await pullDraftsFromSheets();

    setSyncStatus('connected','Up to date');
    updateDashboard();
    renderEquipmentLog();
    renderFoodProbeLog();
    updateFoodProbeDayStatus();
    updateEquipDayStatus();
    // If tasks tab is open, refresh it
    if (document.getElementById('tab-tasks')?.classList.contains('active')) {
      renderTasksTab();
    }
  } catch(err) {
    console.error('Pull error:', err);
    setSyncStatus('error','Offline');
  }
}

// ── Parse a row returned from Sheets ─────────────────
function parseSheetRow(row, type) {
  try {
    const id        = String(row['ID'] || row['id'] || '').trim();
    const rawDate   = String(row['Date'] || row['date'] || '').trim();
    const timestamp = String(row['Time'] || row['Submitted At'] || '').trim();
    const dept      = String(row['Department'] || '').trim() || null;
    if (!id || !rawDate) return null;

    // Normalise date — Sheets may return dates in many formats
    const date = normaliseDate(rawDate);
    if (!date) return null;

    // ── Reconstruct fields ──
    // Priority 1: Fields JSON column (full fidelity)
    // Priority 2: Named columns (temperature / food_probe fallback)
    let fields = {};
    const jsonStr = row['Fields JSON'] || '';
    if (jsonStr) {
      try { fields = JSON.parse(jsonStr); } catch(e) {}
    }

    // Fallback for temperature (named columns, no JSON)
    if (!Object.keys(fields).length && type === 'temperature') {
      fields = {
        temp_location:          row['Location']           || '',
        temp_value:             row['Temperature (°C)']  || '',
        temp_status:            row['Status']             || '',
        temp_probe:             row['Probe Used']         || '',
        temp_corrective_action: row['Corrective Action']  || '',
        temp_logged_by:         row['Logged By']          || '',
      };
    }

    // Fallback for food_probe (named columns, no JSON)
    if (!Object.keys(fields).length && type === 'food_probe') {
      fields = {
        probe_product: row['Product / Dish']         || '',
        probe_temp:    row['Core Temperature (°C)']  || '',
        probe_status:  row['Status']                 || '',
        probe_used:    row['Probe Used']             || '',
        probe_action:  row['Corrective Action']      || '',
        probe_staff:   row['Logged By']              || '',
      };
    }

    // Fallback for task_completion (no Fields JSON column — use named columns)
    if (type === 'task_completion') {
      fields = {
        task_id:      row['Task ID']      || '',
        task_week:    row['Week Start']   || '',
        task_done_by: row['Completed By'] || '',
      };
    }

    // Build summary
    const summary = row['Summary'] || buildRemoteSummary(type, fields, row);
    const iso     = buildISO(date, timestamp);

    return { id, type, dept, date, timestamp, iso, fields, summary, source:'remote' };
  } catch(e) {
    console.warn('parseSheetRow error:', e);
    return null;
  }
}

function buildRemoteSummary(type, fields, row) {
  if (type === 'temperature') {
    return `${fields.temp_location||''}: ${fields.temp_value||''}°C (${fields.temp_status||''}) · ${fields.temp_logged_by||''}`;
  }
  if (type === 'food_probe') {
    return `${fields.probe_product||''}: ${fields.probe_temp||''}°C (${fields.probe_status||''}) · ${fields.probe_staff||''}`;
  }
  // For checklists, count Yes/No from fields
  const checks = Object.values(fields).filter(v => v==='Yes' || v==='No');
  if (checks.length) {
    const passed = checks.filter(v => v==='Yes').length;
    const signed = fields.open_signed_by || fields.close_signed_by ||
                   fields.clean_signed_by || fields.weekly_signed_by ||
                   row?.['Signed By'] || '';
    return `${passed}/${checks.length} checks passed · Signed: ${signed}`;
  }
  return row?.['Signed By'] ? `Signed: ${row['Signed By']}` : '';
}

// ── Date normalisation ────────────────────────────────
// Sheets may return dates in many formats depending on locale/cell type.
// We always try to get back to YYYY-MM-DD.
function normaliseDate(str) {
  if (!str) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY (en-GB — how our timestamp field is also formatted)
  const gbMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (gbMatch) {
    const [, d, m, y] = gbMatch;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // M/D/YYYY or MM/DD/YYYY (en-US, what Sheets may return)
  // Ambiguous with DD/MM — handled above; if we get here assume M/D/YYYY
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const fullY = y.length === 2 ? '20' + y : y;
    return `${fullY}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Last resort — let JS parse it (handles "Thu Feb 27 2026...", ISO, etc.)
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];
  } catch(e) {}

  return null;
}

function buildISO(dateStr, timeStr) {
  try {
    const norm = normaliseDate(dateStr);
    if (!norm) return new Date().toISOString();
    // Extract HH:MM:SS from "DD/MM/YYYY, HH:MM:SS" style timestamp
    const timePart = timeStr && timeStr.includes(',')
      ? timeStr.split(',').pop().trim()
      : null;
    const t = (timePart && /^\d{2}:\d{2}:\d{2}$/.test(timePart))
      ? `T${timePart}`
      : 'T12:00:00';
    return new Date(`${norm}${t}`).toISOString();
  } catch(e) { return new Date().toISOString(); }
}

// ── Merge local + remote records ──────────────────────
// Rules:
//  • If a record only exists remotely, add it
//  • If a record exists locally with fields, KEEP the local fields
//    (remote may have empty fields if Fields JSON column not present)
//  • Remote wins for metadata: source, summary (so history shows "remote" count correctly)
function mergeRecords(local, remote) {
  const map = new Map();

  // Local records go in first
  local.forEach(r => map.set(r.id, r));

  // Merge remote — never clobber non-empty local fields
  remote.forEach(r => {
    const existing = map.get(r.id);
    if (existing) {
      const remoteHasFields = r.fields && Object.keys(r.fields).length > 0;
      const localHasFields  = existing.fields && Object.keys(existing.fields).length > 0;
      // Keep whichever fields are non-empty, prefer remote if both populated
      const fields = remoteHasFields ? r.fields : (localHasFields ? existing.fields : {});
      map.set(r.id, { ...existing, ...r, fields });
    } else {
      map.set(r.id, r);
    }
  });

  return Array.from(map.values());
}

// ── Task completion sync ─────────────────────────────
// Remote task_completion records come back as state.records entries.
// The tasks UI reads from a separate localStorage key (safechecks_task_completions).
// This function bridges the two so cross-device task completions are visible.
function syncRemoteTaskCompletions(remoteRecords) {
  try {
    const taskRecs = remoteRecords.filter(r => r.type === 'task_completion');
    if (!taskRecs.length) return;

    const completions = loadTaskCompletions();
    let changed = false;

    taskRecs.forEach(r => {
      const taskId   = r.fields?.task_id   || '';
      const weekStart= r.fields?.task_week  || '';
      const staffName= r.fields?.task_done_by || '';
      if (!taskId || !weekStart) return;

      const key = `${weekStart}__${taskId}`;
      if (!completions[key]) {
        completions[key] = {
          taskId,
          weekStart,
          staffName,
          timestamp: r.iso || new Date().toISOString(),
          done: true,
          source: 'remote',
        };
        changed = true;
      }
    });

    if (changed) saveTaskCompletions(completions);
  } catch(e) {
    console.warn('syncRemoteTaskCompletions error:', e);
  }
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
    for (const r of q) {
      await syncRecordToSheets(r);
      await new Promise(res => setTimeout(res, 400));
    }
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
  pullTimer = setInterval(() => {
    if (document.visibilityState === 'visible') pullAllRecords();
  }, PULL_INTERVAL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.config.sheetsUrl) pullAllRecords();
});
window.addEventListener('online', () => {
  showToast('Back online — syncing…');
  setTimeout(() => { retryQueue(); pullAllRecords(true); }, 1000);
});
