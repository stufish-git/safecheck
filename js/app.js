// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Core App v5.2
//  Equipment Checks · Food Probe · Dept-aware management
// ═══════════════════════════════════════════════════════

const APP_VERSION = '5.2.0';
const STORAGE_KEY = 'safechecks_records';
const CONFIG_KEY  = 'safechecks_config';

const state = {
  records:      [],
  config:       {},
  settings:     {},
  device:       null,
  weeklyRating: '',
  tabDept:      {},   // active dept per tab for management
  equipChecks:  {},   // current equipment check UI state
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
      renderEquipmentLog();
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
  renderEquipmentLog();
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records)); }

// ── Date helpers ──────────────────────────────────────
function todayStr()     { return new Date().toISOString().split('T')[0]; }
function nowTimestamp() { return new Date().toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); }
function nowISO()       { return new Date().toISOString(); }

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
  if (tabId === 'tasks') renderTasksTab();
  if (tabId === 'closing') renderUndoneTasksSection();

  // Restore draft tick state when opening a checklist tab
  if (['opening','closing','cleaning'].includes(tabId)) {
    const dept = getFormDept(tabId);
    restoreDraft(tabId, dept);
    updateChecklistProgress(tabId, dept);
  }

  if (tabId === 'equipment') {
    const dept = getFormDept('equipment');
    buildEquipmentCheckUI(dept);
    renderEquipmentLog(dept);
    updateEquipDayStatus();
    if (state.config.sheetsUrl) pullAllRecords().then(() => { renderEquipmentLog(dept); updateEquipDayStatus(); });
  }
  if (tabId === 'probe') {
    renderFoodProbeLog();
    updateFoodProbeDayStatus();
    if (state.config.sheetsUrl) pullAllRecords().then(() => { renderFoodProbeLog(); updateFoodProbeDayStatus(); });
  }
  if (tabId === 'history') {
    if (state.config.sheetsUrl) pullAllRecords().then(loadHistory);
    else loadHistory();
  }
}

// ── Form dept (management can switch per-form) ────────
function getFormDept(type) {
  if (!isManagement()) return currentDept();
  return state.tabDept[type] || 'kitchen';
}

function syncDeptBar(selectorId, activeDept) {
  const selector = document.getElementById(selectorId);
  if (!selector) return;
  selector.querySelectorAll('.dept-bar-btn').forEach(btn => {
    const isActive = btn.dataset.dept === activeDept;
    btn.classList.toggle('active', isActive);
    // Force inline style as fallback in case CSS class isn't applying
    btn.style.background   = isActive ? 'var(--success)' : '';
    btn.style.borderColor  = isActive ? 'var(--success)' : '';
    btn.style.color        = isActive ? '#000' : '';
  });
}

function setFormDept(type, dept) {
  state.tabDept[type] = dept;
  // Update selector button states
  const selectorId = type === 'equipment' ? 'equip-dept-selector' : `${type}-dept-selector`;
  syncDeptBar(selectorId, dept);
  // Rebuild form content for new dept
  if (['opening','closing','cleaning'].includes(type)) {
    rebuildChecklist(type, dept);
    const staff = getDeptStaff(dept);
    const formEl = document.getElementById('form-' + type);
    if (formEl) {
      formEl.querySelectorAll('.signed-by-select').forEach(sel => {
        sel.innerHTML = `<option value="">Select staff member...</option>` +
          staff.map(s => `<option value="${s.name}">${s.name} — ${s.role}</option>`).join('');
      });
    }
  } else if (type === 'equipment') {
    const staff = getDeptStaff(dept);
    const sel = document.getElementById('equip-staff');
    if (sel) {
      sel.innerHTML = `<option value="">Select staff member...</option>` +
        staff.map(s => `<option value="${s.name}">${s.name} — ${s.role}</option>`).join('');
    }
    buildEquipmentCheckUI(dept);
    renderEquipmentLog(dept);
    updateEquipDayStatus();
  }
}

// ── Checklist submission ──────────────────────────────
function submitChecklist(type) {
  const formEl = document.getElementById('form-' + type); if (!formEl) return;
  const signedEl = formEl.querySelector('[data-key$="_signed_by"]');
  const signed   = signedEl?.value?.trim();
  if (!signed) { showToast('Please select a staff member to sign off', 'error'); return; }

  // Use active dept for this form (management may have switched)
  const dept = getFormDept(type);

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

  // Clear draft — checks are now formally submitted
  clearDraft(type, dept);

  updateDashboard();
  showToast(`${labelFor(type)} submitted ✓`, 'success');
  setTimeout(() => showTab('dashboard'), 1200);
}

