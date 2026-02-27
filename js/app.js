// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Core App v5
//  Department-aware: Kitchen · FOH · Management
// ═══════════════════════════════════════════════════════

const APP_VERSION = '5.0.0';
const STORAGE_KEY = 'safechecks_records';
const CONFIG_KEY  = 'safechecks_config';

const state = {
  records:  [],
  config:   {},
  settings: {},
  device:   null,
  weeklyRating: '',
};

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadSettings();
  loadDevice();
  loadState();
  prefillDates();
  checkConnectionStatus();

  if (!isDeviceSetup()) {
    // First time — show setup screen
    showDeviceSetup(() => {
      applyDeviceIdentity();
      rebuildAllChecklists();
      rebuildSignedByDropdowns();
      rebuildTempLocationDropdown();
      rebuildProbeProductDropdown();
      renderTodayDate();
      setWeekRange();
      updateDashboard();
      bootSheets();
    });
  } else {
    applyDeviceIdentity();
    rebuildAllChecklists();
    rebuildSignedByDropdowns();
    rebuildTempLocationDropdown();
    rebuildProbeProductDropdown();
    renderTodayDate();
    setWeekRange();
    updateDashboard();
    bootSheets();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW:', e));
  }
});

function bootSheets() {
  if (state.config.sheetsUrl) {
    pullSettingsFromSheets().then(() => {
      rebuildAllChecklists();
      rebuildSignedByDropdowns();
      rebuildTempLocationDropdown();
      rebuildProbeProductDropdown();
      applyDeviceIdentity();
    });
    pullAllRecords(true).then(() => {
      updateDashboard();
      renderTempLog();
      startAutoPoll();
    });
  }
}

// ── State persistence ─────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.records = raw ? JSON.parse(raw) : [];
    const cfg = localStorage.getItem(CONFIG_KEY);
    state.config = cfg ? JSON.parse(cfg) : {};
  } catch(e) { state.records = []; state.config = {}; }
  renderTempLog();
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records)); }

// ── Date helpers ──────────────────────────────────────
function todayStr()    { return new Date().toISOString().split('T')[0]; }
function nowTimestamp(){ return new Date().toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); }
function nowISO()      { return new Date().toISOString(); }

function renderTodayDate() {
  const el = document.getElementById('today-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function setWeekRange() {
  const el = document.getElementById('week-range-display'); if (!el) return;
  const now = new Date(), mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay()+6)%7));
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const fmt = d => d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  el.textContent = `Week: ${fmt(mon)} — ${fmt(sun)}`;
}
function prefillDates() {
  const toEl = document.getElementById('history-date-to');
  const frEl = document.getElementById('history-date-from');
  if (toEl) toEl.value = todayStr();
  if (frEl) { const d = new Date(); d.setDate(d.getDate()-7); frEl.value = d.toISOString().split('T')[0]; }
}

// ── Tab navigation ────────────────────────────────────
function showTab(tabId) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  if (tabId === 'dashboard') {
    if (state.config.sheetsUrl) pullAllRecords().then(updateDashboard);
    else updateDashboard();
  }
  if (tabId === 'tasks') {
    renderTasksTab();
  }
  if (tabId === 'closing') {
    renderUndoneTasksSection();
  }
  if (tabId === 'temperature') {
    applyFoodProbeVisibility();
    renderFoodProbeLog();
    updateFoodProbeDayStatus();
    renderTempLog();
    if (state.config.sheetsUrl) {
      pullAllRecords().then(() => {
        renderTempLog();
        renderFoodProbeLog();
        updateFoodProbeDayStatus();
      });
    }
  }
  if (tabId === 'history') {
    if (state.config.sheetsUrl) pullAllRecords().then(loadHistory);
    else loadHistory();
  }
}

