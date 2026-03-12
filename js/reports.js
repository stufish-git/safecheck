// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Reports v1.0
//  Management-only. Daily + Weekly views. Print support.
// ═══════════════════════════════════════════════════════

// ── Report mode state ─────────────────────────────────
let reportMode = 'daily'; // 'daily' | 'weekly'

function initReportsTab() {
  // Set max date for daily picker to today
  const dailyPicker = document.getElementById('report-daily-date');
  if (dailyPicker) {
    dailyPicker.max = todayStr();
    if (!dailyPicker.value) dailyPicker.value = todayStr();
  }
  // Populate weekly dropdown
  populateReportWeekSelector();
  // Render with current selection
  renderReport();
  // Update refresh button to show last-synced time
  updateReportSyncLabel();
}

// ── Refresh button ─────────────────────────────────────
function refreshReport() {
  const btn = document.getElementById('report-refresh-btn');
  if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }

  const out = document.getElementById('report-output');
  if (out) out.style.opacity = '0.4';

  const done = () => {
    if (btn) { btn.disabled = false; }
    if (out) out.style.opacity = '1';
    populateReportWeekSelector();
    renderReport();
    updateReportSyncLabel();
  };

  if (state.config.sheetsUrl) {
    pullAllRecords(true).then(done);
  } else {
    done();
  }
}

function updateReportSyncLabel() {
  const btn = document.getElementById('report-refresh-btn');
  if (!btn) return;
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  btn.textContent = `↻ Refresh · ${now}`;
}

function switchReportMode(mode) {
  reportMode = mode;
  document.getElementById('report-mode-daily')?.classList.toggle('active', mode === 'daily');
  document.getElementById('report-mode-weekly')?.classList.toggle('active', mode === 'weekly');
  document.getElementById('report-daily-controls')?.style.setProperty('display', mode === 'daily' ? 'flex' : 'none');
  document.getElementById('report-weekly-controls')?.style.setProperty('display', mode === 'weekly' ? 'flex' : 'none');
  renderReport();
}

function renderReport() {
  if (reportMode === 'daily') renderDailyReport();
  else renderWeeklyReport();
}

// ── Week selector ──────────────────────────────────────
function populateReportWeekSelector() {
  const sel = document.getElementById('report-week-select');
  if (!sel) return;
  const prev = sel.value;
  const weeks = getClosedWeeks(12); // includes current week
  sel.innerHTML = weeks.map((w, i) =>
    `<option value="${w.weekStart}">${i === 0 ? 'This week — ' : ''}${w.label}</option>`
  ).join('');
  if (prev && weeks.some(w => w.weekStart === prev)) sel.value = prev;
  else if (weeks.length) sel.value = weeks[0].weekStart;
}

// ─────────────────────────────────────────────────────
//  DAILY REPORT
// ─────────────────────────────────────────────────────
function renderDailyReport() {
  const date = document.getElementById('report-daily-date')?.value || todayStr();
  const container = document.getElementById('report-output');
  if (!container) return;

  // Check if the site was closed on this date (either dept closed = site closed)
  const kitchenOpen = isTrading('kitchen', date);
  const fohOpen     = isTrading('foh', date);
  const siteClosed  = !kitchenOpen && !fohOpen;

  const fmtDate = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const dr = state.records.filter(r => r.date === date);
  const allDepts = ['kitchen', 'foh'];

  // ── Compliance score ──────────────────────────────
  const cleaningEnabled = state.settings.cleaningEnabled;
  const checkTypes = cleaningEnabled ? ['opening','closing','cleaning'] : ['opening','closing'];
  const checkRecords = dr.filter(r => checkTypes.includes(r.type));
  let totalChecks = 0, passedChecks = 0;
  checkRecords.forEach(r => {
    Object.entries(r.fields || {}).forEach(([k, v]) => {
      if (v === 'Yes' || v === 'No') { totalChecks++; if (v === 'Yes') passedChecks++; }
    });
  });
  const compliancePct = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : null;
  const complianceColor = compliancePct === null ? 'var(--text-dim)'
    : compliancePct >= 90 ? 'var(--success)'
    : compliancePct >= 70 ? 'var(--warning)'
    : 'var(--danger)';

  // ── Opening checks (per dept) ─────────────────────
  const openingHTML = allDepts.map(dept => {
    const rec = dr.find(r => r.type === 'opening' && (r.dept === dept || (!r.dept && dept === 'kitchen')));
    const deptInfo = DEPARTMENTS[dept];
    return buildChecklistSection(rec, deptInfo, 'Opening Checks', 'open_signed_by', 'open_notes');
  }).join('');

  // ── Closing checks (per dept) ─────────────────────
  const closingHTML = allDepts.map(dept => {
    const rec = dr.find(r => r.type === 'closing' && (r.dept === dept || (!r.dept && dept === 'kitchen')));
    const deptInfo = DEPARTMENTS[dept];
    return buildChecklistSection(rec, deptInfo, 'Closing Checks', 'close_signed_by', 'close_notes');
  }).join('');

  // ── Cleaning checks (per dept, when enabled) ──────
  const cleaningHTML = cleaningEnabled ? allDepts.map(dept => {
    const rec = dr.find(r => r.type === 'cleaning' && (r.dept === dept || (!r.dept && dept === 'kitchen')));
    const deptInfo = DEPARTMENTS[dept];
    return buildChecklistSection(rec, deptInfo, 'Cleaning Schedule', 'clean_signed_by', 'clean_notes');
  }).join('') : '';

  // ── Equipment temperatures ────────────────────────
  const temps = dr.filter(r => r.type === 'temperature').sort((a, b) =>
    new Date(a.iso) - new Date(b.iso));
  const tempHTML = buildTemperatureTable(temps);

  // ── Food probes ───────────────────────────────────
  const probes = dr.filter(r => r.type === 'food_probe').sort((a, b) =>
    new Date(a.iso) - new Date(b.iso));
  const probeHTML = buildProbeTable(probes);

  // ── Goods In ─────────────────────────────────────
  const goodsIn = dr.filter(r => r.type === 'goods_in').sort((a, b) => new Date(a.iso) - new Date(b.iso));
  const goodsInHTML = buildGoodsInSection(goodsIn);

  // ── Tasks ─────────────────────────────────────────
  const taskHTML = buildDailyTaskGrid(date);

  container.innerHTML = `
    <div class="report-doc" id="report-printable">
      <div class="report-doc-header">
        <div>
          <div class="report-restaurant-name">${state.settings.restaurantName || 'SafeChecks'}</div>
          <div class="report-doc-date">${fmtDate}</div>
        </div>
        <div class="report-compliance-badge" style="border-color:${siteClosed ? 'var(--text-dim)' : complianceColor};color:${siteClosed ? 'var(--text-dim)' : complianceColor}">
          ${siteClosed
            ? `<span class="report-compliance-label">Closed</span>`
            : compliancePct !== null
              ? `<span class="report-compliance-pct">${compliancePct}%</span><span class="report-compliance-label">Compliance</span>`
              : `<span class="report-compliance-label">No checks recorded</span>`}
        </div>
      </div>

      ${siteClosed ? `<div class="report-closed-banner">🔒 Closed day — no checks expected. Any records below were submitted voluntarily.</div>` : ''}

      ${!siteClosed && compliancePct !== null ? `
      <div class="report-score-bar-wrap">
        <div class="report-score-bar-track">
          <div class="report-score-bar-fill" style="width:${compliancePct}%;background:${complianceColor}"></div>
        </div>
        <span class="report-score-bar-label" style="color:${complianceColor}">${passedChecks}/${totalChecks} checks passed</span>
      </div>` : ''}

      <div class="report-section-title">Opening Checks</div>
      <div class="report-two-col">${openingHTML}</div>

      <div class="report-section-title">Closing Checks</div>
      <div class="report-two-col">${closingHTML}</div>

      ${cleaningEnabled ? `
      <div class="report-section-title">Cleaning Schedule</div>
      <div class="report-two-col">${cleaningHTML}</div>
      ` : ''}

      <div class="report-section-title">Equipment Temperatures</div>
      ${tempHTML}

      <div class="report-section-title">Food Probes</div>
      ${probeHTML}

      <div class="report-section-title">Goods In</div>
      ${goodsInHTML}

      <div class="report-section-title">Tasks</div>
      ${taskHTML}
    </div>
  `;
}