// ── Checklist progress bar ───────────────────────────
// Shows tick progress in the form header before formal submit
function updateChecklistProgress(type, dept) {
  const progEl = document.getElementById(`${type}-progress`);
  if (!progEl) return;
  const { ticked, total } = getDraftProgress(type, dept);
  if (!total) { progEl.style.display = 'none'; return; }
  const pct = Math.round((ticked / total) * 100);
  progEl.style.display = 'block';
  progEl.innerHTML = `
    <div class="draft-progress-bar">
      <div class="draft-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="draft-progress-label">${ticked} of ${total} ticked${ticked === total ? ' — ready to submit ✓' : ''}</div>`;
}

// ── Equipment check thresholds ────────────────────────
function getEquipThresholds(type) {
  const t = {
    fridge:  { label:'OK ≤5°C  ·  Alert 5–8°C  ·  Fail >8°C',            ok:v=>v<=5,    warn:v=>v>5&&v<=8,     fail:v=>v>8    },
    freezer: { label:'OK ≤-18°C  ·  Alert -18 to -15°C  ·  Fail >-15°C',  ok:v=>v<=-18,  warn:v=>v>-18&&v<=-15, fail:v=>v>-15  },
    hothold: { label:'OK ≥63°C  ·  Alert 55–63°C  ·  Fail <55°C',          ok:v=>v>=63,   warn:v=>v>=55&&v<63,   fail:v=>v<55   },
    oven:    { label:'OK ≥75°C  ·  Alert 65–75°C  ·  Fail <65°C',          ok:v=>v>=75,   warn:v=>v>=65&&v<75,   fail:v=>v<65   },
    other:   { label:'',                                                     ok:()=>true,   warn:()=>false,        fail:()=>false },
  };
  return t[type] || t.other;
}

// ── Build equipment check UI ──────────────────────────
function buildEquipmentCheckUI(dept) {
  const equipment = getDeptEquipment(dept);
  const container = document.getElementById('equip-check-list');
  if (!container) return;

  if (!equipment.length) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 0 10px">No equipment configured for this department.<br>Add equipment in <strong>Settings → Equipment</strong>.</div>`;
    return;
  }

  state.equipChecks = {};

  // Group by type
  const groups = {};
  equipment.forEach(e => { if (!groups[e.type]) groups[e.type]=[]; groups[e.type].push(e); });

  const ORDER  = ['fridge','freezer','hothold','oven','other'];
  const ICONS  = { fridge:'🧊', freezer:'❄', hothold:'♨', oven:'🔥', other:'⊕' };
  const LABELS = { fridge:'Fridges', freezer:'Freezers', hothold:'Hot Hold', oven:'Ovens & Grills', other:'Other' };

  // Sync dept bar button states to reflect current dept
  syncDeptBar('equip-dept-selector', dept);

  container.innerHTML = ORDER
    .filter(t => groups[t]?.length)
    .map(t => {
      const th = getEquipThresholds(t);
      return `
        <div class="equip-group">
          <div class="equip-group-header">${ICONS[t]} ${LABELS[t]}</div>
          ${groups[t].map(e => `
            <div class="equip-check-row" id="equip-row-${e.id}" data-equip-id="${e.id}" data-type="${t}">
              <div class="equip-row-main">
                <div class="equip-row-info">
                  <div class="equip-row-name">${e.name}</div>
                  ${th.label ? `<div class="equip-row-range">${th.label}</div>` : ''}
                </div>
                <div class="equip-status-buttons">
                  <button class="equip-btn equip-ok"   onclick="selectEquipStatus('${e.id}','OK')">✓<span> OK</span></button>
                  <button class="equip-btn equip-warn" onclick="selectEquipStatus('${e.id}','WARNING')">⚠<span> Alert</span></button>
                  <button class="equip-btn equip-fail" onclick="selectEquipStatus('${e.id}','FAIL')">✗<span> Fail</span></button>
                </div>
              </div>
              <div class="equip-row-detail hidden" id="equip-detail-${e.id}">
                <input type="number" step="0.1" class="equip-temp-input"
                  id="equip-temp-${e.id}" placeholder="Temperature °C (optional)"
                  oninput="autoStatusFromTemp('${e.id}','${t}',this.value)"/>
                <textarea class="equip-action-input hidden"
                  id="equip-action-${e.id}"
                  placeholder="Corrective action taken — e.g. Adjusted thermostat, moved stock to backup fridge..." rows="2"></textarea>
              </div>
            </div>`).join('')}
        </div>`;
    }).join('') +
    `<div class="equip-submit-bar">
      <button class="btn-submit" onclick="submitAllEquipment()">
        <span>Submit All Checks</span><span class="btn-icon">→</span>
      </button>
    </div>`;
}

