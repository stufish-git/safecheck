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

  const fmtDate = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const dr = state.records.filter(r => r.date === date);
  const allDepts = ['kitchen', 'foh'];

  // ── Compliance score ──────────────────────────────
  const checkRecords = dr.filter(r => ['opening','closing'].includes(r.type));
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

  // ── Equipment temperatures ────────────────────────
  const temps = dr.filter(r => r.type === 'temperature').sort((a, b) =>
    new Date(a.iso) - new Date(b.iso));
  const tempHTML = buildTemperatureTable(temps);

  // ── Food probes ───────────────────────────────────
  const probes = dr.filter(r => r.type === 'food_probe').sort((a, b) =>
    new Date(a.iso) - new Date(b.iso));
  const probeHTML = buildProbeTable(probes);

  // ── Tasks ─────────────────────────────────────────
  const taskHTML = buildDailyTaskGrid(date);

  container.innerHTML = `
    <div class="report-doc" id="report-printable">
      <div class="report-doc-header">
        <div>
          <div class="report-restaurant-name">${state.settings.restaurantName || 'SafeChecks'}</div>
          <div class="report-doc-date">${fmtDate}</div>
        </div>
        <div class="report-compliance-badge" style="border-color:${complianceColor};color:${complianceColor}">
          ${compliancePct !== null
            ? `<span class="report-compliance-pct">${compliancePct}%</span><span class="report-compliance-label">Compliance</span>`
            : `<span class="report-compliance-label">No checks recorded</span>`}
        </div>
      </div>

      ${compliancePct !== null ? `
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

      <div class="report-section-title">Equipment Temperatures</div>
      ${tempHTML}

      <div class="report-section-title">Food Probes</div>
      ${probeHTML}

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
    return `
      <tr>
        <td>${f.probe_product || '—'}</td>
        <td class="report-temp-val">${f.probe_temp ? f.probe_temp + '°C' : '—'}</td>
        <td><span class="report-status-badge ${cls}">${f.probe_status || '—'}</span></td>
        <td class="report-action-col">${hasAction ? `<span class="report-action-text">⚠ ${f.probe_action}</span>` : '<span class="report-ok-text">—</span>'}</td>
        <td class="report-meta">${f.probe_staff || '—'}<br><span class="report-time">${r.timestamp?.split(' ')[1] || ''}</span></td>
      </tr>`;
  }).join('');

  return `
    <table class="report-table">
      <thead><tr>
        <th>Product</th><th>Temp</th><th>Status</th><th>Corrective Action</th><th>Staff</th>
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
  const dayTasks = allTasks.filter(t => t.day === dayName);

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

  // ── Week stats ────────────────────────────────────
  const statsHTML = buildWeekStats(weekDates);

  // ── Weekly management review ──────────────────────
  const weeklyRec = state.records.find(r =>
    r.type === 'weekly' &&
    (r.fields?.week_start === weekStart || r.date === weekStart));
  const weeklyReviewHTML = buildWeeklyReviewSection(weeklyRec);

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

      <div class="report-section-title">Week Summary</div>
      ${statsHTML}

      <div class="report-section-title">Weekly Management Review</div>
      ${weeklyReviewHTML}
    </div>
  `;
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
      return gridCell(rec);
    }).join('');
    rows.push(`<tr><td class="wg-label-col"><span style="color:${deptInfo.color}">${deptInfo.icon}</span> Opening</td>${cells}</tr>`);
  });

  // Closing checks per dept
  allDepts.forEach(dept => {
    const deptInfo = DEPARTMENTS[dept];
    const cells = weekDates.map(date => {
      const rec = findRec(date, 'closing', dept);
      return gridCell(rec);
    }).join('');
    rows.push(`<tr><td class="wg-label-col"><span style="color:${deptInfo.color}">${deptInfo.icon}</span> Closing</td>${cells}</tr>`);
  });

  // Equipment checks (count per day, any dept)
  const equipCells = weekDates.map(date => {
    const recs = state.records.filter(r => r.date === date && r.type === 'temperature');
    if (!recs.length) return `<td class="wg-cell wg-notrecorded">—</td>`;
    const hasFail = recs.some(r => r.fields?.temp_status === 'FAIL');
    const hasWarn = recs.some(r => r.fields?.temp_status === 'WARNING');
    const icon = hasFail ? '⚠' : hasWarn ? '⚠' : '✓';
    const cls = hasFail ? 'wg-issues' : hasWarn ? 'wg-warn' : 'wg-complete';
    return `<td class="wg-cell ${cls}" title="${recs.length} check${recs.length !== 1 ? 's' : ''}">${icon}<span class="wg-count">${recs.length}</span></td>`;
  }).join('');
  rows.push(`<tr><td class="wg-label-col">🌡 Temps</td>${equipCells}</tr>`);

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

  return rows.join('');
}

