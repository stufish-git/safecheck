// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Tasks v5
//  Weekly task list: recurring (manager) + one-off (staff)
//  All tasks visible Mon–Sun, amber if overdue
//  Resets every Monday midnight
// ═══════════════════════════════════════════════════════

const TASK_COMPLETIONS_KEY = 'safechecks_task_completions';
const ONEOFF_TASKS_KEY     = 'safechecks_oneoff_tasks';

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS = { monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday', friday:'Friday', saturday:'Saturday', sunday:'Sunday' };
const DAY_SHORT  = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };

// ── Week helpers ──────────────────────────────────────
function getWeekStart(date = new Date()) {
  const d   = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekStartStr(date = new Date()) {
  const d = getWeekStart(date);
  return d.toISOString().split('T')[0];
}

function getTodayDayName() {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  return days[new Date().getDay()];
}

function getDayIndex(dayName) {
  return DAYS.indexOf(dayName);
}

function getTodayIndex() {
  return getDayIndex(getTodayDayName());
}

function isWeekend() {
  const d = new Date().getDay();
  return d === 6 || d === 0; // Saturday or Sunday
}

function getDayDate(weekStartStr, dayName) {
  const start = new Date(weekStartStr + 'T00:00:00');
  const offset = getDayIndex(dayName);
  const d = new Date(start);
  d.setDate(start.getDate() + offset);
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

// ── Load / save completions ───────────────────────────
function loadTaskCompletions() {
  try {
    const raw = localStorage.getItem(TASK_COMPLETIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

function saveTaskCompletions(completions) {
  localStorage.setItem(TASK_COMPLETIONS_KEY, JSON.stringify(completions));
}

// Key: weekStart_taskId
function getCompletionKey(weekStart, taskId) {
  return `${weekStart}__${taskId}`;
}

function isTaskDone(weekStart, taskId) {
  const completions = loadTaskCompletions();
  return !!completions[getCompletionKey(weekStart, taskId)];
}

function markTaskDone(weekStart, taskId, staffName, done = true) {
  const completions = loadTaskCompletions();
  const key = getCompletionKey(weekStart, taskId);
  if (done) {
    completions[key] = { taskId, weekStart, staffName, timestamp: new Date().toISOString(), done: true };
  } else {
    delete completions[key];
  }
  saveTaskCompletions(completions);

  // Push completion to Sheets as a record
  if (done) {
    const record = {
      id:        'task_' + Date.now(),
      type:      'task_completion',
      dept:      currentDept(),
      date:      todayStr(),
      timestamp: nowTimestamp(),
      iso:       new Date().toISOString(),
      fields: {
        task_id:        taskId,
        task_week:      weekStart,
        task_done_by:   staffName,
        task_date:      new Date().toLocaleDateString('en-GB'),
      },
      summary: `Task completed by ${staffName}`,
    };
    state.records.push(record);
    saveState();
    syncRecordToSheets(record);
  }
}

// ── Load / save one-off tasks ─────────────────────────
function loadOneOffTasks() {
  try {
    const raw = localStorage.getItem(ONEOFF_TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveOneOffTasks(tasks) {
  localStorage.setItem(ONEOFF_TASKS_KEY, JSON.stringify(tasks));
}

function getThisWeekOneOffTasks() {
  const weekStart = getWeekStartStr();
  return loadOneOffTasks().filter(t => t.weekStart === weekStart);
}

// ── Get all tasks for a dept/week ─────────────────────
function getAllTasksForWeek(dept, weekStart) {
  // Recurring tasks from settings
  const recurring = (state.settings.tasks || [])
    .filter(t => t.enabled && (dept === 'mgmt' ? true : t.dept === dept))
    .map(t => ({ ...t, isOneOff: false }));

  // One-off tasks for this week
  const oneOff = loadOneOffTasks()
    .filter(t => t.weekStart === weekStart && (dept === 'mgmt' ? true : t.dept === dept))
    .map(t => ({ ...t, isOneOff: true }));

  return [...recurring, ...oneOff];
}

function getAllUndoneTasksThisWeek() {
  const weekStart = getWeekStartStr();
  // Management sees all departments
  const tasks = getAllTasksForWeek('mgmt', weekStart);
  return tasks.filter(t => !isTaskDone(weekStart, t.id));
}

// ── Render Tasks tab ──────────────────────────────────
function renderTasksTab() {
  const dept      = currentDept();
  const weekStart = getWeekStartStr();
  const today     = getTodayDayName();
  const todayIdx  = getTodayIndex();
  const tasks     = getAllTasksForWeek(dept, weekStart);

  const container = document.getElementById('tasks-week-view');
  if (!container) return;

  // Week header
  const weekStartDate = getWeekStart();
  const weekEndDate   = new Date(weekStartDate); weekEndDate.setDate(weekStartDate.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  document.getElementById('tasks-week-label').textContent =
    `Week: ${fmt(weekStartDate)} — ${fmt(weekEndDate)}`;

  // Group by day
  const byDay = {};
  DAYS.forEach(d => { byDay[d] = []; });
  tasks.forEach(t => {
    if (byDay[t.day]) byDay[t.day].push(t);
  });

  container.innerHTML = DAYS.map(day => {
    const dayTasks = byDay[day];
    const dayIdx   = getDayIndex(day);
    const isToday  = day === today;
    const isPast   = dayIdx < todayIdx;
    const dayDate  = getDayDate(weekStart, day);
    const doneCount = dayTasks.filter(t => isTaskDone(weekStart, t.id)).length;

    return `
      <div class="task-day-block ${isToday ? 'task-day-today' : ''}" id="task-day-${day}">
        <div class="task-day-header">
          <div class="task-day-title">
            <span class="task-day-name ${isToday ? 'today-label' : ''}">${DAY_LABELS[day]}</span>
            <span class="task-day-date">${dayDate}</span>
          </div>
          <div class="task-day-meta">
            ${dayTasks.length > 0 ? `<span class="task-day-count ${doneCount === dayTasks.length && dayTasks.length > 0 ? 'all-done' : ''}">${doneCount}/${dayTasks.length}</span>` : ''}
            ${isToday || (!isPast) ? `<button class="task-add-btn" onclick="showAddOneOffTask('${day}')">+ Task</button>` : ''}
          </div>
        </div>
        <div class="task-day-items">
          ${dayTasks.length === 0
            ? `<div class="task-empty-day">No tasks scheduled</div>`
            : dayTasks.map(t => renderTaskItem(t, weekStart, day, dayIdx, todayIdx, dept)).join('')
          }
        </div>
      </div>`;
  }).join('');
}

function renderTaskItem(task, weekStart, day, dayIdx, todayIdx, dept) {
  const done      = isTaskDone(weekStart, task.id);
  const overdue   = !done && dayIdx < todayIdx;
  const deptInfo  = DEPARTMENTS[task.dept];
  const completion = loadTaskCompletions()[getCompletionKey(weekStart, task.id)];
  const me        = currentStaffMember();
  const safeLabel = (task.label || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
  const safeInfo  = (task.info  || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
  const infoBtn   = task.info
    ? '<button type="button" class="check-info-btn task-info-btn" onclick="showInfoOverlay(event,\'' + safeLabel + '\',\'' + safeInfo + '\')">ⓘ</button>'
    : '';
  return `
    <div class="task-item ${done ? 'task-done' : ''} ${overdue ? 'task-overdue' : ''}"
         id="task-item-${task.id}">
      <label class="task-check-label">
        <input type="checkbox"
          class="task-checkbox"
          ${done ? 'checked' : ''}
          onchange="toggleTask('${task.id}', '${weekStart}', this.checked)"/>
        <span class="task-check-box"></span>
      </label>
      <div class="task-item-content">
        <div class="task-item-label">${task.label}</div>
        <div class="task-item-meta">
          ${isManagement() && deptInfo ? `<span class="task-dept-tag" style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</span>` : ''}
          ${overdue ? `<span class="task-overdue-tag">Due ${DAY_SHORT[day]}</span>` : ''}
          ${done && completion ? `<span class="task-done-tag">✓ ${completion.staffName}</span>` : ''}
          ${task.isOneOff ? `<span class="task-oneoff-tag">One-off</span>` : ''}
        </div>
      </div>
      ${infoBtn}
      ${task.isOneOff ? `<button class="task-delete-btn" onclick="deleteOneOffTask('${task.id}')">✕</button>` : ''}
    </div>`;
}

function toggleTask(taskId, weekStart, checked) {
  const me = currentStaffMember();
  const staffName = me ? me.name : 'Unknown';
  markTaskDone(weekStart, taskId, staffName, checked);
  renderTasksTab();
  updateDashboard();
}

// ── Add one-off task modal ────────────────────────────
function showAddOneOffTask(preselectedDay = '') {
  document.getElementById('oneoff-modal')?.remove();
  const dept = currentDept();

  const overlay = document.createElement('div');
  overlay.id = 'oneoff-modal';
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px">
      <h2 class="modal-title">Add Task This Week</h2>
      <p class="modal-desc">One-off task for this week only</p>
      <div class="modal-field">
        <label>Task Description</label>
        <input type="text" id="oneoff-label" class="text-field" placeholder="e.g. Clean behind bar fridge" autofocus/>
      </div>
      <div class="modal-field">
        <label>Scheduled Day</label>
        <select id="oneoff-day" class="select-field">
          ${DAYS.map(d => `<option value="${d}" ${d === preselectedDay ? 'selected' : ''}>${DAY_LABELS[d]}</option>`).join('')}
        </select>
      </div>
      ${isManagement() ? `
      <div class="modal-field">
        <label>Department</label>
        <select id="oneoff-dept" class="select-field">
          <option value="kitchen">🍳 Kitchen</option>
          <option value="foh">🍽 Front of House</option>
        </select>
      </div>` : `<input type="hidden" id="oneoff-dept" value="${dept}"/>`}
      <div class="modal-actions">
        <button class="btn-cancel" onclick="document.getElementById('oneoff-modal').remove()">Cancel</button>
        <button class="btn-submit" onclick="submitOneOffTask()"><span>Add Task</span><span class="btn-icon">+</span></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('oneoff-label').focus();
}

function submitOneOffTask() {
  const label = document.getElementById('oneoff-label')?.value.trim();
  const day   = document.getElementById('oneoff-day')?.value;
  const dept  = document.getElementById('oneoff-dept')?.value || currentDept();

  if (!label) { showToast('Enter a task description', 'error'); return; }

  const weekStart = getWeekStartStr();
  const tasks     = loadOneOffTasks();
  tasks.push({ id: 'ot_' + Date.now(), label, day, dept, weekStart, isOneOff: true });
  saveOneOffTasks(tasks);
  document.getElementById('oneoff-modal')?.remove();
  renderTasksTab();
  showToast('Task added ✓', 'success');
}

function deleteOneOffTask(id) {
  if (!confirm('Remove this task?')) return;
  const tasks = loadOneOffTasks().filter(t => t.id !== id);
  saveOneOffTasks(tasks);
  renderTasksTab();
}

// ── Undone tasks summary for manager closing ──────────
function renderUndoneTasksSection() {
  const section = document.getElementById('undone-tasks-section');
  if (!section) return;

  // Only show on Sat/Sun for management
  if (!isManagement() || !isWeekend()) {
    section.style.display = 'none';
    return;
  }

  const undone = getAllUndoneTasksThisWeek();
  if (!undone.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // Group by dept
  const byDept = {};
  undone.forEach(t => { if (!byDept[t.dept]) byDept[t.dept]=[]; byDept[t.dept].push(t); });

  section.innerHTML = `
    <div class="undone-tasks-card">
      <div class="undone-tasks-header">
        <span class="undone-tasks-icon">⚠</span>
        <div>
          <div class="undone-tasks-title">Unfinished Tasks This Week</div>
          <div class="undone-tasks-sub">${undone.length} task${undone.length !== 1 ? 's' : ''} not completed — review before closing</div>
        </div>
      </div>
      <div class="undone-tasks-list">
        ${Object.entries(byDept).map(([deptId, tasks]) => {
          const deptInfo = DEPARTMENTS[deptId] || {};
          return `
            <div class="undone-dept-group">
              <div class="undone-dept-label" style="color:${deptInfo.color}">${deptInfo.icon} ${deptInfo.label}</div>
              ${tasks.map(t => `
                <div class="undone-task-item">
                  <span class="undone-task-day">${DAY_SHORT[t.day] || t.day}</span>
                  <span class="undone-task-label">${t.label}</span>
                </div>`).join('')}
            </div>`;
        }).join('')}
      </div>
      <div class="undone-tasks-note">This section is for review only — closing checks can still be submitted.</div>
    </div>`;
}

// ── Settings: task editor ─────────────────────────────
function renderTaskEditor() {
  const container = document.getElementById('task-editor-list');
  if (!container) return;
  const tasks = state.settings.tasks || [];

  if (!tasks.length) {
    container.innerHTML = '<p class="empty-state" style="padding:20px">No recurring tasks yet</p>';
    return;
  }

  // Group by dept then day
  const byDept = { kitchen:[], foh:[] };
  tasks.forEach(t => { if (byDept[t.dept]) byDept[t.dept].push(t); });

  container.innerHTML = Object.entries(byDept).map(([deptId, deptTasks]) => {
    const deptInfo = DEPARTMENTS[deptId];
    if (!deptTasks.length) return '';
    // Sort by day
    const sorted = [...deptTasks].sort((a,b) => getDayIndex(a.day) - getDayIndex(b.day));
    return `
      <div class="settings-dept-group">
        <div class="settings-dept-header">${deptInfo.icon} ${deptInfo.label}</div>
        ${sorted.map(t => `
          <div class="settings-item">
            <div class="settings-item-content">
              <div class="settings-item-main">${t.label}${t.info ? ' <span class="check-edit-has-info" title="Has info text">ⓘ</span>' : ''}</div>
              <div class="settings-item-sub">${DAY_LABELS[t.day]} ${!t.enabled ? '· Disabled' : ''}</div>
            </div>
            <div class="settings-item-actions">
              <label class="check-edit-toggle" title="${t.enabled ? 'Disable' : 'Enable'}">
                <input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="toggleRecurringTask('${t.id}', this.checked)"/>
                <span class="toggle-slider"></span>
              </label>
              <button class="set-btn-info"   onclick="editTaskInfo('${t.id}')" title="Edit info text">ⓘ</button>
              <button class="set-btn-edit"   onclick="editRecurringTask('${t.id}')">Edit</button>
              <button class="set-btn-delete" onclick="deleteRecurringTask('${t.id}')">✕</button>
            </div>
          </div>`).join('')}
      </div>`;
  }).join('');
}

function addRecurringTask() {
  const label = document.getElementById('new-task-label')?.value.trim();
  const day   = document.getElementById('new-task-day')?.value;
  const dept  = document.getElementById('new-task-dept')?.value;
  if (!label) { showToast('Enter a task description', 'error'); return; }
  if (!state.settings.tasks) state.settings.tasks = [];
  state.settings.tasks.push({ id:'rt_'+Date.now(), label, day, dept, enabled:true });
  document.getElementById('new-task-label').value = '';
  saveSettings(); syncSettingsToSheets(); renderTaskEditor();
  showToast('Task added ✓', 'success');
}

function editRecurringTask(id) {
  const t = (state.settings.tasks||[]).find(t => t.id===id); if (!t) return;
  const label = prompt('Task description:', t.label); if (label===null) return;
  const dayInput = prompt(`Day (${DAYS.join(', ')}):`, t.day); if (dayInput===null) return;
  const day = DAYS.includes(dayInput.toLowerCase().trim()) ? dayInput.toLowerCase().trim() : t.day;
  t.label = label.trim() || t.label;
  t.day   = day;
  saveSettings(); syncSettingsToSheets(); renderTaskEditor();
  showToast('Task updated ✓', 'success');
}

function toggleRecurringTask(id, enabled) {
  const t = (state.settings.tasks||[]).find(t=>t.id===id);
  if (t) { t.enabled = enabled; saveSettings(); syncSettingsToSheets(); renderTaskEditor(); }
}

function deleteRecurringTask(id) {
  if (!confirm('Remove this recurring task?')) return;
  state.settings.tasks = (state.settings.tasks||[]).filter(t=>t.id!==id);
  saveSettings(); syncSettingsToSheets(); renderTaskEditor();
}

function editTaskInfo(id) {
  const t = (state.settings.tasks||[]).find(t => t.id===id); if (!t) return;
  document.getElementById('task-info-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'task-info-modal';
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:460px">
      <h2 class="modal-title">Task Info Text</h2>
      <p class="modal-desc" style="margin-bottom:4px"><strong>${t.label}</strong></p>
      <p class="modal-desc">Shown when staff tap the ⓘ button on this task. Plain text or start lines with - or • for bullet points.</p>
      <div class="modal-field">
        <textarea id="task-info-text" class="text-field notes-field" rows="6"
          placeholder="e.g. Check behind all equipment.
- Clean fridge seals
- Wipe down shelving
Report issues to the manager."
          style="font-size:13px;line-height:1.6">${t.info || ''}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="document.getElementById('task-info-modal').remove()">Cancel</button>
        ${t.info ? `<button class="btn-cancel" style="color:var(--danger)" onclick="saveTaskInfo('${id}','')">Clear</button>` : ''}
        <button class="btn-submit" onclick="saveTaskInfo('${id}',document.getElementById('task-info-text').value)"><span>Save</span><span class="btn-icon">✓</span></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('task-info-text').focus();
}

function saveTaskInfo(id, text) {
  const t = (state.settings.tasks||[]).find(t => t.id===id); if (!t) return;
  const trimmed = text.trim();
  if (trimmed) t.info = trimmed;
  else delete t.info;
  saveSettings();
  syncSettingsToSheets();
  renderTaskEditor();
  document.getElementById('task-info-modal')?.remove();
  showToast(trimmed ? 'Info text saved ✓' : 'Info text cleared', 'success');
}

// ── Dashboard task summary ────────────────────────────
function getTaskSummaryForDept(dept) {
  const weekStart = getWeekStartStr();
  const today     = getTodayDayName();
  const todayIdx  = getTodayIndex();
  const tasks     = getAllTasksForWeek(dept, weekStart);

  const todayTasks   = tasks.filter(t => t.day === today);
  const overdueTasks = tasks.filter(t => getDayIndex(t.day) < todayIdx && !isTaskDone(weekStart, t.id));
  const doneTodayCount = todayTasks.filter(t => isTaskDone(weekStart, t.id)).length;

  return { todayTasks, overdueTasks, doneTodayCount };
}