// ── Select status on an equipment row ─────────────────
function selectEquipStatus(equipId, status) {
  const row      = document.getElementById(`equip-row-${equipId}`);
  const detail   = document.getElementById(`equip-detail-${equipId}`);
  const actionEl = document.getElementById(`equip-action-${equipId}`);
  if (!row) return;

  // Button selected state
  row.querySelectorAll('.equip-btn').forEach(b => b.classList.remove('selected'));
  const cls = status === 'OK' ? '.equip-ok' : status === 'WARNING' ? '.equip-warn' : '.equip-fail';
  row.querySelector(cls)?.classList.add('selected');

  // Row border colour
  row.classList.remove('status-ok','status-warn','status-fail','needs-action');
  row.classList.add(status === 'OK' ? 'status-ok' : status === 'WARNING' ? 'status-warn' : 'status-fail');

  // Show/hide detail section
  detail?.classList.remove('hidden');
  if (actionEl) {
    actionEl.classList.toggle('hidden', status !== 'FAIL');
    actionEl.required = status === 'FAIL';
  }

  if (!state.equipChecks[equipId]) state.equipChecks[equipId] = {};
  state.equipChecks[equipId].status = status;
}

// ── Auto-set status when temperature is typed ─────────
function autoStatusFromTemp(equipId, type, tempStr) {
  if (tempStr === '' || tempStr === null) return;
  const temp = parseFloat(tempStr);
  if (isNaN(temp)) return;
  const th = getEquipThresholds(type);
  const status = th.fail(temp) ? 'FAIL' : th.warn(temp) ? 'WARNING' : 'OK';
  selectEquipStatus(equipId, status);
  if (!state.equipChecks[equipId]) state.equipChecks[equipId] = {};
  state.equipChecks[equipId].temp = tempStr;
}