function gridCell(rec) {
  if (!rec) return `<td class="wg-cell wg-notrecorded">—</td>`;
  const checks = Object.entries(rec.fields || {}).filter(([, v]) => v === 'Yes' || v === 'No');
  const passed = checks.filter(([, v]) => v === 'Yes').length;
  const total = checks.length;
  const hasFail = passed < total;
  const cls = hasFail ? 'wg-issues' : 'wg-complete';
  const icon = hasFail ? '⚠' : '✓';
  return `<td class="wg-cell ${cls}" title="${passed}/${total} checks passed">${icon}</td>`;
}

// ── Week stats ─────────────────────────────────────────
function buildWeekStats(weekDates) {
  const allDepts = ['kitchen', 'foh'];
  const statsRows = [];

  allDepts.forEach(dept => {
    const deptInfo = DEPARTMENTS[dept];
    let totalChecks = 0, passedChecks = 0, tempChecks = 0, tempFails = 0;

    weekDates.forEach(date => {
      ['opening','closing'].forEach(type => {
        const rec = state.records.find(r => r.date === date && r.type === type && r.dept === dept);
        if (rec) {
          Object.entries(rec.fields || {}).forEach(([, v]) => {
            if (v === 'Yes' || v === 'No') { totalChecks++; if (v === 'Yes') passedChecks++; }
          });
        }
      });

      state.records.filter(r => r.date === date && r.type === 'temperature' && r.dept === dept).forEach(r => {
        tempChecks++;
        if (r.fields?.temp_status === 'FAIL') tempFails++;
      });
    });

    const pct = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : null;
    const pctColor = pct === null ? 'var(--text-dim)' : pct >= 90 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--danger)';

    statsRows.push(`
      <tr>
        <td><span style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span></td>
        <td style="color:${pctColor};font-weight:600">${pct !== null ? pct + '%' : '—'}</td>
        <td>${pct !== null ? `${passedChecks}/${totalChecks}` : '—'}</td>
        <td>${tempChecks > 0 ? tempChecks : '—'}</td>
        <td>${tempFails > 0 ? `<span style="color:var(--danger)">${tempFails} breach${tempFails !== 1 ? 'es' : ''}</span>` : tempChecks > 0 ? '<span style="color:var(--success)">None</span>' : '—'}</td>
      </tr>`);
  });

  // Kitchen probes
  let probeTotal = 0, probeFails = 0;
  weekDates.forEach(date => {
    state.records.filter(r => r.date === date && r.type === 'food_probe').forEach(r => {
      probeTotal++;
      if (r.fields?.probe_status === 'FAIL') probeFails++;
    });
  });
  statsRows.push(`
    <tr>
      <td><span style="color:#f59e0b">🍳 Kitchen</span> <span style="color:var(--text-muted);font-size:11px">Probes</span></td>
      <td>—</td>
      <td>${probeTotal > 0 ? probeTotal : '—'}</td>
      <td>—</td>
      <td>${probeFails > 0 ? `<span style="color:var(--danger)">${probeFails} fail${probeFails !== 1 ? 's' : ''}</span>` : probeTotal > 0 ? '<span style="color:var(--success)">All pass</span>' : '—'}</td>
    </tr>`);

  return `
    <table class="report-table">
      <thead><tr>
        <th>Department</th><th>Compliance</th><th>Checks Passed</th><th>Temp Readings</th><th>Temp Breaches</th>
      </tr></thead>
      <tbody>${statsRows.join('')}</tbody>
    </table>`;
}

// ── Label lookup — finds human label for a check id from settings ────
function getCheckLabel(id) {
  const s = state.settings || {};
  // Search all check sections
  const allSections = [
    ...(s.sharedChecks?.opening || []),
    ...(s.sharedChecks?.closing || []),
    ...(s.checks?.mgmt?.weekly || []),
    ...(s.checks?.mgmt?.opening || []),
    ...(s.checks?.mgmt?.closing || []),
    ...(s.checks?.kitchen?.opening || []),
    ...(s.checks?.kitchen?.closing || []),
    ...(s.checks?.foh?.opening || []),
    ...(s.checks?.foh?.closing || []),
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