// ── Checklist section builder ─────────────────────────
function buildChecklistSection(rec, deptInfo, title, signedByKey, notesKey) {
  if (!rec) {
    return `
      <div class="report-check-panel report-not-recorded">
        <div class="report-check-panel-header">
          <span style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span>
        </div>
        <div class="report-not-recorded-msg">— Not recorded</div>
      </div>`;
  }

  const checks = Object.entries(rec.fields || {}).filter(([, v]) => v === 'Yes' || v === 'No');
  const passed = checks.filter(([, v]) => v === 'Yes').length;
  const total = checks.length;
  const signed = rec.fields?.[signedByKey] || '';
  const notes = rec.fields?.[notesKey] || '';
  const hasIssues = checks.some(([, v]) => v === 'No');

  const checksHTML = checks.map(([key, val]) => {
    const label = getCheckLabel(key);  // look up from settings
    const icon = val === 'Yes' ? '✓' : '✗';
    const cls = val === 'Yes' ? 'report-check-pass' : 'report-check-fail';
    return `<div class="report-check-row ${cls}"><span class="report-check-icon">${icon}</span><span>${label}</span></div>`;
  }).join('');

  return `
    <div class="report-check-panel ${hasIssues ? 'report-has-issues' : ''}">
      <div class="report-check-panel-header">
        <span style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span>
        <span class="report-check-score ${passed === total ? 'all-pass' : 'has-fail'}">${passed}/${total}</span>
      </div>
      <div class="report-check-list">${checksHTML}</div>
      ${signed ? `<div class="report-signed-by">Signed by: ${signed}</div>` : ''}
      ${notes ? `<div class="report-notes-row">📝 ${notes}</div>` : ''}
      <div class="report-timestamp">${rec.timestamp}</div>
    </div>`;
}