// ── Submit all equipment checks ───────────────────────
function submitAllEquipment() {
  const staff = document.getElementById('equip-staff')?.value?.trim();
  const probe = document.getElementById('equip-probe')?.value || 'Digital Probe 1';
  const dept  = getFormDept('equipment');

  if (!staff) { showToast('Please select a staff member', 'error'); return; }

  const rows = Array.from(document.querySelectorAll('.equip-check-row'));
  if (!rows.length) { showToast('No equipment to check', 'error'); return; }

  // All rows must have a status
  const unchecked = rows.filter(r =>
    !r.classList.contains('status-ok') &&
    !r.classList.contains('status-warn') &&
    !r.classList.contains('status-fail'));
  if (unchecked.length) {
    unchecked.forEach(r => r.classList.add('needs-action'));
    showToast(`${unchecked.length} item${unchecked.length>1?'s':''} not yet checked`, 'error');
    unchecked[0].scrollIntoView({ behavior:'smooth', block:'center' });
    return;
  }

  // FAIL rows must have a corrective action
  let missingAction = false;
  rows.forEach(row => {
    if (row.classList.contains('status-fail')) {
      const id = row.dataset.equipId;
      const action = document.getElementById(`equip-action-${id}`)?.value?.trim();
      if (!action) { row.classList.add('needs-action'); missingAction = true; }
      else row.classList.remove('needs-action');
    }
  });
  if (missingAction) { showToast('Enter corrective actions for all failed items', 'error'); return; }

  // Submit one record per row
  let submitted = 0;
  rows.forEach(row => {
    const equipId = row.dataset.equipId;
    const type    = row.dataset.type;
    const equip   = (state.settings.equipment || []).find(e => e.id === equipId);
    if (!equip) return;

    const status  = row.classList.contains('status-ok')   ? 'OK'
                  : row.classList.contains('status-warn')  ? 'WARNING' : 'FAIL';
    const tempVal = document.getElementById(`equip-temp-${equipId}`)?.value?.trim() || '';
    const action  = document.getElementById(`equip-action-${equipId}`)?.value?.trim() || '';

    const record = {
      id:        crypto.randomUUID ? crypto.randomUUID() : `eq_${Date.now()}_${submitted}`,
      type:      'temperature',
      dept,
      date:      todayStr(),
      timestamp: nowTimestamp(),
      iso:       nowISO(),
      fields: {
        temp_location:          equip.name,
        temp_value:             tempVal,
        temp_status:            status,
        temp_probe:             probe,
        temp_corrective_action: action || (status === 'OK' ? 'None required' : 'See notes'),
        temp_logged_by:         staff,
      },
      summary: `${equip.name}: ${tempVal ? tempVal+'°C ' : ''}${status} · ${staff}`,
    };
    state.records.push(record);
    syncRecordToSheets(record);
    submitted++;
  });

  saveState();

  // Reset form
  rows.forEach(row => {
    const id = row.dataset.equipId;
    row.classList.remove('status-ok','status-warn','status-fail','needs-action');
    row.querySelectorAll('.equip-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById(`equip-detail-${id}`)?.classList.add('hidden');
    const tempEl   = document.getElementById(`equip-temp-${id}`);
    const actionEl = document.getElementById(`equip-action-${id}`);
    if (tempEl)   tempEl.value   = '';
    if (actionEl) { actionEl.value = ''; actionEl.classList.add('hidden'); }
  });
  state.equipChecks = {};

  renderEquipmentLog(dept);
  updateEquipDayStatus();
  updateDashboard();
  showToast(`${submitted} equipment check${submitted!==1?'s':''} submitted ✓`, 'success');
}

// ── Equipment log (today's entries) ──────────────────
function renderEquipmentLog(dept) {
  const list = document.getElementById('equip-log-list'); if (!list) return;
  const today = todayStr();
  const d = dept || getFormDept('equipment');
  const entries = state.records
    .filter(r => r.type==='temperature' && r.date===today &&
      (isManagement() ? r.dept===d : (!r.dept || r.dept===currentDept())))
    .sort((a,b) => new Date(b.iso) - new Date(a.iso));

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">No equipment checks logged today yet.</p>';
    return;
  }
  list.innerHTML = entries.map(r => {
    const s   = r.fields.temp_status || 'OK';
    const cls = s==='OK' ? 'ok' : s==='WARNING' ? 'warn' : 'fail';
    const disp = r.fields.temp_value ? `${r.fields.temp_value}°C` : s;
    const hasAction = r.fields.temp_corrective_action && r.fields.temp_corrective_action !== 'None required';
    const deptBadge = isManagement() && r.dept ? `<span style="font-size:10px;opacity:0.6"> ${DEPARTMENTS[r.dept]?.icon||''}</span>` : '';
    return `
      <div class="temp-log-entry">
        <div style="flex:1">
          <div class="temp-entry-location">${r.fields.temp_location}${deptBadge}</div>
          <div class="temp-entry-detail">${r.fields.temp_logged_by}${hasAction ? ` · <span style="color:var(--warning)">Action: ${r.fields.temp_corrective_action}</span>` : ''}</div>
        </div>
        <div class="temp-value-badge ${cls}">${disp}</div>
        <div class="temp-entry-time">${r.timestamp.split(',')[1]?.trim()||''}</div>
      </div>`;
  }).join('');
}

function updateEquipDayStatus() {
  const el = document.getElementById('equip-day-status'); if (!el) return;
  const today = todayStr();
  const dept = getFormDept('equipment');
  const checks = state.records.filter(r =>
    r.type==='temperature' && r.date===today &&
    (isManagement() ? r.dept===dept : (!r.dept || r.dept===currentDept())));
  const fails = checks.filter(r => r.fields?.temp_status==='FAIL');
  const warns = checks.filter(r => r.fields?.temp_status==='WARNING');

  if (!checks.length)  el.innerHTML = `<span class="probe-status-badge probe-none">0 checks today</span>`;
  else if (fails.length) el.innerHTML = `<span class="probe-status-badge probe-fail">${checks.length} logged · ${fails.length} FAIL</span>`;
  else if (warns.length) el.innerHTML = `<span class="probe-status-badge probe-warn">${checks.length} logged · ${warns.length} Alert</span>`;
  else                 el.innerHTML = `<span class="probe-status-badge probe-ok">${checks.length} checks ✓</span>`;
}