// ── Checklist submission ──────────────────────────────
function submitChecklist(type) {
  const formEl = document.getElementById('form-' + type); if (!formEl) return;
  const signedEl = formEl.querySelector('[data-key$="_signed_by"]');
  const signed   = signedEl?.value?.trim();
  if (!signed) { showToast('Please select a staff member to sign off', 'error'); return; }

  const dept   = currentDept();
  const record = {
    id:        crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    type, dept,
    date:      todayStr(),
    timestamp: nowTimestamp(),
    iso:       nowISO(),
    fields:    {},
    summary:   '',
  };

  let total = 0, checked = 0;
  formEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    total++; if (cb.checked) checked++;
    record.fields[cb.dataset.key] = cb.checked ? 'Yes' : 'No';
  });
  formEl.querySelectorAll('[data-key]:not([type="checkbox"])').forEach(el => {
    record.fields[el.dataset.key] = el.value || '';
  });
  if (type === 'weekly') record.fields.weekly_rating = state.weeklyRating || 'Not rated';

  record.summary = `${checked}/${total} checks passed · Signed: ${signed}`;
  state.records.push(record);
  saveState();
  syncRecordToSheets(record);

  formEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  formEl.querySelectorAll('textarea, input[type="text"], select.signed-by-select').forEach(el => {
    if (el.classList.contains('signed-by-select')) {
      const me = currentStaffMember();
      el.value = me ? me.name : '';
    } else { el.value = ''; }
  });
  if (type === 'weekly') {
    state.weeklyRating = '';
    document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
  }

  updateDashboard();
  showToast(`${labelFor(type)} submitted ✓`, 'success');
  setTimeout(() => showTab('dashboard'), 1200);
}

// ── Temperature logging ───────────────────────────────
function logTemperature() {
  const location = document.getElementById('temp-location').value;
  const value    = document.getElementById('temp-value').value;
  const probe    = document.getElementById('temp-probe').value;
  const action   = document.getElementById('temp-action').value;
  const staff    = document.getElementById('temp-staff').value;

  if (!location)    { showToast('Please select a location', 'error'); return; }
  if (value === '')  { showToast('Please enter a temperature', 'error'); return; }
  if (!staff.trim()) { showToast('Please select a staff member', 'error'); return; }

  const temp   = parseFloat(value);
  const status = getTempStatus(location, temp);
  const dept   = currentDept();

  const record = {
    id:        crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    type:      'temperature', dept,
    date:      todayStr(),
    timestamp: nowTimestamp(),
    iso:       nowISO(),
    fields: {
      temp_location:          location,
      temp_value:             temp.toString(),
      temp_unit:              '°C',
      temp_probe:             probe,
      temp_status:            status,
      temp_corrective_action: action || 'None required',
      temp_logged_by:         staff,
    },
    summary: `${location}: ${temp}°C (${status}) · ${staff}`,
  };

  state.records.push(record);
  saveState();
  syncRecordToSheets(record);

  document.getElementById('temp-location').value = '';
  document.getElementById('temp-value').value    = '';
  document.getElementById('temp-action').value   = '';

  renderTempLog();
  updateDashboard();
  showToast(`${temp}°C logged ${status === 'FAIL' ? '⚠ OUT OF RANGE' : '✓'}`,
    status === 'FAIL' ? 'error' : 'success');
}

function getTempStatus(location, temp) {
  const loc = location.toLowerCase();
  if (loc.includes('fridge')||loc.includes('display')||loc.includes('chilled')||loc.includes('bar')||loc.includes('wine')) {
    return temp<=5 ? 'OK' : temp<=8 ? 'WARNING' : 'FAIL';
  }
  if (loc.includes('freezer')||loc.includes('frozen')) {
    return temp<=-18 ? 'OK' : temp>-18&&temp<=-15 ? 'WARNING' : 'FAIL';
  }
  if (loc.includes('hot')||loc.includes('soup')||loc.includes('sauce')) {
    return temp>=63 ? 'OK' : temp>=55 ? 'WARNING' : 'FAIL';
  }
  if (loc.includes('cooked')||loc.includes('oven')||loc.includes('grill')||loc.includes('fryer')) {
    return temp>=75 ? 'OK' : temp>=65 ? 'WARNING' : 'FAIL';
  }
  return (temp<-30||temp>90) ? 'FAIL' : 'OK';
}

