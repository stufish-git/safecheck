// ═══════════════════════════════════════════════════════
//  SAFECHECKS — History v5.1
//  Department-filtered: staff see their dept, mgmt sees all
//  C2 banner: prompts user to load older records from Sheets
//  when date range extends beyond the local retention window
// ═══════════════════════════════════════════════════════

// Holds records fetched on-demand from Sheets for dates outside the
// local retention window. Cleared whenever the date filters change.
// Never saved back to localStorage — display only.
let extendedRecords = null;

// Called by date filter inputs and the Filter button.
// Clears any previously loaded extended records so the banner reappears
// if the new date range also extends beyond the local window.
function onHistoryFilterChange() {
  extendedRecords = null;
  loadHistory();
}

function loadHistory() {
  const type    = document.getElementById('history-type')?.value || 'all';
  const fromVal = document.getElementById('history-date-from')?.value;
  const toVal   = document.getElementById('history-date-to')?.value;
  const dept    = currentDept();

  // Merge local records with any on-demand extended records
  let records = [...state.records, ...(extendedRecords || [])];

  // De-duplicate by ID — extended records may overlap with local
  const seen = new Set();
  records = records.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // Department filter: staff only see their dept
  if (!isManagement()) {
    records = records.filter(r => !r.dept || r.dept === dept);
  }

  if (type !== 'all') records = records.filter(r => r.type === type);
  if (fromVal)        records = records.filter(r => r.date >= fromVal);
  if (toVal)          records = records.filter(r => r.date <= toVal);
  records.sort((a,b) => new Date(b.iso) - new Date(a.iso));

  const list = document.getElementById('history-list'); if (!list) return;

  // ── C2 banner ────────────────────────────────────────
  // Show when: Sheets connected + from date is outside local window + not yet loaded
  const cutoff     = getLocalCutoffDate();
  const needsBanner = state.config.sheetsUrl &&
                      fromVal && fromVal < cutoff &&
                      extendedRecords === null;

  let bannerHtml = '';
  if (needsBanner) {
    bannerHtml = `
      <div class="history-older-banner" id="history-older-banner">
        <span class="history-older-icon">⚠</span>
        <div class="history-older-body">
          <div class="history-older-title">Some records in this range are stored in Sheets only</div>
          <div class="history-older-sub">Local records cover the last ${LOCAL_RETENTION_DAYS} days. Older records are in Google Sheets.</div>
        </div>
        <button class="history-older-btn" onclick="loadOlderFromSheets()">Load from Sheets →</button>
      </div>`;
  } else if (extendedRecords !== null && extendedRecords.length > 0) {
    // Already loaded — show a quiet confirmation
    bannerHtml = `
      <div class="history-older-banner history-older-loaded" id="history-older-banner">
        <span class="history-older-icon">✓</span>
        <div class="history-older-body">
          <div class="history-older-title">Loaded ${extendedRecords.length} older record${extendedRecords.length !== 1 ? 's' : ''} from Sheets</div>
        </div>
      </div>`;
  } else if (extendedRecords !== null && extendedRecords.length === 0) {
    bannerHtml = `
      <div class="history-older-banner history-older-loaded" id="history-older-banner">
        <span class="history-older-icon">—</span>
        <div class="history-older-body">
          <div class="history-older-title">No older records found in Sheets for this range</div>
        </div>
      </div>`;
  }

  const total       = records.length;
  const remoteCount = records.filter(r => r.source === 'remote').length;
  const sourceNote  = state.config.sheetsUrl
    ? `<div class="history-source-note">${total} record${total!==1?'s':''} · ${remoteCount} from Sheets · ${total-remoteCount} local${isManagement()?' · All departments':` · ${DEPARTMENTS[dept]?.label||''} only`}</div>`
    : `<div class="history-source-note offline-note">⚠ Not connected to Sheets — showing local records only</div>`;

  if (!records.length) {
    list.innerHTML = bannerHtml + sourceNote + '<p class="empty-state">No records found for the selected filters.</p>';
    return;
  }

  list.innerHTML = bannerHtml + sourceNote + records.map(r => {
    const deptInfo = DEPARTMENTS[r.dept];
    const deptBadge = isManagement() && deptInfo
      ? `<span class="dept-badge" style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span>`
      : '';
    return `
      <div class="history-entry" onclick="expandRecord('${r.id}')">
        <div class="history-entry-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="history-type-badge badge-${r.type}">${labelFor(r.type)}</span>
            ${deptBadge}
          </div>
          <span class="history-timestamp">${r.timestamp}</span>
        </div>
        <div class="history-summary">${r.summary || buildSummary(r)}</div>
      </div>`;
  }).join('');
}