// ── Food Probe (Probe tab) ────────────────────────────
function logFoodProbe() {
  const product = document.getElementById('probe-product')?.value.trim();
  const tempVal = document.getElementById('probe-temp')?.value;
  const probe   = document.getElementById('probe-instrument')?.value;
  const staff   = document.getElementById('probe-staff')?.value?.trim();
  const action  = document.getElementById('probe-action')?.value?.trim();

  if (!product)    { showToast('Select a product / dish', 'error'); return; }
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
      probe_product: product,
      probe_temp:    temp.toString(),
      probe_status:  status,
      probe_used:    probe,
      probe_action:  action || (passed ? 'None required' : ''),
      probe_staff:   staff,
    },
    summary: `${product}: ${temp}°C (${status}) · ${staff}`,
  };

  state.records.push(record);
  saveState();
  syncRecordToSheets(record);

  document.getElementById('probe-product').value = '';
  document.getElementById('probe-temp').value    = '';
  document.getElementById('probe-action').value  = '';

  const actionGroup = document.getElementById('probe-action-group');
  if (actionGroup) actionGroup.style.display = passed ? 'none' : 'block';

  renderFoodProbeLog();
  updateFoodProbeDayStatus();
  updateDashboard();
  showToast(passed ? `${product}: ${temp}°C ✓ PASS` : `${product}: ${temp}°C ⚠ FAIL — below 75°C`, passed ? 'success' : 'error');
}