// ── Temperature table ─────────────────────────────────
function buildTemperatureTable(temps) {
  if (!temps.length) {
    return `<div class="report-empty-row">— Not recorded</div>`;
  }

  const rows = temps.map(r => {
    const f = r.fields || {};
    const status = f.temp_status || 'OK';
    const cls = status === 'OK' ? 'status-ok' : status === 'WARNING' ? 'status-warn' : 'status-fail';
    const hasAction = f.temp_corrective_action && f.temp_corrective_action !== 'None required';
    const deptInfo = DEPARTMENTS[r.dept];
    return `
      <tr>
        <td>${deptInfo ? `<span style="color:${deptInfo.color}">${deptInfo.icon}</span> ` : ''}${f.temp_location || '—'}</td>
        <td class="report-temp-val">${f.temp_value ? f.temp_value + '°C' : '—'}</td>
        <td><span class="report-status-badge ${cls}">${status}</span></td>
        <td class="report-action-col">${hasAction ? `<span class="report-action-text">⚠ ${f.temp_corrective_action}</span>` : '<span class="report-ok-text">—</span>'}</td>
        <td class="report-meta">${f.temp_logged_by || '—'}<br><span class="report-time">${r.timestamp?.split(' ')[1] || ''}</span></td>
      </tr>`;
  }).join('');

  return `
    <table class="report-table">
      <thead><tr>
        <th>Location</th><th>Temp</th><th>Status</th><th>Corrective Action</th><th>Logged By</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Food probe table ──────────────────────────────────
function buildProbeTable(probes) {
  if (!probes.length) {
    return `<div class="report-empty-row">— Not recorded</div>`;
  }

  const rows = probes.map(r => {
    const f = r.fields || {};
    const passed = f.probe_status === 'PASS';
    const cls = passed ? 'status-ok' : 'status-fail';
    const hasAction = f.probe_action && f.probe_action !== 'None required';
    const cooling = f.probe_cooling_time || '';
    return `
      <tr>
        <td>${f.probe_product || '—'}</td>
        <td class="report-temp-val">${f.probe_temp ? f.probe_temp + '°C' : '—'}</td>
        <td><span class="report-status-badge ${cls}">${f.probe_status || '—'}</span></td>
        <td>${cooling ? `<span style="color:var(--temp)">❄️ ${cooling}</span>` : '<span style="color:var(--text-dim)">— served</span>'}</td>
        <td class="report-action-col">${hasAction ? `<span class="report-action-text">⚠ ${f.probe_action}</span>` : '<span class="report-ok-text">—</span>'}</td>
        <td class="report-meta">${f.probe_staff || '—'}<br><span class="report-time">${r.timestamp?.split(' ')[1] || ''}</span></td>
      </tr>`;
  }).join('');

  return `
    <table class="report-table">
      <thead><tr>
        <th>Product</th><th>Temp</th><th>Status</th><th>Cooling Time</th><th>Corrective Action</th><th>Staff</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Daily task grid ───────────────────────────────────
// Source of truth: state.records (cross-device, synced from Sheets)
// Tombstones (unticks on this device) are checked from localStorage
// to correctly handle cases where a task was ticked then unticked locally.
function buildDailyTaskGrid(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = d.getDay();
  const monOffset = (dayOfWeek + 6) % 7;
  const monday = new Date(d); monday.setDate(d.getDate() - monOffset);
  const weekStart = monday.toISOString().split('T')[0];
  const dayNames = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const dayName = dayNames[monOffset] || '';

  const allTasks = (state.settings.tasks || []).filter(t => t.enabled);
  // taskMatchesFrequency filters out first/last/odd/even tasks on wrong weeks
  const dayTasks = allTasks.filter(t => t.day === dayName && taskMatchesFrequency(t, weekStart));

  if (!dayTasks.length) {
    return `<div class="report-empty-row">No tasks scheduled for this day</div>`;
  }

  // Pull tombstones from localStorage so unticks are respected
  const localCompletions = JSON.parse(localStorage.getItem('safechecks_task_completions') || '{}');

  const rows = dayTasks.map(task => {
    // Primary: look for a synced task_completion record in state.records
    const taskRec = state.records.find(r =>
      r.type === 'task_completion' &&
      r.fields?.task_id === task.id &&
      r.fields?.task_week === weekStart
    );

    // Check for a local untick tombstone — this means someone ticked then unticked
    const localKey = `${weekStart}__${task.id}`;
    const isTombstoned = localCompletions[localKey]?.unticked === true;

    const done = !!taskRec && !isTombstoned;
    const doneBy = taskRec?.fields?.task_done_by || '—';
    const deptInfo = DEPARTMENTS[task.dept] || DEPARTMENTS['kitchen'];

    return `
      <tr>
        <td>${task.label}</td>
        <td><span style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span></td>
        <td>${done
          ? `<span class="report-status-badge status-ok">✓ Done</span>`
          : `<span class="report-status-badge status-notdone">— Not done</span>`}</td>
        <td class="report-meta">${done ? doneBy : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <table class="report-table">
      <thead><tr><th>Task</th><th>Department</th><th>Status</th><th>Completed By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─────────────────────────────────────────────────────
//  WEEKLY REPORT — detail section builders
// ─────────────────────────────────────────────────────

// ── Failed checklist items for the week ──────────────
function buildWeeklyFailedChecks(weekDates) {
  const rows = [];
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  weekDates.forEach(date => {
    const dayAbbr = DAY_ABBR[new Date(date + 'T12:00:00').getDay()];
    const shortDate = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });

    const checkTypes = [
      { type: 'opening', label: 'Opening' },
      { type: 'closing', label: 'Closing' },
      ...(state.settings.cleaningEnabled ? [{ type: 'cleaning', label: 'Cleaning' }] : []),
    ];

    checkTypes.forEach(({ type, label }) => {
      ['kitchen','foh'].forEach(dept => {
        const rec = state.records.find(r => r.date === date && r.type === type && r.dept === dept);
        if (!rec) return;
        const deptInfo = DEPARTMENTS[dept];
        const signed   = rec.fields?.open_signed_by || rec.fields?.close_signed_by || rec.fields?.clean_signed_by || '—';
        const notes    = rec.fields?.open_notes     || rec.fields?.close_notes     || rec.fields?.clean_notes     || '';

        Object.entries(rec.fields || {}).forEach(([key, val]) => {
          if (val !== 'No') return;
          const checkLabel = getCheckLabel(key);
          rows.push(`
            <div class="failed-check-row">
              <div class="failed-check-icon">✗</div>
              <div>
                <div class="failed-check-label">${checkLabel}</div>
                <div class="failed-check-meta">${deptInfo.icon} ${deptInfo.label} ${label} · ${dayAbbr} ${shortDate} · Signed: ${signed}</div>
                ${notes ? `<div class="failed-check-note">↳ ${notes}</div>` : ''}
              </div>
            </div>`);
        });
      });
    });
  });

  if (!rows.length) return '';
  return `
    <div class="report-section-title print-break-before">Failed Checks</div>
    <div class="failed-checks-list">${rows.join('')}</div>`;
}

// ── Temperature breaches for the week ────────────────
function buildWeeklyTempBreaches(weekDates) {
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const breaches = [];

  weekDates.forEach(date => {
    const dayAbbr   = DAY_ABBR[new Date(date + 'T12:00:00').getDay()];
    const shortDate = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    state.records
      .filter(r => r.date === date && r.type === 'temperature' && r.fields?.temp_status === 'FAIL')
      .sort((a, b) => new Date(a.iso) - new Date(b.iso))
      .forEach(r => {
        const f       = r.fields || {};
        const deptInfo = DEPARTMENTS[r.dept] || DEPARTMENTS.kitchen;
        const time    = r.timestamp?.split(' ')[1] || '';
        breaches.push(`
          <div class="breach-row">
            <div class="breach-left">
              <div class="breach-location">${f.temp_location || '—'}</div>
              <div class="breach-meta">${dayAbbr} ${shortDate}${time ? ' · ' + time : ''} · ${deptInfo.icon} ${deptInfo.label}${f.temp_probe ? ' · ' + f.temp_probe : ''}</div>
              ${f.temp_corrective_action && f.temp_corrective_action !== 'See notes'
                ? `<div class="breach-action">↳ ${f.temp_corrective_action}</div>` : ''}
            </div>
            <div class="breach-right">
              <div class="breach-temp">${f.temp_value ? f.temp_value + '°C' : '—'}</div>
              <div><span class="report-status-badge status-fail">FAIL</span></div>
            </div>
          </div>`);
      });
  });

  if (!breaches.length) return '';
  return `
    <div class="report-section-title print-break-before">Temperature Breaches</div>
    <div class="breach-list">${breaches.join('')}</div>`;
}

// ── Full equipment check log for the week ────────────
function buildWeeklyEquipmentLog(weekDates) {
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const allRecs  = [];

  weekDates.forEach(date => {
    state.records
      .filter(r => r.date === date && r.type === 'temperature')
      .sort((a, b) => new Date(a.iso) - new Date(b.iso))
      .forEach(r => allRecs.push(r));
  });

  if (!allRecs.length) {
    return `
      <div class="report-section-title print-break-before">Equipment Checks</div>
      <div class="report-empty-row">— No equipment checks recorded this week</div>`;
  }

  const totalFails = allRecs.filter(r => r.fields?.temp_status === 'FAIL').length;
  const chips = `
    <div class="probe-summary-chips" style="padding:0 20px 10px">
      <span class="probe-chip probe-chip-count">${allRecs.length} reading${allRecs.length !== 1 ? 's' : ''}</span>
      ${totalFails > 0
        ? `<span class="probe-chip probe-chip-fail">${totalFails} fail${totalFails !== 1 ? 's' : ''}</span>`
        : `<span class="probe-chip probe-chip-pass">All pass</span>`}
    </div>`;

  const rows = allRecs.map(r => {
    const f        = r.fields || {};
    const status   = f.temp_status || 'OK';
    const cls      = status === 'FAIL' ? 'status-fail' : status === 'WARNING' ? 'status-warn' : 'status-ok';
    const deptInfo = DEPARTMENTS[r.dept] || DEPARTMENTS.kitchen;
    const dayAbbr  = DAY_ABBR[new Date(r.date + 'T12:00:00').getDay()];
    const shortDate = new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const time     = r.timestamp?.split(' ')[1] || '';
    const action   = f.temp_corrective_action && f.temp_corrective_action !== 'None required' && f.temp_corrective_action !== 'See notes'
      ? f.temp_corrective_action : '';
    const isFail   = status === 'FAIL';

    return `<tr${isFail ? ' style="background:rgba(239,68,68,0.04)"' : ''}>
      <td style="font-weight:600;font-size:12px">${f.temp_location || '—'}</td>
      <td class="report-meta">${deptInfo.icon} ${deptInfo.label}</td>
      <td class="report-meta">${dayAbbr} ${shortDate}${time ? '<br><span style="font-size:10px;opacity:0.7">' + time + '</span>' : ''}</td>
      <td class="report-temp-val ${cls}">${f.temp_value ? f.temp_value + '°C' : '—'}</td>
      <td><span class="report-status-badge ${cls}">${status}</span></td>
      <td class="report-meta">${action ? `<span class="report-action-text">↳ ${action}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="report-section-title print-break-before">Equipment Checks</div>
    ${chips}
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr>
          <th>Equipment</th><th>Dept</th><th>Day / Time</th><th>Reading</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Full food probe log for the week ─────────────────
function buildWeeklyProbeLog(weekDates) {
  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const allRecs  = [];

  weekDates.forEach(date => {
    state.records
      .filter(r => r.date === date && r.type === 'food_probe')
      .sort((a, b) => new Date(a.iso) - new Date(b.iso))
      .forEach(r => allRecs.push(r));
  });

  if (!allRecs.length) {
    return `
      <div class="report-section-title print-break-before">Food Probe Results</div>
      <div class="report-empty-row">— No food probes recorded this week</div>`;
  }

  const totalFails = allRecs.filter(r => r.fields?.probe_status === 'FAIL').length;
  const chips = `
    <div class="probe-summary-chips" style="padding:0 20px 10px">
      <span class="probe-chip probe-chip-count">${allRecs.length} probe${allRecs.length !== 1 ? 's' : ''}</span>
      ${allRecs.length - totalFails > 0 ? `<span class="probe-chip probe-chip-pass">${allRecs.length - totalFails} passed</span>` : ''}
      ${totalFails > 0 ? `<span class="probe-chip probe-chip-fail">${totalFails} failed</span>` : ''}
    </div>`;

  const rows = allRecs.map(r => {
    const f       = r.fields || {};
    const status  = f.probe_status || 'PASS';
    const cls     = status === 'FAIL' ? 'status-fail' : 'status-ok';
    const dayAbbr = DAY_ABBR[new Date(r.date + 'T12:00:00').getDay()];
    const shortDate = new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const isFail  = status === 'FAIL';

    return `<tr${isFail ? ' style="background:rgba(239,68,68,0.04)"' : ''}>
      <td style="font-weight:600;font-size:12px">${f.probe_product || '—'}</td>
      <td class="report-meta">${dayAbbr} ${shortDate}</td>
      <td class="report-temp-val ${cls}">${f.probe_temp ? f.probe_temp + '°C' : '—'}</td>
      <td><span class="report-status-badge ${cls}">${status}</span></td>
      <td class="report-meta">${isFail && f.probe_action ? `<span class="report-action-text">↳ ${f.probe_action}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="report-section-title print-break-before">Food Probe Results</div>
    ${chips}
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr>
          <th>Product</th><th>Day</th><th>Core Temp</th><th>Status</th><th>Corrective Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Full cleaning log for the week ───────────────────
function buildWeeklyCleaningLog(weekDates) {
  if (!state.settings.cleaningEnabled) return '';

  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const allRecs  = [];

  weekDates.forEach(date => {
    state.records
      .filter(r => r.date === date && r.type === 'cleaning')
      .sort((a, b) => new Date(a.iso) - new Date(b.iso))
      .forEach(r => allRecs.push(r));
  });

  if (!allRecs.length) {
    return `
      <div class="report-section-title print-break-before">Cleaning Schedule</div>
      <div class="report-empty-row">— No cleaning checks recorded this week</div>`;
  }

  const totalFails = allRecs.reduce((n, r) => {
    const checks = Object.values(r.fields || {}).filter(v => v === 'Yes' || v === 'No');
    return n + checks.filter(v => v === 'No').length;
  }, 0);
  const chips = `
    <div class="probe-summary-chips" style="padding:0 20px 10px">
      <span class="probe-chip probe-chip-count">${allRecs.length} submission${allRecs.length !== 1 ? 's' : ''}</span>
      ${totalFails > 0
        ? `<span class="probe-chip probe-chip-fail">${totalFails} item${totalFails !== 1 ? 's' : ''} failed</span>`
        : `<span class="probe-chip probe-chip-pass">All items passed</span>`}
    </div>`;

  const rows = allRecs.map(r => {
    const f         = r.fields || {};
    const checks    = Object.entries(f).filter(([, v]) => v === 'Yes' || v === 'No');
    const passed    = checks.filter(([, v]) => v === 'Yes').length;
    const total     = checks.length;
    const hasFail   = passed < total;
    const deptInfo  = DEPARTMENTS[r.dept] || DEPARTMENTS.kitchen;
    const dayAbbr   = DAY_ABBR[new Date(r.date + 'T12:00:00').getDay()];
    const shortDate = new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const signed    = f.clean_signed_by || '—';
    const notes     = f.clean_notes || '';

    return `<tr${hasFail ? ' style="background:rgba(239,68,68,0.04)"' : ''}>
      <td class="report-meta">${deptInfo.icon} ${deptInfo.label}</td>
      <td class="report-meta">${dayAbbr} ${shortDate}</td>
      <td><span class="report-check-score ${passed === total ? 'all-pass' : 'has-fail'}">${passed}/${total}</span></td>
      <td><span class="report-status-badge ${hasFail ? 'status-fail' : 'status-ok'}">${hasFail ? '⚠ Issues' : '✓ Pass'}</span></td>
      <td class="report-meta">${signed}</td>
      <td class="report-meta">${notes ? `<span style="color:var(--text-muted);font-style:italic">${notes}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="report-section-title print-break-before">Cleaning Schedule</div>
    ${chips}
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr>
          <th>Dept</th><th>Day</th><th>Score</th><th>Status</th><th>Signed By</th><th>Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ─────────────────────────────────────────────────────
//  WEEKLY REPORT
// ─────────────────────────────────────────────────────
function renderWeeklyReport() {
  const weekStart = document.getElementById('report-week-select')?.value;
  if (!weekStart) {
    document.getElementById('report-output').innerHTML = '<p class="report-empty-row">No weeks available. Try refreshing.</p>';
    return;
  }

  const container = document.getElementById('report-output');

  // Build the 7 dates of this week
  const weekDates = [];
  const mon = new Date(weekStart + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }
  const [monDate, tueDate, wedDate, thuDate, friDate, satDate, sunDate] = weekDates;
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const shortDates = weekDates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });

  const weekLabel = `w/e ${weekEndingStr(weekStart)}`;

  // ── Per-day summary grid ──────────────────────────
  const allDepts = ['kitchen', 'foh'];
  const gridRows = buildWeeklyGrid(weekDates, dayLabels, shortDates, allDepts);

  // ── Compliance ────────────────────────────────────────
  const complianceHTML = buildWeeklyCompliance(weekDates, weekStart);

  // ── Weekly management review ──────────────────────
  const weeklyRec = state.records.find(r =>
    r.type === 'weekly' &&
    (r.fields?.week_start === weekStart || r.date === weekStart));
  const weeklyReviewHTML = buildWeeklyReviewSection(weeklyRec);

  // ── Detail sections ───────────────────────────────────
  const failedChecksHTML  = buildWeeklyFailedChecks(weekDates);
  const tempBreachesHTML  = buildWeeklyTempBreaches(weekDates);
  const equipLogHTML      = buildWeeklyEquipmentLog(weekDates);
  const probeLogHTML      = buildWeeklyProbeLog(weekDates);
  const cleaningLogHTML   = buildWeeklyCleaningLog(weekDates);

  container.innerHTML = `
    <div class="report-doc" id="report-printable">
      <div class="report-doc-header">
        <div>
          <div class="report-restaurant-name">${state.settings.restaurantName || 'SafeChecks'}</div>
          <div class="report-doc-date">Weekly Report — ${weekLabel}</div>
        </div>
        <div class="report-week-legend">
          <span class="legend-item legend-complete">✓ Complete</span>
          <span class="legend-item legend-issues">⚠ Issues</span>
          <span class="legend-item legend-notrecorded">— Not recorded</span>
        </div>
      </div>

      <div class="report-section-title">Daily Overview</div>
      <div class="report-weekly-grid-wrap">
        <table class="report-weekly-grid">
          <thead>
            <tr>
              <th class="wg-label-col">Check</th>
              ${dayLabels.map((d, i) => `<th class="wg-day-col"><div>${d}</div><div class="wg-date">${shortDates[i]}</div></th>`).join('')}
            </tr>
          </thead>
          <tbody>${gridRows}</tbody>
        </table>
      </div>

      <div class="report-section-title print-break-before">Compliance</div>
      ${complianceHTML}

      <div class="report-section-title print-break-before">Weekly Management Review</div>
      ${weeklyReviewHTML}

      ${failedChecksHTML}
      ${tempBreachesHTML}
      ${equipLogHTML}
      ${probeLogHTML}
      ${cleaningLogHTML}

      <div class="report-section-title">Goods In — Week Summary</div>
      ${buildWeeklyGoodsInTable(weekDates)}
    </div>
  `;
}

// ── Goods In section (daily report) ─────────────────
function buildGoodsInSection(records) {
  if (!records.length) {
    return `<div class="report-empty-row">— No deliveries recorded</div>`;
  }

  const total    = records.length;
  const accepted = records.filter(r => r.fields?.gi_outcome === 'accepted').length;
  const rejected = total - accepted;
  const hasFail  = records.some(r => r.fields?.gi_temp_status === 'FAIL');

  const chips = `
    <div class="gi-report-chips">
      <span class="gi-chip gi-chip-count">${total} deliver${total !== 1 ? 'ies' : 'y'}</span>
      ${accepted > 0 ? `<span class="gi-chip gi-chip-ok">${accepted} accepted</span>` : ''}
      ${rejected > 0 ? `<span class="gi-chip gi-chip-rej">${rejected} rejected</span>` : ''}
      ${hasFail   ? `<span class="gi-chip gi-chip-fail">Temp breach</span>` : ''}
    </div>`;

  const rows = records.map(r => {
    const f = r.fields || {};
    const isAccepted = f.gi_outcome === 'accepted';
    const tempCls = f.gi_temp_status === 'FAIL' ? 'status-fail' : f.gi_temp_status === 'WARNING' ? 'status-warn' : 'status-ok';
    const typeIcon = f.gi_type === 'frozen' ? '❄' : '🌿';
    return `
      <div class="gi-report-row ${isAccepted ? 'gi-row-accepted' : 'gi-row-rejected'}">
        <div class="gi-rr-left">
          <div class="gi-rr-supplier">${f.gi_supplier || '—'}</div>
          <div class="gi-rr-meta">${typeIcon} ${f.gi_type || ''} · ${r.timestamp?.split(' ')[1] || ''} · ${f.gi_signed_by || ''}</div>
          ${f.gi_notes ? `<div class="gi-rr-notes">${f.gi_notes}</div>` : ''}
        </div>
        <div class="gi-rr-right">
          <div class="gi-rr-temp report-temp-val ${tempCls}">${f.gi_temp ? f.gi_temp + '°C' : '—'}</div>
          <div class="gi-rr-outcome ${isAccepted ? 'report-ok-text' : ''}" style="${!isAccepted?'color:var(--danger)':''}">${isAccepted ? '✓ Accepted' : '✗ Rejected'}</div>
          <div class="gi-rr-expiry" style="color:${f.gi_expiry_checked==='Yes'?'var(--success)':'var(--text-dim)'}">
            ${f.gi_expiry_checked === 'Yes' ? '✓ Expiry checked' : 'Expiry not checked'}
          </div>
        </div>
      </div>`;
  }).join('');

  return chips + rows;
}

// ── Weekly day-by-day grid ────────────────────────────
// findRec: matches on date+type+dept; also accepts 'mgmt' dept records
// filed as kitchen/foh when management submitted without switching dept bar
function findRec(date, type, dept) {
  return state.records.find(r =>
    r.date === date &&
    r.type === type &&
    (r.dept === dept || (!r.dept && dept === 'kitchen'))
  );
}

function buildWeeklyGrid(weekDates, dayLabels, shortDates, allDepts) {
  const rows = [];

  // Opening checks per dept
  allDepts.forEach(dept => {
    const deptInfo = DEPARTMENTS[dept];
    const cells = weekDates.map(date => {
      const rec = findRec(date, 'opening', dept);
      return gridCell(rec, date, dept);
    }).join('');
    rows.push(`<tr><td class="wg-label-col"><span style="color:${deptInfo.color}">${deptInfo.icon}</span> Opening</td>${cells}</tr>`);
  });

  // Closing checks per dept
  allDepts.forEach(dept => {
    const deptInfo = DEPARTMENTS[dept];
    const cells = weekDates.map(date => {
      const rec = findRec(date, 'closing', dept);
      return gridCell(rec, date, dept);
    }).join('');
    rows.push(`<tr><td class="wg-label-col"><span style="color:${deptInfo.color}">${deptInfo.icon}</span> Closing</td>${cells}</tr>`);
  });

  // Cleaning checks per dept (when enabled)
  if (state.settings.cleaningEnabled) {
    allDepts.forEach(dept => {
      const deptInfo = DEPARTMENTS[dept];
      const cells = weekDates.map(date => {
        const rec = findRec(date, 'cleaning', dept);
        return gridCell(rec, date, dept);
      }).join('');
      rows.push(`<tr><td class="wg-label-col"><span style="color:${deptInfo.color}">${deptInfo.icon}</span> Cleaning</td>${cells}</tr>`);
    });
  }

  // Equipment checks (count per day, any dept)
  const equipCells = weekDates.map(date => {
    const recs = state.records.filter(r => r.date === date && r.type === 'temperature');
    if (!recs.length) return `<td class="wg-cell wg-notrecorded">—</td>`;
    const fails  = recs.filter(r => r.fields?.temp_status === 'FAIL').length;
    const warns  = recs.filter(r => r.fields?.temp_status === 'WARNING').length;
    const passes = recs.length - fails - warns;
    const hasFail = fails > 0;
    const hasWarn = warns > 0;
    const icon = hasFail ? '⚠' : hasWarn ? '⚠' : '✓';
    const cls  = hasFail ? 'wg-issues' : hasWarn ? 'wg-warn' : 'wg-complete';
    // If all pass: show single green count. If mixed: show pass✓ and fail✗ separately.
    const countHTML = (hasFail || hasWarn)
      ? `<span class="wg-count"><span style="color:var(--success)">${passes}✓</span> <span style="color:var(--danger)">${fails + warns}✗</span></span>`
      : `<span class="wg-count">${recs.length}</span>`;
    return `<td class="wg-cell ${cls}" title="${passes} pass, ${fails + warns} fail">${icon}${countHTML}</td>`;
  }).join('');
  rows.push(`<tr><td class="wg-label-col">🌡 Equipment</td>${equipCells}</tr>`);

  // Food probes (kitchen)
  const probeCells = weekDates.map(date => {
    const recs = state.records.filter(r => r.date === date && r.type === 'food_probe');
    if (!recs.length) return `<td class="wg-cell wg-notrecorded">—</td>`;
    const hasFail = recs.some(r => r.fields?.probe_status === 'FAIL');
    const icon = hasFail ? '⚠' : '✓';
    const cls = hasFail ? 'wg-issues' : 'wg-complete';
    return `<td class="wg-cell ${cls}">${icon}<span class="wg-count">${recs.length}</span></td>`;
  }).join('');
  rows.push(`<tr><td class="wg-label-col">🍖 Probes</td>${probeCells}</tr>`);

  // Goods in deliveries per day
  const giCells = weekDates.map(date => {
    const recs = state.records.filter(r => r.date === date && r.type === 'goods_in');
    if (!recs.length) return `<td class="wg-cell wg-notrecorded">—</td>`;
    const hasFail = recs.some(r => r.fields?.gi_temp_status === 'FAIL');
    const hasRej  = recs.some(r => r.fields?.gi_outcome === 'rejected');
    const cls = hasFail ? 'wg-issues' : hasRej ? 'wg-warn' : 'wg-complete';
    const icon = hasFail || hasRej ? '⚠' : '✓';
    return `<td class="wg-cell ${cls}" title="${recs.length} deliver${recs.length!==1?'ies':'y'}">${icon}<span class="wg-count">${recs.length}</span></td>`;
  }).join('');
  rows.push(`<tr><td class="wg-label-col">📦 Goods In</td>${giCells}</tr>`);

  return rows.join('');
}

function buildWeeklyGoodsInTable(weekDates) {
  const records = [];
  weekDates.forEach(date => {
    state.records.filter(r => r.date === date && r.type === 'goods_in')
      .sort((a, b) => new Date(a.iso) - new Date(b.iso))
      .forEach(r => records.push(r));
  });

  if (!records.length) {
    return `<div class="report-empty-row">— No deliveries this week</div>`;
  }

  const total    = records.length;
  const accepted = records.filter(r => r.fields?.gi_outcome === 'accepted').length;
  const rejected = total - accepted;

  const chips = `<div class="gi-report-chips">
    <span class="gi-chip gi-chip-count">${total} deliver${total !== 1 ? 'ies' : 'y'}</span>
    ${accepted > 0 ? `<span class="gi-chip gi-chip-ok">${accepted} accepted</span>` : ''}
    ${rejected > 0 ? `<span class="gi-chip gi-chip-rej">${rejected} rejected</span>` : ''}
  </div>`;

  const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const rows = records.map(r => {
    const f = r.fields || {};
    const isAcc   = f.gi_outcome === 'accepted';
    const tempCls = f.gi_temp_status === 'FAIL' ? 'status-fail' : f.gi_temp_status === 'WARNING' ? 'status-warn' : 'status-ok';
    const dayName = DAY_ABBR[new Date(r.date + 'T12:00:00').getDay()];
    const typeIcon = f.gi_type === 'frozen' ? '❄' : '🌿';
    return `<tr>
      <td><div style="font-weight:600;font-size:12px">${f.gi_supplier || '—'}</div>
          ${f.gi_notes ? `<div class="report-action-text" style="font-style:italic;font-size:11px">${f.gi_notes}</div>` : ''}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${dayName}</td>
      <td>${typeIcon} <span style="font-size:11px;color:var(--text-muted)">${f.gi_type || ''}</span></td>
      <td class="report-temp-val ${tempCls}">${f.gi_temp ? f.gi_temp + '°C' : '—'}</td>
      <td><span class="report-status-badge ${isAcc ? 'status-ok' : 'status-fail'}">${isAcc ? 'Accepted' : 'Rejected'}</span></td>
    </tr>`;
  }).join('');

  return chips + `<table class="report-table">
    <thead><tr>
      <th>Supplier</th><th>Day</th><th>Type</th><th>Temp</th><th>Outcome</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function gridCell(rec, date, dept) {
  if (!rec) {
    if (date && dept && !isTrading(dept, date)) {
      return `<td class="wg-cell wg-closed" title="Closed">—</td>`;
    }
    return `<td class="wg-cell wg-notrecorded">—</td>`;
  }
  const checks = Object.entries(rec.fields || {}).filter(([, v]) => v === 'Yes' || v === 'No');
  const passed = checks.filter(([, v]) => v === 'Yes').length;
  const total = checks.length;
  const hasFail = passed < total;
  const cls = hasFail ? 'wg-issues' : 'wg-complete';
  const icon = hasFail ? '⚠' : '✓';
  return `<td class="wg-cell ${cls}" title="${passed}/${total} checks passed">${icon}</td>`;
}

// ── Weekly compliance ──────────────────────────────────
function buildWeeklyCompliance(weekDates, weekStart) {
  const today        = todayStr();
  const DAYS_OF_WEEK = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  // Dates within this week that have already happened (including today)
  const elapsedDates = weekDates.filter(d => d <= today);

  const isCurrentWeek = weekDates.includes(today);

  function pctColor(pct) {
    return pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--danger)';
  }
  function pctCls(pct) { return pct >= 90 ? 'c-green' : pct >= 70 ? 'c-amber' : 'c-red'; }
  function bgCls(pct)  { return pct >= 90 ? 'bg-green' : pct >= 70 ? 'bg-amber' : 'bg-red'; }
  function rowIcon(pct){ return pct === 100 ? '✅' : pct >= 70 ? '⚠️' : '❌'; }

  function compRow(label, detail, actual, expected) {
    if (expected === 0) {
      return `<div class="compliance-row">
        <div class="compliance-row-icon" style="opacity:0.4">📋</div>
        <div style="flex:1">
          <div class="compliance-row-label" style="color:var(--text-muted)">${label}</div>
          <div class="compliance-row-detail">${detail}</div>
        </div>
        <div class="compliance-row-right"><div class="compliance-pct" style="color:var(--text-dim)">N/A</div></div>
      </div>`;
    }
    const pct = Math.round((actual / expected) * 100);
    return `<div class="compliance-row">
      <div class="compliance-row-icon">${rowIcon(pct)}</div>
      <div style="flex:1">
        <div class="compliance-row-label">${label}</div>
        <div class="compliance-row-detail">${detail}</div>
      </div>
      <div class="compliance-row-right">
        <div class="compliance-fraction">${actual} / ${expected}</div>
        <div class="compliance-bar-wrap">
          <div class="compliance-bar ${bgCls(pct)}" style="width:${pct}%"></div>
        </div>
        <div class="compliance-pct ${pctCls(pct)}">${pct}%</div>
      </div>
    </div>`;
  }

  function buildDeptCard(dept) {
    const deptInfo    = DEPARTMENTS[dept];
    const tradingDates = elapsedDates.filter(d => isTrading(dept, d));
    const tradingCount = tradingDates.length;

    // 1. Checks: opening + closing per trading day
    const checksExp = tradingCount * 2;    const checksAct = tradingDates.reduce((sum, date) => {
      let n = 0;
      if (state.records.find(r => r.date === date && r.type === 'opening' && r.dept === dept)) n++;
      if (state.records.find(r => r.date === date && r.type === 'closing' && r.dept === dept)) n++;
      return sum + n;
    }, 0);
    const checksMissed = checksExp - checksAct;
    const checksDetail = tradingCount === 0
      ? 'No trading days elapsed'
      : `${checksExp} expected (2 × ${tradingCount} day${tradingCount !== 1 ? 's' : ''})${checksMissed > 0 ? ` · ${checksMissed} missed` : ''}`;

    // 2. Equipment: 2 batch submissions per trading day
    //    batch_id groups a full submission; fall back to individual record id for legacy data
    const equipExp = tradingCount * 2;
    const equipAct = tradingDates.reduce((sum, date) => {
      const recs = state.records.filter(r =>
        r.date === date && r.type === 'temperature' && r.dept === dept
      );
      const batches = new Set(recs.map(r => r.fields?.batch_id || r.id));
      return sum + Math.min(batches.size, 2); // cap at 2 — extra submissions don't inflate score
    }, 0);
    const equipMissed = equipExp - equipAct;
    const equipDetail = tradingCount === 0
      ? 'No trading days elapsed'
      : `${equipExp} expected (2 × ${tradingCount} day${tradingCount !== 1 ? 's' : ''})${equipMissed > 0 ? ` · ${equipMissed} missed` : ''}`;

    // 3. Tasks: scheduled tasks for elapsed days only
    const elapsedDayNames = elapsedDates.map(d => DAYS_OF_WEEK[weekDates.indexOf(d)]);
    const scheduledTasks  = getAllTasksForWeek(dept, weekStart)
      .filter(t => elapsedDayNames.includes(t.day));
    const tasksExp = scheduledTasks.length;
    const tasksAct = scheduledTasks.filter(t => isTaskDone(weekStart, t.id)).length;
    const tasksDetail = tasksExp === 0
      ? 'No tasks scheduled so far this week'
      : `${tasksExp} scheduled so far · ${tasksAct} completed`;

    // 4. Food probes: kitchen only, 1 per kitchen trading day
    let probeExp = 0, probeAct = 0, probeDetail = '';
    if (dept === 'kitchen') {
      probeExp    = tradingCount;
      probeAct    = tradingDates.filter(date =>
        state.records.some(r => r.date === date && r.type === 'food_probe')
      ).length;
      const probeMissed = probeExp - probeAct;
      probeDetail = tradingCount === 0
        ? 'No trading days elapsed'
        : `${probeExp} expected (1 per day)${probeMissed > 0 ? ` · ${probeMissed} missed` : ''}`;
    }

    // 5. Cleaning: 1 per trading day per dept (when enabled)
    let cleanExp = 0, cleanAct = 0, cleanDetail = '';
    if (state.settings.cleaningEnabled) {
      cleanExp = tradingCount;
      cleanAct = tradingDates.filter(date =>
        state.records.some(r => r.date === date && r.type === 'cleaning' && r.dept === dept)
      ).length;
      const cleanMissed = cleanExp - cleanAct;
      cleanDetail = tradingCount === 0
        ? 'No trading days elapsed'
        : `${cleanExp} expected (1 per day)${cleanMissed > 0 ? ` · ${cleanMissed} missed` : ''}`;
    }

    // Overall dept score — average across all categories with data
    const cats = [
      { exp: checksExp, act: checksAct },
      { exp: equipExp,  act: equipAct  },
      ...(tasksExp  > 0  ? [{ exp: tasksExp,  act: tasksAct  }] : []),
      ...(dept === 'kitchen' && probeExp > 0 ? [{ exp: probeExp, act: probeAct }] : []),
      ...(cleanExp  > 0  ? [{ exp: cleanExp,  act: cleanAct  }] : []),
    ];
    const totalExp = cats.reduce((s, c) => s + c.exp, 0);
    const totalAct = cats.reduce((s, c) => s + c.act, 0);
    const overall  = totalExp > 0 ? Math.round((totalAct / totalExp) * 100) : 100;

    return `
      <div class="dept-compliance-card">
        <div class="dept-compliance-header">
          <div class="dept-compliance-name" style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</div>
          <div class="dept-overall-score">
            <div class="dept-overall-bar-wrap">
              <div class="dept-overall-bar" style="width:${overall}%;background:${pctColor(overall)}"></div>
            </div>
            <div class="dept-overall-pct" style="color:${pctColor(overall)}">${overall}%</div>
          </div>
        </div>
        <div class="compliance-rows">
          ${compRow('Opening & Closing Checks', checksDetail, checksAct, checksExp)}
          ${compRow('Equipment Checks',         equipDetail,  equipAct,  equipExp)}
          ${compRow('Tasks',                    tasksDetail,  tasksAct,  tasksExp)}
          ${dept === 'kitchen' ? compRow('Food Probes', probeDetail, probeAct, probeExp) : ''}
          ${state.settings.cleaningEnabled ? compRow('Cleaning Schedule', cleanDetail, cleanAct, cleanExp) : ''}
        </div>
      </div>`;
  }

  // Progress note — only shown for the current week
  const kitchenElapsed = elapsedDates.filter(d => isTrading('kitchen', d)).length;
  const kitchenTotal   = weekDates.filter(d => isTrading('kitchen', d)).length;
  const progressNote   = isCurrentWeek
    ? `<div class="compliance-progress-note">📅 ${kitchenElapsed} of ${kitchenTotal} trading day${kitchenTotal !== 1 ? 's' : ''} elapsed · compliance reflects the week so far</div>`
    : '';

  return progressNote + `<div class="compliance-wrap">${buildDeptCard('kitchen')}${buildDeptCard('foh')}</div>`;
}

// ── Label lookup — finds human label for a check id from settings ────
function getCheckLabel(id) {
  const s = state.settings || {};
  // Search all check sections
  const allSections = [
    ...(s.sharedChecks?.opening || []),
    ...(s.sharedChecks?.closing || []),
    ...(s.sharedChecks?.cleaning || []),
    ...(s.checks?.mgmt?.weekly || []),
    ...(s.checks?.mgmt?.opening || []),
    ...(s.checks?.mgmt?.closing || []),
    ...(s.checks?.kitchen?.opening || []),
    ...(s.checks?.kitchen?.closing || []),
    ...(s.checks?.kitchen?.cleaning || []),
    ...(s.checks?.foh?.opening || []),
    ...(s.checks?.foh?.closing || []),
    ...(s.checks?.foh?.cleaning || []),
  ];
  const found = allSections.find(c => c.id === id);
  if (found) return found.label;
  // Friendly fallback: strip leading letters+digits prefix e.g. mw1 → raw key prettified
  return id.replace(/^[a-z]+\d+$/, id) // keep as-is if it's a pure id like mw1
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Rating mismatch detection ─────────────────────────
// Expected rating based on weekly review check compliance:
//   Good           ≥ 90%
//   Satisfactory   70–89%
//   Needs Improvement < 70%
// Returns a warning string if the submitted rating is better than data suggests.
function getRatingMismatchWarning(submittedRating, passed, total) {
  if (!submittedRating || !total) return null;
  const pct = Math.round((passed / total) * 100);
  const expected = pct >= 90 ? 'Good' : pct >= 70 ? 'Satisfactory' : 'Needs Improvement';
  const rank = { 'Good': 2, 'Satisfactory': 1, 'Needs Improvement': 0 };
  if (rank[submittedRating] > rank[expected]) {
    return `Submitted as "${submittedRating}" but weekly check score is ${pct}% (${passed}/${total}) — data suggests "${expected}"`;
  }
  return null;
}

// ── Weekly management review section ──────────────────
function buildWeeklyReviewSection(rec) {
  if (!rec) {
    return `<div class="report-empty-row">— No weekly review submitted for this week</div>`;
  }

  const checks = Object.entries(rec.fields || {}).filter(([k, v]) => (v === 'Yes' || v === 'No') && !k.startsWith('weekly_'));
  const passed = checks.filter(([, v]) => v === 'Yes').length;
  const total = checks.length;
  const rating = rec.fields?.weekly_rating || '';
  const issues = rec.fields?.weekly_issues || '';
  const actions = rec.fields?.weekly_actions || '';
  const signed = rec.fields?.weekly_signed_by || '';

  const ratingColor = rating === 'Good' ? 'var(--success)' : rating === 'Satisfactory' ? 'var(--warning)' : rating === 'Needs Improvement' ? 'var(--danger)' : 'var(--text-muted)';

  const mismatch = getRatingMismatchWarning(rating, passed, total);

  const checksHTML = checks.map(([key, val]) => {
    const label = getCheckLabel(key);
    const icon = val === 'Yes' ? '✓' : '✗';
    const cls = val === 'Yes' ? 'report-check-pass' : 'report-check-fail';
    return `<div class="report-check-row ${cls}"><span class="report-check-icon">${icon}</span><span>${label}</span></div>`;
  }).join('');

  return `
    <div class="report-weekly-review">
      <div class="report-weekly-review-header">
        <div>
          <span class="report-check-score ${passed === total ? 'all-pass' : 'has-fail'}">${passed}/${total} checks passed</span>
        </div>
        ${rating ? `<div class="report-rating-badge" style="border-color:${ratingColor};color:${ratingColor}">${rating}</div>` : ''}
      </div>
      ${mismatch ? `<div class="report-rating-mismatch">⚠ ${mismatch}</div>` : ''}
      ${checks.length ? `<div class="report-check-list report-check-two-col">${checksHTML}</div>` : ''}
      ${issues ? `<div class="report-field-row"><div class="report-field-label">Issues / Incidents</div><div class="report-field-value">${issues}</div></div>` : ''}
      ${actions ? `<div class="report-field-row"><div class="report-field-label">Follow-up Actions</div><div class="report-field-value">${actions}</div></div>` : ''}
      ${signed ? `<div class="report-signed-by">Signed by: ${signed}</div>` : ''}
      <div class="report-timestamp">${rec.timestamp}</div>
    </div>`;
}

// ─────────────────────────────────────────────────────
//  PRINT
// ─────────────────────────────────────────────────────
function printReport() {
  window.print();
}

// ─────────────────────────────────────────────────────
//  EMAIL REPORT
// ─────────────────────────────────────────────────────

function openEmailModal() {
  const modal = document.getElementById('email-report-modal');
  const subtitle = document.getElementById('email-modal-subtitle');
  const recipientsEl = document.getElementById('email-modal-recipients');

  // Set subtitle based on current mode
  if (reportMode === 'daily') {
    const date = document.getElementById('report-daily-date')?.value || todayStr();
    const fmtDate = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    subtitle.textContent = 'Daily report · ' + fmtDate;
  } else {
    const weekStart = document.getElementById('report-week-select')?.value || '';
    const fmtWeek = weekStart ? new Date(weekStart + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : '';
    subtitle.textContent = 'Weekly report · w/c ' + fmtWeek;
  }

  // Pre-fill recipients from settings
  const recipients = state.settings?.emailRecipients || [];
  recipientsEl.value = recipients.join(', ');

  modal.style.display = 'flex';
  recipientsEl.focus();
}

function closeEmailModal() {
  document.getElementById('email-report-modal').style.display = 'none';
}

async function sendReportEmail() {
  if (!state.config.sheetsUrl) {
    showToast('No Sheets URL configured in Settings', 'error');
    return;
  }

  const recipientsRaw = document.getElementById('email-modal-recipients').value;
  const recipients = recipientsRaw.split(',').map(r => r.trim()).filter(Boolean);
  if (!recipients.length) {
    showToast('Please enter at least one recipient', 'error');
    return;
  }

  const btn = document.getElementById('email-modal-send-btn');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    let url;
    if (reportMode === 'daily') {
      const date = document.getElementById('report-daily-date')?.value || todayStr();
      url = state.config.sheetsUrl + '?action=sendDailyEmail&date=' + encodeURIComponent(date) + '&recipients=' + encodeURIComponent(recipients.join(','));
    } else {
      const weekStart = document.getElementById('report-week-select')?.value;
      url = state.config.sheetsUrl + '?action=sendWeeklyEmail&weekStart=' + encodeURIComponent(weekStart) + '&recipients=' + encodeURIComponent(recipients.join(','));
    }

    const resp = await fetch(url, { method: 'GET', mode: 'cors' });
    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); } catch(e) {
      showToast('Bad response: ' + raw.substring(0, 120), 'error');
      return;
    }

    if (data.status === 'ok') {
      closeEmailModal();
      showToast('Email sent to ' + recipients.join(', '), 'success');
    } else {
      showToast('Error: ' + (data.message || JSON.stringify(data)), 'error');
    }
  } catch(err) {
    showToast('Failed to send: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Send';
    btn.disabled = false;
  }
}