// ── Load older records from Sheets on demand ──────────
// Fetches the full date range currently in the pickers from Sheets,
// stores the result in extendedRecords (display only — not saved to localStorage),
// then re-renders History with the combined dataset.
async function loadOlderFromSheets() {
  const fromVal = document.getElementById('history-date-from')?.value;
  const toVal   = document.getElementById('history-date-to')?.value || todayStr();

  // Update banner to show loading state
  const banner = document.getElementById('history-older-banner');
  if (banner) {
    banner.innerHTML = `
      <span class="history-older-icon">…</span>
      <div class="history-older-body">
        <div class="history-older-title">Loading from Sheets…</div>
      </div>`;
  }

  try {
    const fetched = [];
    for (const [type, tabName] of Object.entries(SHEET_TABS)) {
      try {
        let url = `${state.config.sheetsUrl}?action=read&tab=${encodeURIComponent(tabName)}`;
        if (fromVal) url += `&from=${fromVal}`;
        url += `&to=${toVal}`;

        const resp = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.status === 'ok' && Array.isArray(data.rows)) {
          data.rows
            .map(row => parseSheetRow(row, type))
            .filter(Boolean)
            .forEach(r => fetched.push(r));
        }
      } catch(e) { console.warn(`loadOlderFromSheets: failed for ${tabName}:`, e); }
    }
    extendedRecords = fetched;
  } catch(e) {
    console.error('loadOlderFromSheets error:', e);
    extendedRecords = [];
    showToast('Could not load from Sheets — check connection', 'error');
  }

  loadHistory();
}

function buildSummary(r) {
  if (r.type==='temperature') return `${r.fields?.temp_location||''}: ${r.fields?.temp_value||''}°C — ${r.fields?.temp_status||''}`;
  if (r.type==='food_probe')  return `${r.fields?.probe_product||''}: ${r.fields?.probe_temp||''}°C — ${r.fields?.probe_status||''} · ${r.fields?.probe_staff||''}`;
  if (r.type==='task_completion') {
    const action = r.fields?.task_action === 'untick' ? 'Unticked' : 'Completed';
    const by = r.fields?.task_done_by;
    return by ? `${action} by ${by}` : action;
  }
  const checks = Object.entries(r.fields||{}).filter(([,v])=>v==='Yes'||v==='No');
  return `${checks.filter(([,v])=>v==='Yes').length}/${checks.length} checks passed`;
}

function expandRecord(id) {
  const record = state.records.find(r => r.id===id); if (!record) return;
  document.getElementById('record-detail-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'record-detail-overlay'; overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target===overlay) overlay.remove(); };
  const deptInfo = DEPARTMENTS[record.dept];
  overlay.innerHTML = `
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <h2 class="modal-title" style="margin:0">${labelFor(record.type)}</h2>
          ${deptInfo?`<div style="font-size:12px;color:${deptInfo.color};margin-top:4px">${deptInfo.icon} ${deptInfo.label}</div>`:''}
          <p style="font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-top:4px">${record.timestamp}</p>
        </div>
        <button onclick="document.getElementById('record-detail-overlay').remove()"
          style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer">✕</button>
      </div>
      ${buildDetailHTML(record)}
    </div>`;
  document.body.appendChild(overlay);
}

function buildDetailHTML(record) {
  if (!record.fields) return '<p>No details available.</p>';
  return Object.entries(record.fields).map(([key, value]) => {
    if (!value) return '';
    const label = key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const color = value==='Yes'?'#22c55e':value==='No'?'#ef4444':value==='OK'?'#22c55e':value==='FAIL'?'#ef4444':value==='WARNING'?'#f59e0b':'var(--text)';
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);gap:16px">
      <span style="font-size:13px;color:var(--text-muted);flex:1">${label}</span>
      <span style="font-size:13px;font-weight:600;color:${color};text-align:right;flex:1;word-break:break-word">${value}</span>
    </div>`;
  }).join('');
}

function exportToCSV() {
  const type    = document.getElementById('history-type')?.value || 'all';
  const fromVal = document.getElementById('history-date-from')?.value;
  const toVal   = document.getElementById('history-date-to')?.value;
  const dept    = currentDept();

  let records = [...state.records];
  if (!isManagement()) records = records.filter(r => !r.dept || r.dept===dept);
  if (type!=='all') records = records.filter(r=>r.type===type);
  if (fromVal)      records = records.filter(r=>r.date>=fromVal);
  if (toVal)        records = records.filter(r=>r.date<=toVal);
  records.sort((a,b)=>new Date(b.iso)-new Date(a.iso));

  if (!records.length) { showToast('No records to export','error'); return; }

  const rows = [['ID','Type','Department','Date','Timestamp','Summary','Details']];
  records.forEach(r=>{
    const details = Object.entries(r.fields||{}).map(([k,v])=>`${k}: ${v}`).join(' | ');
    rows.push([r.id, r.type, r.dept||'', r.date, r.timestamp,
      (r.summary||'').replace(/,/g,' '), details.replace(/,/g,' ')]);
  });

  const csv  = rows.map(row=>row.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `safechecks_${type}_${fromVal||'all'}_to_${toVal||'all'}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV downloaded ✓','success');
}

// ── Quick date shortcuts ──────────────────────────────
function setHistoryQuickDate(range) {
  const from = document.getElementById('history-date-from');
  const to   = document.getElementById('history-date-to');
  const today = new Date();
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');

  if (range === 'today') {
    from.value = fmt(today);
    to.value   = fmt(today);
  } else if (range === 'yesterday') {
    const y = new Date(today); y.setDate(today.getDate() - 1);
    from.value = fmt(y);
    to.value   = fmt(y);
  } else if (range === 'week') {
    const mon = new Date(today);
    mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    from.value = fmt(mon);
    to.value   = fmt(today);
  }

  // Highlight active button
  document.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${range}'`));
  });

  onHistoryFilterChange();
}