function renderTempLog() {
  const list = document.getElementById('temp-log-list'); if (!list) return;
  const dept    = currentDept();
  const today   = todayStr();
  // Management sees all, others see their dept
  const entries = state.records
    .filter(r => r.type==='temperature' && r.date===today && (isManagement() || !r.dept || r.dept===dept))
    .sort((a,b) => new Date(b.iso) - new Date(a.iso));

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">No readings logged today yet.</p>'; return;
  }
  list.innerHTML = entries.map(r => {
    const s = r.fields.temp_status||'OK';
    const cls = s==='OK'?'ok':s==='WARNING'?'warn':'fail';
    const deptBadge = isManagement() && r.dept ? ` <span style="font-size:10px;opacity:0.6">${DEPARTMENTS[r.dept]?.icon||''}</span>` : '';
    return `
      <div class="temp-log-entry">
        <div>
          <div class="temp-entry-location">${r.fields.temp_location}${deptBadge}</div>
          <div class="temp-entry-detail">Probe: ${r.fields.temp_probe} · By: ${r.fields.temp_logged_by}
            ${r.fields.temp_corrective_action!=='None required'?` · Action: ${r.fields.temp_corrective_action}`:''}
          </div>
        </div>
        <div class="temp-value-badge ${cls}">${r.fields.temp_value}°C</div>
        <div class="temp-entry-time">${r.timestamp.split(',')[1]?.trim()||''}</div>
      </div>`;
  }).join('');
}

// ── Food Probe (Kitchen only) ─────────────────────────
function applyFoodProbeVisibility() {
  const section = document.getElementById('food-probe-section');
  if (!section) return;
  const show = currentDept() === 'kitchen' || isManagement();
  section.style.display = show ? 'block' : 'none';
}

function logFoodProbe() {
  const product = document.getElementById('probe-product')?.value.trim();
  const tempVal = document.getElementById('probe-temp')?.value;
  const probe   = document.getElementById('probe-instrument')?.value;
  const staff   = document.getElementById('probe-staff')?.value?.trim();
  const action  = document.getElementById('probe-action')?.value?.trim();

  if (!product)    { showToast('Enter the product or dish name', 'error'); return; }
  if (tempVal === '') { showToast('Enter a temperature', 'error'); return; }
  if (!staff)      { showToast('Select a staff member', 'error'); return; }

  const temp   = parseFloat(tempVal);
  const passed = temp >= 75;
  const status = passed ? 'PASS' : 'FAIL';

  const record = {
    id:        crypto.randomUUID ? crypto.randomUUID() : 'fp_' + Date.now(),
    type:      'food_probe',
    dept:      'kitchen',
    date:      todayStr(),
    timestamp: nowTimestamp(),
    iso:       nowISO(),
    fields: {
      probe_product:  product,
      probe_temp:     temp.toString(),
      probe_status:   status,
      probe_used:     probe,
      probe_action:   action || (passed ? 'None required' : ''),
      probe_staff:    staff,
    },
    summary: `${product}: ${temp}°C (${status}) · ${staff}`,
  };

  state.records.push(record);
  saveState();
  syncRecordToSheets(record);

  // Clear form
  document.getElementById('probe-product').value = '';
  document.getElementById('probe-temp').value    = '';
  document.getElementById('probe-action').value  = '';

  renderFoodProbeLog();
  updateFoodProbeDayStatus();
  updateDashboard();

  showToast(
    passed ? `${product}: ${temp}°C ✓ PASS` : `${product}: ${temp}°C ⚠ FAIL — below 75°C`,
    passed ? 'success' : 'error'
  );

  // Show corrective action field if fail
  const actionGroup = document.getElementById('probe-action-group');
  if (actionGroup) actionGroup.style.display = passed ? 'none' : 'block';
}

