// ═══════════════════════════════════════════════════════
//  SAFECHECKS — History v5
//  Department-filtered: staff see their dept, mgmt sees all
// ═══════════════════════════════════════════════════════

function loadHistory() {
  const type    = document.getElementById('history-type')?.value || 'all';
  const fromVal = document.getElementById('history-date-from')?.value;
  const toVal   = document.getElementById('history-date-to')?.value;
  const dept    = currentDept();

  // task_completion records are internal — never show in history
  let records = state.records.filter(r => r.type !== 'task_completion');

  // Department filter: staff only see their dept
  if (!isManagement()) {
    records = records.filter(r => !r.dept || r.dept === dept);
  }

  if (type !== 'all') records = records.filter(r => r.type === type);
  if (fromVal)        records = records.filter(r => r.date >= fromVal);
  if (toVal)          records = records.filter(r => r.date <= toVal);
  records.sort((a,b) => new Date(b.iso) - new Date(a.iso));

  const list = document.getElementById('history-list'); if (!list) return;

  const total       = records.length;
  const remoteCount = records.filter(r => r.source === 'remote').length;
  const sourceNote  = state.config.sheetsUrl
    ? `<div class="history-source-note">${total} record${total!==1?'s':''} · ${remoteCount} from Sheets · ${total-remoteCount} local${isManagement()?' · All departments':` · ${DEPARTMENTS[dept]?.label||''} only`}</div>`
    : `<div class="history-source-note offline-note">⚠ Not connected to Sheets — showing local records only</div>`;

  if (!records.length) {
    list.innerHTML = sourceNote + '<p class="empty-state">No records found for the selected filters.</p>';
    return;
  }

  list.innerHTML = sourceNote + records.map(r => {
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

function buildSummary(r) {
  if (r.type==='temperature') return `${r.fields?.temp_location||''}: ${r.fields?.temp_value||''}°C — ${r.fields?.temp_status||''}`;
  if (r.type==='food_probe')  return `${r.fields?.probe_product||''}: ${r.fields?.probe_temp||''}°C — ${r.fields?.probe_status||''} · ${r.fields?.probe_staff||''}`;
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
  const fmt = d => d.toISOString().split('T')[0];

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

  loadHistory();
}