function renderFoodProbeLog() {
  const list = document.getElementById('food-probe-log-list'); if (!list) return;
  const today = todayStr();
  const entries = state.records
    .filter(r => r.type==='food_probe' && r.date===today)
    .sort((a,b) => new Date(b.iso) - new Date(a.iso));

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">No food probe checks logged today yet.</p>';
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
          <div class="temp-entry-detail">${r.fields.probe_used} · ${r.fields.probe_staff}${hasAction ? ` · <span style="color:var(--warning)">Action: ${r.fields.probe_action}</span>` : ''}</div>
        </div>
        <div class="temp-value-badge ${cls}">${r.fields.probe_temp}°C</div>
        <div class="temp-entry-time">${r.timestamp.split(',')[1]?.trim()||''}</div>
      </div>`;
  }).join('');
}

function updateFoodProbeDayStatus() {
  const el = document.getElementById('food-probe-day-status'); if (!el) return;
  const today  = todayStr();
  const checks = state.records.filter(r => r.type==='food_probe' && r.date===today);
  const fails  = checks.filter(r => r.fields.probe_status==='FAIL');
  if (!checks.length)
    el.innerHTML = `<span class="probe-status-badge probe-none">0 today — 1 required</span>`;
  else if (fails.length)
    el.innerHTML = `<span class="probe-status-badge probe-fail">${checks.length} logged · ${fails.length} FAIL</span>`;
  else
    el.innerHTML = `<span class="probe-status-badge probe-ok">${checks.length} logged ✓</span>`;
}

function hasFoodProbeToday() {
  return state.records.some(r => r.type==='food_probe' && r.date===todayStr());
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

// Manager: 3-column grid, one column per dept
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
          { type:'temperature', label:'Equipment',   icon:'🌡', total: null },
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
        const temps   = deptRecords.filter(r => r.type==='temperature');
        const hasFail = temps.some(r => r.fields?.temp_status==='FAIL');
        const hasWarn = temps.some(r => r.fields?.temp_status==='WARNING');
        const status  = hasFail ? { text:'⚠ Breach', cls:'overdue' } : hasWarn ? { text:'! Warning', cls:'partial' } : temps.length > 0 ? { text:'✓ All OK', cls:'complete' } : { text:'—', cls:'' };
        const pct     = Math.min(100, temps.length * 12.5);
        return `<div class="mgr-card" onclick="showTab('equipment')">
          <div class="mgr-card-header"><span class="mgr-card-icon" style="color:var(--temp)">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:var(--temp)"></div></div>
          <div class="mgr-card-status ${status.cls}">${status.text} · ${temps.length} item${temps.length!==1?'s':''}</div>
        </div>`;
      }
      const rec   = deptRecords.filter(r=>r.type===sec.type).sort((a,b)=>new Date(b.iso)-new Date(a.iso))[0];
      const total = sec.total || 10;
      const tabTarget = sec.type === 'weekly' ? 'weekly' : sec.type;

      if (!rec) {
        // No submitted record — show draft tick progress
        const { ticked, total: dTotal } = getDraftProgress(sec.type, deptId);
        const t   = dTotal || total;
        const pct = t > 0 ? Math.round((ticked / t) * 100) : 0;
        const statusText = ticked > 0 ? `${ticked} of ${t} ticked` : 'Not done';
        const statusCls  = ticked > 0 ? 'partial' : '';
        return `<div class="mgr-card" onclick="showTab('${tabTarget}')">
          <div class="mgr-card-header"><span class="mgr-card-icon">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
          <div class="pb"><div class="pf" style="width:${pct}%;background:var(--success)"></div></div>
          <div class="mgr-card-status ${statusCls}">${statusText}</div>
        </div>`;
      }
      // Submitted record — show final count
      const checks = Object.values(rec.fields).filter(v=>v==='Yes'||v==='No');
      const passed = checks.filter(v=>v==='Yes').length;
      const n      = checks.length || total;
      const pct    = Math.round((passed / n) * 100);
      const signed = rec.fields?.open_signed_by||rec.fields?.close_signed_by||rec.fields?.clean_signed_by||rec.fields?.weekly_signed_by||'';
      const status = pct===100
        ? { text:`✓ ${signed||'Done'} · ${passed}/${n}`, cls:'complete' }
        : { text:`${passed} of ${n} · ${signed}`,        cls:'partial'  };
      return `<div class="mgr-card" onclick="showTab('${tabTarget}')">
        <div class="mgr-card-header"><span class="mgr-card-icon">${sec.icon}</span><span class="mgr-card-label">${sec.label}</span></div>
        <div class="pb"><div class="pf" style="width:${pct}%;background:var(--success)"></div></div>
        <div class="mgr-card-status ${status.cls}">${status.text}</div>
      </div>`;
    }).join('');

    return `
      <div class="dept-column">
        <div class="dept-col-header" style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</div>
        ${cards}
      </div>`;
  }).join('');
}

// Staff: simple grid for their dept
function renderStaffDashboard() {
  const dept  = currentDept();
  const today = todayStr();
  const dr    = state.records.filter(r => r.date===today && (r.dept===dept || !r.dept));

  let cards = [
    { id:'opening',   label:'Opening',      icon:'☀', color:'var(--opening)', total: getActiveChecks(dept,'opening').length  || 12 },
    { id:'equipment', label:'Equipment',    icon:'🌡', color:'var(--temp)',    total: null, tab:'equipment', recType:'temperature' },
    { id:'cleaning',  label:'Cleaning',     icon:'◎', color:'var(--clean)',   total: getActiveChecks(dept,'cleaning').length || 14 },
    { id:'closing',   label:'Closing',      icon:'☽', color:'var(--closing)', total: getActiveChecks(dept,'closing').length  || 10 },
    { id:'tasks',     label:'Weekly Tasks', icon:'☑', color:'#a78bfa',        total: null },
  ];
  if (dept === 'kitchen') {
    cards.splice(2, 0, { id:'probe', label:'Food Probe', icon:'🍖', color:'var(--success)', total: null, tab:'probe', recType:'food_probe' });
  }

  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  grid.innerHTML = `<div class="dashboard-grid-2col">${cards.map(card => {
    const tab     = card.tab || card.id;
    const recType = card.recType || card.id;

    if (card.id === 'equipment') {
      const temps   = dr.filter(r => r.type==='temperature');
      const hasFail = temps.some(r => r.fields?.temp_status==='FAIL');
      const hasWarn = temps.some(r => r.fields?.temp_status==='WARNING');
      const pct     = Math.min(100, temps.length * 12.5);
      const statText = hasFail ? '⚠ BREACH' : hasWarn ? '! Warning' : temps.length>0 ? '✓ All OK' : '—';
      const statCls  = hasFail ? 'overdue' : hasWarn ? 'partial' : temps.length>0 ? 'complete' : '';
      return `<div class="dash-card" onclick="showTab('equipment')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
          <div class="progress-label">${temps.length} check${temps.length!==1?'s':''} today</div>
        </div>
        <div class="dash-card-status ${statCls}">${statText}</div>
      </div>`;
    }
    if (card.id === 'probe') {
      const probes  = dr.filter(r => r.type==='food_probe');
      const hasFail = probes.some(r => r.fields?.probe_status==='FAIL');
      const pct     = Math.min(100, probes.length * 33);
      const statText = hasFail ? '⚠ FAIL' : probes.length>0 ? '✓ Logged' : new Date().getHours()>=12 ? '⚠ Due' : '—';
      const statCls  = hasFail ? 'overdue' : probes.length>0 ? 'complete' : new Date().getHours()>=12 ? 'partial' : '';
      return `<div class="dash-card" onclick="showTab('probe')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
          <div class="progress-label">${probes.length} check${probes.length!==1?'s':''} today</div>
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
    // Standard checklist card
    const rec   = dr.filter(r=>r.type===card.id).sort((a,b)=>new Date(b.iso)-new Date(a.iso))[0];
    const total = card.total || 10;

    if (!rec) {
      // No submitted record — show draft tick progress instead
      const { ticked, total: dTotal } = getDraftProgress(card.id, dept);
      const t     = dTotal || total;
      const pct   = t > 0 ? Math.round((ticked / t) * 100) : 0;
      const label = ticked > 0 ? `${ticked} of ${t} ticked` : `0 of ${t}`;
      const cls   = ticked > 0 ? 'partial' : '';
      return `<div class="dash-card" onclick="showTab('${tab}')">
        <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
        <div class="dash-card-body"><h3>${card.label}</h3>
          <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
          <div class="progress-label">${label}</div>
        </div>
        <div class="dash-card-status ${cls}">${ticked > 0 ? 'In progress' : '—'}</div>
      </div>`;
    }
    // Submitted record exists — show final count
    const checks = Object.values(rec.fields).filter(v=>v==='Yes'||v==='No');
    const passed = checks.filter(v=>v==='Yes').length;
    const n      = checks.length || total;
    const pct    = Math.round((passed / n) * 100);
    const signed = rec.fields?.open_signed_by||rec.fields?.close_signed_by||rec.fields?.clean_signed_by||'';
    return `<div class="dash-card" onclick="showTab('${tab}')">
      <div class="dash-card-icon" style="color:${card.color}">${card.icon}</div>
      <div class="dash-card-body"><h3>${card.label}</h3>
        <div class="dash-progress"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${card.color}"></div></div></div>
        <div class="progress-label">${passed} of ${n}${signed ? ' · ' + signed : ''}</div>
      </div>
      <div class="dash-card-status ${pct===100?'complete':'partial'}">${pct===100 ? '✓ Complete' : `${passed} / ${n} done`}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderDashAlerts() {
  const el = document.getElementById('dash-alerts'); if (!el) return;
  const today = todayStr();
  const dept  = currentDept();
  const dr    = state.records.filter(r => r.date===today && (isManagement()||(r.dept===dept||!r.dept)));
  const alerts = [];
  const hour   = new Date().getHours();
  const openTime  = state.settings.openingTimes?.[dept]||'08:00';
  const closeTime = state.settings.closingTimes?.[dept]||'23:00';
  const openHour  = parseInt(openTime.split(':')[0]);
  const closeHour = parseInt(closeTime.split(':')[0]);

  if (!isManagement()) {
    if (hour >= openHour && !dr.find(r=>r.type==='opening'))
      alerts.push(`⚠ Opening checks not yet completed today`);
    if (hour >= 15 && dr.filter(r=>r.type==='temperature').length < 2)
      alerts.push(`⚠ Less than 2 equipment checks logged today`);
    if (dept === 'kitchen' && hour >= 12 && !hasFoodProbeToday())
      alerts.push(`⚠ No food probe check logged today — at least 1 required`);
    if (hour >= closeHour && !dr.find(r=>r.type==='closing'))
      alerts.push(`⚠ Closing checks not yet completed`);
  } else {
    ['kitchen','foh'].forEach(d => {
      const ddr   = state.records.filter(r=>r.date===today&&r.dept===d);
      const dInfo = DEPARTMENTS[d];
      const oh    = parseInt((state.settings.openingTimes?.[d]||'08:00').split(':')[0]);
      const ch    = parseInt((state.settings.closingTimes?.[d]||'23:00').split(':')[0]);
      if (hour>=oh && !ddr.find(r=>r.type==='opening'))
        alerts.push(`⚠ ${dInfo.icon} ${dInfo.label}: Opening checks not done`);
      if (hour>=ch && !ddr.find(r=>r.type==='closing'))
        alerts.push(`⚠ ${dInfo.icon} ${dInfo.label}: Closing checks not done`);
    });
    if (hour >= 12 && !hasFoodProbeToday())
      alerts.push(`⚠ 🍳 Kitchen: No food probe check logged today`);
  }

  const breaches = dr.filter(r=>r.type==='temperature'&&r.fields?.temp_status==='FAIL');
  if (breaches.length) alerts.push(`⚠ ${breaches.length} temperature breach${breaches.length>1?'es':''} today`);

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
    temperature:'Equipment Temperature',
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
  pullSettingsFromSheets().then(()=>{
    rebuildAllChecklists(); rebuildSignedByDropdowns();
    rebuildTempLocationDropdown(); rebuildProbeProductDropdown();
  });
  pullAllRecords(true).then(()=>{
    updateDashboard(); renderEquipmentLog();
    showToast('Connected & synced ✓','success'); startAutoPoll();
  });
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

// ═══════════════════════════════════════════════════════
//  CHECKLIST DRAFT SYSTEM v5.3
//  Persistent tick state within a day — local + synced
// ═══════════════════════════════════════════════════════

// Draft key: "draft_{type}_{dept}_{YYYY-MM-DD}"
function draftKey(type, dept) {
  return `draft_${type}_${dept}_${todayStr()}`;
}

// Load draft from localStorage — returns {checkId: true/false, ...}
function loadDraft(type, dept) {
  try {
    const raw = localStorage.getItem(draftKey(type, dept));
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

// Save draft to localStorage
function saveDraft(type, dept, draft) {
  try {
    localStorage.setItem(draftKey(type, dept), JSON.stringify(draft));
  } catch(e) {}
}

// OR-merge two drafts — once ticked on any device, stays ticked
function mergeDrafts(local, remote) {
  const merged = { ...local };
  Object.entries(remote).forEach(([k, v]) => {
    if (v === true) merged[k] = true;   // ticked always wins
    else if (!(k in merged)) merged[k] = v;
  });
  return merged;
}

// Called when user ticks/unticks a box — saves locally and pushes to Sheets
function onCheckboxChange(type, dept, checkId, checked) {
  const draft = loadDraft(type, dept);
  if (checked) draft[checkId] = true;
  else delete draft[checkId];   // unticking removes it — allows correction before submit
  saveDraft(type, dept, draft);
  pushDraftToSheets(type, dept, draft);
  updateDashboard();
}

// Restore draft ticks into the form after rebuild
function restoreDraft(type, dept) {
  const draft  = loadDraft(type, dept);
  const formEl = document.getElementById('form-' + type);
  if (!formEl || !Object.keys(draft).length) return;
  formEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (draft[cb.dataset.key] === true) cb.checked = true;
  });
}

// Push draft to Sheets as an upsert (overwrites previous draft row for this day/dept/type)
async function pushDraftToSheets(type, dept, draft) {
  if (!state.config.sheetsUrl) return;
  try {
    const payload = {
      action:   'upsert',
      sheetTab: 'Drafts',
      upsertKey: `${type}_${dept}_${todayStr()}`,
      data: { type, dept, date: todayStr(), draft, timestamp: nowTimestamp() },
    };
    await fetch(state.config.sheetsUrl, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch(e) { /* silent — draft push is best-effort */ }
}

// Pull all drafts from Sheets and merge with local — called inside pullAllRecords
async function pullDraftsFromSheets() {
  if (!state.config.sheetsUrl) return;
  try {
    const url  = `${state.config.sheetsUrl}?action=readDrafts`;
    const resp = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.status !== 'ok' || !Array.isArray(data.drafts)) return;

    const today = todayStr();
    data.drafts
      .filter(d => d.date === today)
      .forEach(d => {
        if (!d.type || !d.dept || !d.draft) return;
        const local  = loadDraft(d.type, d.dept);
        const merged = mergeDrafts(local, d.draft);
        saveDraft(d.type, d.dept, merged);
      });

    // Re-apply ticks to all checklist forms — active or not
    // Safe to call unconditionally: restoreDraft only sets checked=true, never unticks
    ['opening','closing','cleaning'].forEach(t => {
      const dept = getFormDept(t);
      restoreDraft(t, dept);
      updateChecklistProgress(t, dept);
    });
  } catch(e) { console.warn('pullDraftsFromSheets error:', e); }
}

// Clear draft after successful submit
function clearDraft(type, dept) {
  localStorage.removeItem(draftKey(type, dept));
  // Push an empty draft to Sheets so other devices know it's been submitted
  pushDraftToSheets(type, dept, {});
}

// Progress indicator — how many boxes ticked today (for dashboard)
function getDraftProgress(type, dept) {
  const draft   = loadDraft(type, dept);
  const ticked  = Object.values(draft).filter(v => v === true).length;
  const checks  = getActiveChecks(dept, type);
  return { ticked, total: checks.length };
}