function renderFoodProbeLog() {
  const list = document.getElementById('food-probe-log-list');
  if (!list) return;

  const today   = todayStr();
  const dept    = currentDept();
  const entries = state.records
    .filter(r => r.type === 'food_probe' && r.date === today &&
      (isManagement() || r.dept === 'kitchen'))
    .sort((a, b) => new Date(b.iso) - new Date(a.iso));

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state" style="padding:20px 0">No food probe checks logged today yet.</p>';
    return;
  }

  list.innerHTML = entries.map(r => {
    const passed = r.fields.probe_status === 'PASS';
    const cls    = passed ? 'ok' : 'fail';
    const hasAction = r.fields.probe_action && r.fields.probe_action !== 'None required';
    return `
      <div class="temp-log-entry">
        <div style="flex:1">
          <div class="temp-entry-location">${r.fields.probe_product}</div>
          <div class="temp-entry-detail">
            ${r.fields.probe_used} · ${r.fields.probe_staff}
            ${hasAction ? ` · <span style="color:var(--warning)">Action: ${r.fields.probe_action}</span>` : ''}
          </div>
        </div>
        <div class="temp-value-badge ${cls}">${r.fields.probe_temp}°C</div>
        <div class="temp-entry-time">${r.timestamp.split(',')[1]?.trim() || ''}</div>
      </div>`;
  }).join('');
}

function updateFoodProbeDayStatus() {
  const el = document.getElementById('food-probe-day-status');
  if (!el) return;
  const today  = todayStr();
  const checks = state.records.filter(r => r.type === 'food_probe' && r.date === today);
  const fails  = checks.filter(r => r.fields.probe_status === 'FAIL');

  if (!checks.length) {
    el.innerHTML = `<span class="probe-status-badge probe-none">0 today — 1 required</span>`;
  } else if (fails.length) {
    el.innerHTML = `<span class="probe-status-badge probe-fail">${checks.length} logged · ${fails.length} FAIL</span>`;
  } else {
    el.innerHTML = `<span class="probe-status-badge probe-ok">${checks.length} logged ✓</span>`;
  }
}

function hasFoodProbeToday() {
  return state.records.some(r => r.type === 'food_probe' && r.date === todayStr());
}
function setRating(value, btn) {
  state.weeklyRating = value;
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

// ── Dashboard ─────────────────────────────────────────
function updateDashboard() {
  if (isManagement()) renderManagerDashboard();
  else                renderStaffDashboard();
  renderDashAlerts();
  updateLastRefreshed();
}

// Manager: 3-column grid, one column per department
function renderManagerDashboard() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  const today = todayStr();

  grid.innerHTML = Object.entries(DEPARTMENTS).map(([deptId, deptInfo]) => {
    const deptRecords = state.records.filter(r => r.date===today && r.dept===deptId);

    const sections = deptId === 'mgmt'
      ? [{ type:'weekly', label:'Weekly Review', icon:'▦', total:20 }]
      : [
          { type:'opening',     label:'Opening',     icon:'☀', total: getActiveChecks(deptId,'opening').length  || 12 },
          { type:'temperature', label:'Temps',       icon:'⊕', total: null },
          { type:'cleaning',    label:'Cleaning',    icon:'◎', total: getActiveChecks(deptId,'cleaning').length || 14 },
          { type:'closing',     label:'Closing',     icon:'☽', total: getActiveChecks(deptId,'closing').length  || 10 },
          { type:'tasks',       label:'Tasks',       icon:'☑', total: null },
        ];

    const cards = sections.map(sec => {
      if (sec.type === 'tasks') {
        const { todayTasks, overdueTasks, doneTodayCount } = getTaskSummaryForDept(deptId);
        const hasOverdue = overdueTasks.length > 0;
        const allDone    = todayTasks.length > 0 && doneTodayCount === todayTasks.length;
        const pct        = todayTasks.length > 0 ? Math.round((doneTodayCount/todayTasks.length)*100) : 0;
        const status     = hasOverdue
          ? { text:`⚠ ${overdueTasks.length} overdue`, cls:'overdue' }
          : allDone ? { text:'✓ Today done', cls:'complete' }
          : todayTasks.length > 0 ? { text:`${doneTodayCount}/${todayTasks.length} today`, cls:'partial' }
          : { text:'—', cls:'' };
        return `<div class="mgr-card" onclick="showTab('tasks')">
          <div class="mgr-card-header"><span class="mgr-card-icon" style="color:#a78bfa">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:#a78bfa"></div></div>
          <div class="mgr-card-status ${status.cls}">${status.text}</div>
        </div>`;
      }
      if (sec.type === 'temperature') {
        const temps = deptRecords.filter(r => r.type==='temperature');
        const hasFail = temps.some(r => r.fields?.temp_status==='FAIL');
        const hasWarn = temps.some(r => r.fields?.temp_status==='WARNING');
        const status  = hasFail ? { text:'⚠ Breach', cls:'overdue' } : hasWarn ? { text:'! Warning', cls:'partial' } : temps.length > 0 ? { text:'✓ All OK', cls:'complete' } : { text:'—', cls:'' };
        const pct     = Math.min(100, temps.length * 12.5);
        return `<div class="mgr-card" onclick="showTab('temperature')">
          <div class="mgr-card-header"><span class="mgr-card-icon" style="color:var(--temp)">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:var(--temp)"></div></div>
          <div class="mgr-card-status ${status.cls}">${status.text} · ${temps.length} reading${temps.length!==1?'s':''}</div>
        </div>`;
      }
      const rec     = deptRecords.filter(r=>r.type===sec.type).sort((a,b)=>new Date(b.iso)-new Date(a.iso))[0];
      const total   = sec.total || 10;
      if (!rec) {
        return `<div class="mgr-card" onclick="showTab('${sec.type}')">
          <div class="mgr-card-header"><span class="mgr-card-icon">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
          <div class="pb"><div class="pf" style="width:0%"></div></div>
          <div class="mgr-card-status">Not done</div>
        </div>`;
      }
      const checks  = Object.values(rec.fields).filter(v=>v==='Yes'||v==='No');
      const passed  = checks.filter(v=>v==='Yes').length;
      const pct     = Math.round((passed/(checks.length||total))*100);
      const signed  = rec.fields?.open_signed_by||rec.fields?.close_signed_by||rec.fields?.clean_signed_by||rec.fields?.weekly_signed_by||'';
      const status  = pct===100 ? { text:`✓ ${signed||'Done'}`, cls:'complete' } : { text:`${pct}% · ${signed}`, cls:'partial' };
      return `<div class="mgr-card" onclick="showTab('${sec.type}')">
        <div class="mgr-card-header"><span class="mgr-card-icon">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
        <div class="pb"><div class="pf" style="width:${pct}%;background:var(--success)"></div></div>
        <div class="mgr-card-status ${status.cls}">${status.text}</div>
      </div>`;
    }).join('');

    return `
      <div class="dept-column">
        <div class="dept-col-header" style="color:${deptInfo.color}">
          ${deptInfo.icon} ${deptInfo.label}
        </div>
        ${cards}
      </div>`;
  }).join('');
}

// Staff: simple 2x2 grid for their dept only
function renderStaffDashboard() {
  const dept  = currentDept();
  const today = todayStr();
  const deptRecords = state.records.filter(r => r.date===today && (r.dept===dept || !r.dept));

  const cards = [
    { id:'opening',     label:'Opening Checks', icon:'☀', color:'var(--opening)', total: getActiveChecks(dept,'opening').length  || 12 },
    { id:'temperature', label:'Temperature',    icon:'⊕', color:'var(--temp)',    total: null },
    { id:'cleaning',    label:'Cleaning',       icon:'◎', color:'var(--clean)',   total: getActiveChecks(dept,'cleaning').length || 14 },
    { id:'closing',     label:'Closing Checks', icon:'☽', color:'var(--closing)', total: getActiveChecks(dept,'closing').length  || 10 },
    { id:'tasks',       label:'Weekly Tasks',   icon:'☑', color:'#a78bfa',        total: null },
  ];

  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  grid.innerHTML = `<div class="dashboard-grid-2col">${cards.map(card => {
    if (card.id === 'temperature') {
      const temps   = deptRecords.filter(r => r.type==='temperature');
      const hasFail = temps.some(r => r.fields?.temp_status==='FAIL');
      const hasWarn = temps.some(r => r.fields?.temp_status==='WARNING');
      const pct     = Math.min(100, temps.length * 12.5);
      const statText = hasFail ? '⚠ BREACH' : hasWarn ? '! Warning' : temps.length>0 ? '✓ All OK' : '—';
      const statCls  = hasFail ? 'overdue' : hasWarn ? 'partial' : temps.length>0 ? 'complete' : '';
      return `<div class="dash-card" onclick="showTab('temperature')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
          <div class="progress-label">${temps.length} reading${temps.length!==1?'s':''} today</div>
        </div>
        <div class="dash-card-status ${statCls}">${statText}</div>
      </div>`;
    }
    if (card.id === 'tasks') {
      const { todayTasks, overdueTasks, doneTodayCount } = getTaskSummaryForDept(dept);
      const hasOverdue = overdueTasks.length > 0;
      const allDone    = todayTasks.length > 0 && doneTodayCount === todayTasks.length;
      const pct        = todayTasks.length > 0 ? Math.round((doneTodayCount/todayTasks.length)*100) : 0;
      const statText   = hasOverdue ? `⚠ ${overdueTasks.length} overdue`
        : allDone ? '✓ Today done'
        : todayTasks.length > 0 ? `${doneTodayCount}/${todayTasks.length} today` : '—';
      const statCls    = hasOverdue ? 'overdue' : allDone ? 'complete' : todayTasks.length > 0 ? 'partial' : '';
      return `<div class="dash-card" onclick="showTab('tasks')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
          <div class="progress-label">${todayTasks.length} today · ${overdueTasks.length} overdue</div>
        </div>
        <div class="dash-card-status ${statCls}">${statText}</div>
      </div>`;
    }
    const rec    = deptRecords.filter(r=>r.type===card.id).sort((a,b)=>new Date(b.iso)-new Date(a.iso))[0];
    const total  = card.total||10;
    if (!rec) {
      return `<div class="dash-card" onclick="showTab('${card.id}')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div></div>
          <div class="progress-label">0 / ${total}</div>
        </div>
        <div class="dash-card-status">—</div>
      </div>`;
    }
    const checks = Object.values(rec.fields).filter(v=>v==='Yes'||v==='No');
    const passed = checks.filter(v=>v==='Yes').length;
    const pct    = Math.round((passed/(checks.length||total))*100);
    const signed = rec.fields?.open_signed_by||rec.fields?.close_signed_by||rec.fields?.clean_signed_by||'';
    return `<div class="dash-card" onclick="showTab('${card.id}')">
      <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
      <div class="dash-card-body"><h3>${card.label}</h3>
        <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
        <div class="progress-label">${passed} / ${checks.length||total}${signed?' · '+signed:''}</div>
      </div>
      <div class="dash-card-status ${pct===100?'complete':'partial'}">${pct===100?'✓ Complete':pct+'% done'}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderDashAlerts() {
  const el = document.getElementById('dash-alerts'); if (!el) return;
  const today = todayStr();
  const dept  = currentDept();
  const deptRecords = state.records.filter(r => r.date===today && (isManagement()||(r.dept===dept||!r.dept)));
  const alerts = [];
  const hour   = new Date().getHours();

  // Use dept-specific times from settings
  const openTime  = state.settings.openingTimes?.[dept]||'08:00';
  const closeTime = state.settings.closingTimes?.[dept]||'23:00';
  const openHour  = parseInt(openTime.split(':')[0]);
  const closeHour = parseInt(closeTime.split(':')[0]);

  if (!isManagement()) {
    if (hour >= openHour && !deptRecords.find(r=>r.type==='opening'))
      alerts.push(`⚠ Opening checks not yet completed today`);
    if (hour >= 15 && deptRecords.filter(r=>r.type==='temperature').length < 2)
      alerts.push(`⚠ Less than 2 temperature readings logged today`);
    // Food probe alert — kitchen only
    if (dept === 'kitchen' && hour >= 12 && !hasFoodProbeToday())
      alerts.push(`⚠ No food probe check logged today — at least 1 required`);
    if (hour >= closeHour && !deptRecords.find(r=>r.type==='closing'))
      alerts.push(`⚠ Closing checks not yet completed`);
  } else {
    // Manager sees cross-dept alerts
    ['kitchen','foh'].forEach(d => {
      const dr    = state.records.filter(r=>r.date===today&&r.dept===d);
      const dInfo = DEPARTMENTS[d];
      const oh    = parseInt((state.settings.openingTimes?.[d]||'08:00').split(':')[0]);
      const ch    = parseInt((state.settings.closingTimes?.[d]||'23:00').split(':')[0]);
      if (hour>=oh && !dr.find(r=>r.type==='opening'))
        alerts.push(`⚠ ${dInfo.icon} ${dInfo.label}: Opening checks not done`);
      if (hour>=ch && !dr.find(r=>r.type==='closing'))
        alerts.push(`⚠ ${dInfo.icon} ${dInfo.label}: Closing checks not done`);
    });
    // Food probe — kitchen specific
    if (hour >= 12 && !hasFoodProbeToday())
      alerts.push(`⚠ 🍳 Kitchen: No food probe check logged today`);
  }

  const breaches = deptRecords.filter(r=>r.type==='temperature'&&r.fields?.temp_status==='FAIL');
  if (breaches.length) alerts.push(`⚠ ${breaches.length} temperature breach${breaches.length>1?'es':''} today — check corrective actions`);

  el.innerHTML = alerts.map(a=>`<div class="dash-alert">${a}</div>`).join('');
}

function updateLastRefreshed() {
  const el = document.getElementById('dash-last-refresh');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
}

// ── Helpers ───────────────────────────────────────────
function labelFor(type) {
  return {
    opening:    'Opening Checks',
    closing:    'Closing Checks',
    cleaning:   'Cleaning Schedule',
    weekly:     'Weekly Review',
    temperature:'Temperature Log',
    food_probe: 'Food Probe Check',
  }[type] || type;
}

function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type}`; t.classList.remove('hidden');
  clearTimeout(t._timer); t._timer = setTimeout(()=>t.classList.add('hidden'), 3500);
}

// ── Modal / connection ────────────────────────────────
function connectGoogleSheets() {
  document.getElementById('setup-modal').classList.remove('hidden');
  if (state.config.sheetsUrl)     document.getElementById('sheets-url-input').value = state.config.sheetsUrl;
  if (state.config.sheetsViewUrl) document.getElementById('sheets-view-url-input').value = state.config.sheetsViewUrl;
}
function closeModal() { document.getElementById('setup-modal').classList.add('hidden'); }

function saveSheetConnection() {
  const url     = document.getElementById('sheets-url-input').value.trim();
  const viewUrl = document.getElementById('sheets-view-url-input').value.trim();
  if (!url||!url.startsWith('https://script.google.com')) { showToast('Invalid Apps Script URL', 'error'); return; }
  state.config.sheetsUrl     = url;
  state.config.sheetsViewUrl = viewUrl;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  closeModal(); checkConnectionStatus(); showToast('Connecting…');
  pullSettingsFromSheets().then(()=>{ rebuildAllChecklists(); rebuildSignedByDropdowns(); rebuildTempLocationDropdown(); rebuildProbeProductDropdown(); });
  pullAllRecords(true).then(()=>{ updateDashboard(); renderTempLog(); showToast('Connected & synced ✓','success'); startAutoPoll(); });
}

function disconnectSheets() {
  if (!confirm('Disconnect from Google Sheets? Local records will not be deleted.')) return;
  delete state.config.sheetsUrl; delete state.config.sheetsViewUrl;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  checkConnectionStatus(); showToast('Disconnected');
}

function checkConnectionStatus() {
  const statusEl = document.getElementById('sync-status');
  const labelEl  = statusEl?.querySelector('.sync-label');
  if (state.config.sheetsUrl) {
    statusEl?.classList.add('connected'); statusEl?.classList.remove('error','syncing');
    if (labelEl) labelEl.textContent = 'Connected';
    document.getElementById('btn-connect')?.classList.add('hidden');
    document.getElementById('btn-disconnect')?.classList.remove('hidden');
  } else {
    statusEl?.classList.remove('connected','error','syncing');
    if (labelEl) labelEl.textContent = 'Not connected';
    document.getElementById('btn-connect')?.classList.remove('hidden');
    document.getElementById('btn-disconnect')?.classList.add('hidden');
  }
}

function openSheetsUrl() {
  if (state.config.sheetsViewUrl) window.open(state.config.sheetsViewUrl,'_blank');
  else showToast('No spreadsheet URL saved — connect first','error');
}
