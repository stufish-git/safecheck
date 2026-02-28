// ═══════════════════════════════════════════════════════
//  SAFECHECKS — Settings & Department Manager v5
//  Departments: Kitchen · Front of House · Management
//  Device identity: set once per device, PIN-protected reassign
// ═══════════════════════════════════════════════════════

const SETTINGS_KEY     = 'safechecks_settings';
const SETTINGS_PIN_KEY = 'safechecks_pin_hash';
const DEVICE_KEY       = 'safechecks_device';
const THEME_KEY        = 'safechecks_theme';
const SETTINGS_TAB     = 'Settings';
const DEFAULT_PIN      = '1234';

const DEPARTMENTS = {
  kitchen: { id:'kitchen', label:'Kitchen',        icon:'🍳', color:'#f59e0b' },
  foh:     { id:'foh',     label:'Front of House', icon:'🍽', color:'#3b82f6' },
  mgmt:    { id:'mgmt',    label:'Management',     icon:'👔', color:'#22c55e' },
};

const EQUIPMENT_TYPES = {
  fridge:  { label:'Fridge',       target:'1–5°C',  icon:'🧊' },
  freezer: { label:'Freezer',      target:'-18°C',  icon:'❄'  },
  oven:    { label:'Oven/Cooking', target:'75°C+',  icon:'🔥' },
  hothold: { label:'Hot Hold',     target:'63°C+',  icon:'♨'  },
  other:   { label:'Other',        target:'—',      icon:'⊕'  },
};

// ── Default settings ──────────────────────────────────
const DEFAULT_SETTINGS = {
  restaurantName: 'My Restaurant',
  openingTimes: { kitchen:'08:00', foh:'09:00' },
  closingTimes:  { kitchen:'23:00', foh:'23:30' },

  staff: [
    { id:'s1', name:'Manager',   role:'Manager',        dept:'mgmt'    },
    { id:'s2', name:'Head Chef', role:'Head Chef',      dept:'kitchen' },
    { id:'s3', name:'Chef',      role:'Chef',           dept:'kitchen' },
    { id:'s4', name:'KP',        role:'Kitchen Porter', dept:'kitchen' },
    { id:'s5', name:'FOH Lead',  role:'FOH Supervisor', dept:'foh'     },
    { id:'s6', name:'FOH Staff', role:'Front of House', dept:'foh'     },
    { id:'s7', name:'Bar Staff', role:'Bar',            dept:'foh'     },
  ],

  equipment: [
    { id:'e1',  name:'Fridge 1 (Main)',      type:'fridge',  dept:'kitchen' },
    { id:'e2',  name:'Fridge 2 (Prep)',      type:'fridge',  dept:'kitchen' },
    { id:'e3',  name:'Walk-in Fridge',       type:'fridge',  dept:'kitchen' },
    { id:'e4',  name:'Freezer 1',            type:'freezer', dept:'kitchen' },
    { id:'e5',  name:'Freezer 2',            type:'freezer', dept:'kitchen' },
    { id:'e6',  name:'Oven 1',               type:'oven',    dept:'kitchen' },
    { id:'e7',  name:'Oven 2',               type:'oven',    dept:'kitchen' },
    { id:'e8',  name:'Hot Hold Counter',     type:'hothold', dept:'kitchen' },
    { id:'e9',  name:'Fryer',                type:'oven',    dept:'kitchen' },
    { id:'e10', name:'Grill',                type:'oven',    dept:'kitchen' },
    { id:'e11', name:'Display Fridge (FOH)', type:'fridge',  dept:'foh'     },
    { id:'e12', name:'Bar Fridge',           type:'fridge',  dept:'foh'     },
    { id:'e13', name:'Wine Fridge',          type:'fridge',  dept:'foh'     },
    { id:'e14', name:'Ice Machine',          type:'other',   dept:'foh'     },
    { id:'e15', name:'Delivery — Chilled',   type:'fridge',  dept:'shared'  },
    { id:'e16', name:'Delivery — Frozen',    type:'freezer', dept:'shared'  },
  ],

  sharedChecks: {
    opening: [
      { id:'sh_o1', label:'Fire exits clear and unlocked',           enabled:true },
      { id:'sh_o2', label:'Fire extinguishers in place and visible', enabled:true },
      { id:'sh_o3', label:'First aid kit stocked and accessible',    enabled:true },
      { id:'sh_o4', label:'No slip or trip hazards in your area',    enabled:true },
    ],
    closing: [
      { id:'sh_c1', label:'Windows closed and secured in your area', enabled:true },
      { id:'sh_c2', label:'Doors in your area locked',               enabled:true },
      { id:'sh_c3', label:'Lights off in your area',                 enabled:true },
    ],
  },

  // Food probe products — kitchen only
  probeProducts: [
    { id:'pp1',  name:'Chicken breast',       enabled:true },
    { id:'pp2',  name:'Chicken thigh',        enabled:true },
    { id:'pp3',  name:'Whole chicken',        enabled:true },
    { id:'pp4',  name:'Beef burger',          enabled:true },
    { id:'pp5',  name:'Beef steak',           enabled:true },
    { id:'pp6',  name:'Pork loin',            enabled:true },
    { id:'pp7',  name:'Pork sausages',        enabled:true },
    { id:'pp8',  name:'Lamb',                 enabled:true },
    { id:'pp9',  name:'Fish fillet',          enabled:true },
    { id:'pp10', name:'Scampi / Prawns',      enabled:true },
    { id:'pp11', name:'Beef mince',           enabled:true },
    { id:'pp12', name:'Reheated soup',        enabled:true },
    { id:'pp13', name:'Reheated pie',         enabled:true },
    { id:'pp14', name:'Reheated curry',       enabled:true },
    { id:'pp15', name:'Eggs (fried/poached)', enabled:true },
  ],

  // Recurring weekly tasks — assigned to a specific day
  tasks: [
    // Kitchen
    { id:'kt1', label:'Deep clean walk-in fridge',      day:'monday',    dept:'kitchen', enabled:true },
    { id:'kt2', label:'Clean behind all fridges',        day:'monday',    dept:'kitchen', enabled:true },
    { id:'kt3', label:'Descale coffee machine',          day:'tuesday',   dept:'kitchen', enabled:true },
    { id:'kt4', label:'Check and rotate dry store',      day:'tuesday',   dept:'kitchen', enabled:true },
    { id:'kt5', label:'Clean oven interiors fully',      day:'wednesday', dept:'kitchen', enabled:true },
    { id:'kt6', label:'Calibrate temperature probes',    day:'wednesday', dept:'kitchen', enabled:true },
    { id:'kt7', label:'Check all fridge door seals',     day:'thursday',  dept:'kitchen', enabled:true },
    { id:'kt8', label:'Clean fryer fully / change oil',  day:'thursday',  dept:'kitchen', enabled:true },
    { id:'kt9', label:'Deep clean drains and traps',     day:'friday',    dept:'kitchen', enabled:true },
    { id:'kt10',label:'Pest check — all areas',          day:'friday',    dept:'kitchen', enabled:true },
    { id:'kt11',label:'Full kitchen deep clean',         day:'saturday',  dept:'kitchen', enabled:true },
    { id:'kt12',label:'Stock check and order sheet',     day:'sunday',    dept:'kitchen', enabled:true },
    // FOH
    { id:'ft1', label:'Clean bar windows inside/out',    day:'monday',    dept:'foh', enabled:true },
    { id:'ft2', label:'Polish all glassware',            day:'monday',    dept:'foh', enabled:true },
    { id:'ft3', label:'Clean beer lines',                day:'tuesday',   dept:'foh', enabled:true },
    { id:'ft4', label:'Restock condiments and sauces',   day:'tuesday',   dept:'foh', enabled:true },
    { id:'ft5', label:'Deep clean coffee machine',       day:'wednesday', dept:'foh', enabled:true },
    { id:'ft6', label:'Wipe down all menus',             day:'wednesday', dept:'foh', enabled:true },
    { id:'ft7', label:'Clean all highchairs thoroughly', day:'thursday',  dept:'foh', enabled:true },
    { id:'ft8', label:'Clean wine fridge interior',      day:'thursday',  dept:'foh', enabled:true },
    { id:'ft9', label:'Full FOH deep clean',             day:'friday',    dept:'foh', enabled:true },
    { id:'ft10',label:'Check and restock bar stock',     day:'friday',    dept:'foh', enabled:true },
    { id:'ft11',label:'Polish all tables and surfaces',  day:'saturday',  dept:'foh', enabled:true },
    { id:'ft12',label:'Review reservations for week',    day:'sunday',    dept:'foh', enabled:true },
  ],

  checks: {
    kitchen: {
      opening: [
        { id:'ko1',  label:'All fridge/freezer temps checked (see Temp Log)', enabled:true },
        { id:'ko2',  label:'Raw and cooked foods stored separately',          enabled:true },
        { id:'ko3',  label:'All food items date-labelled correctly',          enabled:true },
        { id:'ko4',  label:'Expired items removed and disposed of',           enabled:true },
        { id:'ko5',  label:'All prep surfaces cleaned and sanitised',         enabled:true },
        { id:'ko6',  label:'All equipment cleaned from previous service',     enabled:true },
        { id:'ko7',  label:'Handwashing stations stocked',                    enabled:true },
        { id:'ko8',  label:'PPE available (gloves, aprons, hair nets)',       enabled:true },
        { id:'ko9',  label:'Sanitiser spray available and in-date',          enabled:true },
        { id:'ko10', label:'Staff illness/symptom check completed',           enabled:true },
        { id:'ko11', label:'All staff in correct uniform',                    enabled:true },
      ],
      closing: [
        { id:'kc1',  label:'All food correctly stored, covered and labelled', enabled:true },
        { id:'kc2',  label:'All food waste removed',                          enabled:true },
        { id:'kc3',  label:'Raw and cooked foods separated in storage',       enabled:true },
        { id:'kc4',  label:'Fridge/freezer temperatures checked and logged',  enabled:true },
        { id:'kc5',  label:'All cooking equipment turned off',                enabled:true },
        { id:'kc6',  label:'Gas turned off at mains',                         enabled:true },
        { id:'kc7',  label:'Fryer off and covered',                           enabled:true },
        { id:'kc8',  label:'Kitchen fully cleaned (see Cleaning Schedule)',   enabled:true },
        { id:'kc9',  label:'Chopping boards cleaned and stored',              enabled:true },
        { id:'kc10', label:'All deliveries received, checked and logged',     enabled:true },
      ],
      cleaning: [
        { id:'kcl1',  label:'Prep surfaces wiped and sanitised between tasks', enabled:true },
        { id:'kcl2',  label:'Spillages cleaned immediately',                   enabled:true },
        { id:'kcl3',  label:'Waste bins emptied mid-service',                  enabled:true },
        { id:'kcl4',  label:'All surfaces deep-cleaned end of service',        enabled:true },
        { id:'kcl5',  label:'Ovens and grills cleaned',                        enabled:true },
        { id:'kcl6',  label:'Fryer cleaned / oil checked',                     enabled:true },
        { id:'kcl7',  label:'Sinks scrubbed and drained',                      enabled:true },
        { id:'kcl8',  label:'Floors swept and mopped',                         enabled:true },
        { id:'kcl9',  label:'All waste removed and bins cleaned',              enabled:true },
        { id:'kcl10', label:'Chopping boards sanitised and stored',            enabled:true },
        { id:'kcl11', label:'Utensils and equipment washed and stored',        enabled:true },
        { id:'kcl12', label:'Fridge interiors wiped down',                     enabled:true },
        { id:'kcl13', label:'Fridge door seals checked and cleaned',           enabled:true },
        { id:'kcl14', label:'Dry store tidied and swept',                      enabled:true },
      ],
    },

    foh: {
      opening: [
        { id:'fo1',  label:'Tables set and clean',                            enabled:true },
        { id:'fo2',  label:'Bar area stocked and clean',                      enabled:true },
        { id:'fo3',  label:'Display/bar fridge temps checked',                enabled:true },
        { id:'fo4',  label:'Menus clean and in good condition',               enabled:true },
        { id:'fo5',  label:'Specials board updated',                          enabled:true },
        { id:'fo6',  label:'Allergen information up to date and accessible',  enabled:true },
        { id:'fo7',  label:'Till/POS system checked and float counted',       enabled:true },
        { id:'fo8',  label:'Toilets checked and restocked',                   enabled:true },
        { id:'fo9',  label:'Highchairs and furniture checked',                enabled:true },
        { id:'fo10', label:'Staff in correct uniform',                        enabled:true },
        { id:'fo11', label:'Reservations checked and tables assigned',        enabled:true },
      ],
      closing: [
        { id:'fc1',  label:'All tables cleared and wiped down',               enabled:true },
        { id:'fc2',  label:'Bar area cleaned and restocked for next service', enabled:true },
        { id:'fc3',  label:'Display/bar fridge temps checked and logged',     enabled:true },
        { id:'fc4',  label:'Till cashed up and reconciled',                   enabled:true },
        { id:'fc5',  label:'Cash secured',                                    enabled:true },
        { id:'fc6',  label:'CCTV operational',                                enabled:true },
        { id:'fc7',  label:'Alarm set',                                       enabled:true },
        { id:'fc8',  label:'Toilets checked and cleaned',                     enabled:true },
        { id:'fc9',  label:'FOH floors swept and mopped',                     enabled:true },
        { id:'fc10', label:'Outdoor/pavement areas cleared',                  enabled:true },
      ],
      cleaning: [
        { id:'fcl1',  label:'Tables wiped between covers',                    enabled:true },
        { id:'fcl2',  label:'Bar surface kept clean during service',          enabled:true },
        { id:'fcl3',  label:'Spills dealt with immediately',                  enabled:true },
        { id:'fcl4',  label:'Glasses cleaned and polished',                   enabled:true },
        { id:'fcl5',  label:'Toilets checked every 2 hours during service',   enabled:true },
        { id:'fcl6',  label:'Full FOH deep clean end of service',             enabled:true },
        { id:'fcl7',  label:'Bar equipment cleaned',                          enabled:true },
        { id:'fcl8',  label:'Coffee machine cleaned and backflushed',         enabled:true },
        { id:'fcl9',  label:'Beer lines clean (weekly)',                      enabled:true },
        { id:'fcl10', label:'Menus wiped down',                              enabled:true },
        { id:'fcl11', label:'Highchairs cleaned',                             enabled:true },
      ],
    },

    mgmt: {
      weekly: [
        { id:'mw1',  label:'HACCP records reviewed for the week',             enabled:true },
        { id:'mw2',  label:'All temperature logs completed daily',            enabled:true },
        { id:'mw3',  label:'No unresolved temperature breaches',              enabled:true },
        { id:'mw4',  label:'Allergen information up to date',                 enabled:true },
        { id:'mw5',  label:'Date rotation / FIFO followed all week',          enabled:true },
        { id:'mw6',  label:'Kitchen weekly deep clean completed',             enabled:true },
        { id:'mw7',  label:'FOH weekly deep clean completed',                 enabled:true },
        { id:'mw8',  label:'All cleaning records signed off',                 enabled:true },
        { id:'mw9',  label:'Pest control check — no evidence of pests',      enabled:true },
        { id:'mw10', label:'Drains cleaned',                                  enabled:true },
        { id:'mw11', label:'All fridges and freezers deep cleaned',           enabled:true },
        { id:'mw12', label:'All staff food hygiene training up to date',      enabled:true },
        { id:'mw13', label:'No illness/symptom incidents this week',          enabled:true },
        { id:'mw14', label:'Team safety briefing held',                       enabled:true },
        { id:'mw15', label:'All equipment working correctly',                 enabled:true },
        { id:'mw16', label:'Temperature probe calibrated and tested',         enabled:true },
        { id:'mw17', label:'Any maintenance issues logged',                   enabled:true },
        { id:'mw18', label:'First aid kit checked and restocked',             enabled:true },
        { id:'mw19', label:'Staff rotas confirmed',                           enabled:true },
        { id:'mw20', label:'Supplier invoices checked',                       enabled:true },
      ],
    },
  },
};

// ── Device identity ───────────────────────────────────
function loadDevice() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    state.device = raw ? JSON.parse(raw) : null;
  } catch(e) { state.device = null; }
}

function saveDevice(device) {
  state.device = device;
  if (device) localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  else localStorage.removeItem(DEVICE_KEY);
}

function isDeviceSetup() { return !!(state.device?.dept && state.device?.staffId); }
function currentDept()   { return state.device?.dept || 'kitchen'; }
function isManagement()  { return currentDept() === 'mgmt'; }

function currentStaffMember() {
  const id = state.device?.staffId;
  if (!id) return null;
  if (id.startsWith('guest_')) return { name: DEPARTMENTS[currentDept()]?.label + ' (Guest)', role:'', dept: currentDept() };
  return state.settings.staff.find(s => s.id === id) || null;
}

// ── First-time device setup ───────────────────────────
function showDeviceSetup(onComplete) {
  document.getElementById('device-setup-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'device-setup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';

  overlay.innerHTML = `
    <div style="width:100%;max-width:400px">
      <div style="text-align:center;margin-bottom:32px">
        <div style="width:56px;height:56px;background:var(--success);border-radius:14px;
          display:flex;align-items:center;justify-content:center;font-size:26px;
          font-weight:800;color:#000;margin:0 auto 16px">✓</div>
        <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;margin-bottom:6px">Welcome to SafeChecks</h1>
        <p style="font-size:14px;color:var(--text-muted)">Set up this device once — takes 30 seconds</p>
      </div>

      <div id="setup-step-1">
        <p style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
          color:var(--text-muted);margin-bottom:14px">Step 1 — Which department?</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${Object.values(DEPARTMENTS).map(d => `
            <button class="dept-select-btn" onclick="selectSetupDept('${d.id}')">
              <span style="font-size:24px">${d.icon}</span>
              <div style="text-align:left">
                <div style="font-size:15px;font-weight:600">${d.label}</div>
                <div style="font-size:12px;color:var(--text-muted)">${d.id === 'mgmt' ? 'Full dashboard access' : 'Department checks & temps'}</div>
              </div>
              <span style="margin-left:auto;color:var(--text-dim)">→</span>
            </button>`).join('')}
        </div>
      </div>

      <div id="setup-step-2" style="display:none">
        <button onclick="backSetupStep()" style="background:none;border:none;color:var(--text-muted);
          font-size:13px;cursor:pointer;margin-bottom:16px;padding:0;font-family:var(--font)">← Back</button>
        <p style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
          color:var(--text-muted);margin-bottom:14px">Step 2 — Who are you?</p>
        <div style="display:flex;flex-direction:column;gap:8px" id="staff-select-btns"></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  window._setupComplete = onComplete;
}

function selectSetupDept(deptId) {
  window._setupDept = deptId;
  const deptInfo  = DEPARTMENTS[deptId];
  const staffList = deptId === 'mgmt'
    ? state.settings.staff.filter(s => s.dept === 'mgmt')
    : state.settings.staff.filter(s => s.dept === deptId);

  const btns = staffList.map(s => `
    <button class="staff-select-btn" onclick="completeDeviceSetup('${s.id}')">
      <span style="font-size:20px">${deptInfo.icon}</span>
      <div>
        <div style="font-size:14px;font-weight:600">${s.name}</div>
        <div style="font-size:12px;color:var(--text-muted)">${s.role}</div>
      </div>
    </button>`).join('');

  document.getElementById('setup-step-1').style.display = 'none';
  document.getElementById('setup-step-2').style.display = 'block';
  document.getElementById('staff-select-btns').innerHTML = btns ||
    `<p style="color:var(--text-muted);font-size:13px;line-height:1.6">
      No staff assigned to ${deptInfo.label} yet. Add staff in Settings first, or:
      <br><button onclick="completeDeviceSetup('guest_${deptId}')"
        style="background:none;border:none;color:var(--success);cursor:pointer;
        font-family:var(--font);font-size:13px;margin-top:8px;text-decoration:underline">
        Continue as ${deptInfo.label} (Guest) →</button></p>`;
}

function backSetupStep() {
  document.getElementById('setup-step-1').style.display = 'block';
  document.getElementById('setup-step-2').style.display = 'none';
}

function completeDeviceSetup(staffId) {
  saveDevice({ dept: window._setupDept, staffId });
  document.getElementById('device-setup-overlay')?.remove();
  window._setupComplete?.();
}

// ── Settings load/save ────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    state.settings = raw
      ? deepMergeSettings(DEFAULT_SETTINGS, JSON.parse(raw))
      : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  } catch(e) { state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function deepMergeSettings(def, saved) {
  const m = JSON.parse(JSON.stringify(def));
  if (saved.restaurantName) m.restaurantName = saved.restaurantName;
  if (saved.openingTimes)   m.openingTimes   = { ...m.openingTimes, ...saved.openingTimes };
  if (saved.closingTimes)   m.closingTimes   = { ...m.closingTimes, ...saved.closingTimes };
  if (saved.staff)          m.staff          = saved.staff;
  if (saved.equipment)      m.equipment      = saved.equipment;
  if (saved.sharedChecks)   m.sharedChecks   = saved.sharedChecks;
  if (saved.tasks)          m.tasks          = saved.tasks;
  if (saved.probeProducts)  m.probeProducts  = saved.probeProducts;
  if (saved.checks) {
    ['kitchen','foh','mgmt'].forEach(d => {
      if (saved.checks[d]) m.checks[d] = { ...m.checks[d], ...saved.checks[d] };
    });
  }
  return m;
}

// ── Active checks (shared + dept-specific) ────────────
function getActiveChecks(dept, section) {
  const shared   = (state.settings.sharedChecks?.[section] || []).filter(c => c.enabled);
  const specific = (state.settings.checks?.[dept]?.[section] || []).filter(c => c.enabled);
  return [...shared, ...specific];
}

function getDeptEquipment(dept) {
  if (dept === 'mgmt') return state.settings.equipment || [];
  return (state.settings.equipment || []).filter(e => e.dept === dept || e.dept === 'shared');
}

function getDeptStaff(dept) {
  if (dept === 'mgmt') return state.settings.staff;
  return (state.settings.staff || []).filter(s => s.dept === dept);
}

// ── Rebuild dynamic UI ────────────────────────────────
function rebuildAllChecklists() {
  const dept = currentDept();
  if (dept === 'mgmt') {
    // Management gets weekly + can submit kitchen/foh checklists
    rebuildChecklist('weekly', 'mgmt');
    const openDept  = (state.tabDept && state.tabDept['opening'])  || 'kitchen';
    const cleanDept = (state.tabDept && state.tabDept['cleaning']) || 'kitchen';
    const closeDept = (state.tabDept && state.tabDept['closing'])  || 'kitchen';
    rebuildChecklist('opening',  openDept);
    rebuildChecklist('cleaning', cleanDept);
    rebuildChecklist('closing',  closeDept);
  } else {
    rebuildChecklist('opening', dept);
    rebuildChecklist('cleaning', dept);
    rebuildChecklist('closing', dept);
  }
}

function rebuildChecklist(section, dept) {
  const formEl = document.getElementById('form-' + section);
  if (!formEl) return;
  const checks   = getActiveChecks(dept, section);
  formEl.querySelectorAll('.check-group').forEach(g => g.remove());
  if (!checks.length) return;

  const sharedIds = new Set((state.settings.sharedChecks?.[section] || []).map(c => c.id));
  const shared    = checks.filter(c => sharedIds.has(c.id));
  const specific  = checks.filter(c => !sharedIds.has(c.id));
  const deptInfo  = DEPARTMENTS[dept];
  const frag      = document.createDocumentFragment();

  if (shared.length) {
    const g = document.createElement('div');
    g.className = 'check-group';
    g.innerHTML = `<h3 class="group-title">General Safety</h3>` + shared.map(c => checkItemHTML(c, section, dept)).join('');
    frag.appendChild(g);
  }
  if (specific.length) {
    const g = document.createElement('div');
    g.className = 'check-group';
    g.innerHTML = `<h3 class="group-title">${deptInfo?.icon || ''} ${deptInfo?.label || ''}</h3>` + specific.map(c => checkItemHTML(c, section, dept)).join('');
    frag.appendChild(g);
  }
  // Insert before notes-group — NOT before signed-by-group (signed-by is pinned at top)
  formEl.insertBefore(frag, formEl.querySelector('.notes-group, .form-actions'));

  // Restore any ticks saved earlier today
  restoreDraft(section, dept);
  updateChecklistProgress(section, dept);
}

function checkItemHTML(c, type, dept) {
  // onchange saves tick to draft immediately — persistent across nav and devices
  const handler = type && dept
    ? `onchange="onCheckboxChange('${type}','${dept}','${c.id}',this.checked);updateChecklistProgress('${type}','${dept}')"`
    : '';
  return `<label class="check-item"><input type="checkbox" data-key="${c.id}" ${handler}>${c.label}</label>`;
}

function rebuildSignedByDropdowns() {
  const dept  = currentDept();
  const me    = currentStaffMember();
  // Management signed-by shows all staff; others show their dept only
  const staff = isManagement()
    ? (state.settings.staff || []).filter(s => s.dept !== 'mgmt')
    : getDeptStaff(dept);
  const opts  = `<option value="">Select staff member...</option>` +
    staff.map(s => `<option value="${s.name}">${s.name} — ${s.role}</option>`).join('');
  document.querySelectorAll('.signed-by-select').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = opts;
    sel.value = cur || (me ? me.name : '');
  });
  // Equipment staff dropdown
  const equipSel = document.getElementById('equip-staff');
  if (equipSel) {
    equipSel.innerHTML = opts;
    equipSel.value = me ? me.name : '';
  }
}

function rebuildTempLocationDropdown() {
  const select = document.getElementById('temp-location');
  if (!select) return;
  const equip  = getDeptEquipment(currentDept());
  const groups = {};
  equip.forEach(e => { if (!groups[e.type]) groups[e.type]=[]; groups[e.type].push(e); });
  let html = '<option value="">Select location...</option>';
  ['fridge','freezer','oven','hothold','other'].forEach(type => {
    if (!groups[type]?.length) return;
    const info = EQUIPMENT_TYPES[type];
    html += `<optgroup label="${info.icon} ${info.label}">`;
    groups[type].forEach(e => { html += `<option value="${e.name}">${e.name}</option>`; });
    html += '</optgroup>';
  });
  select.innerHTML = html;
}

// ── Apply device identity to UI ───────────────────────
function applyDeviceIdentity() {
  const dept     = currentDept();
  const deptInfo = DEPARTMENTS[dept];
  const me       = currentStaffMember();

  document.querySelector('.brand-name').textContent = state.settings.restaurantName || 'SafeChecks';

  // Dept pill in header
  let pill = document.getElementById('dept-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'dept-pill';
    pill.className = 'dept-pill';
    document.querySelector('.header-right')?.prepend(pill);
  }
  pill.textContent = `${deptInfo?.icon} ${me ? me.name : deptInfo?.label}`;
  pill.style.cssText += `;border-color:${deptInfo?.color}44;color:${deptInfo?.color}`;

  // Tab visibility based on role
  // Weekly: management only
  document.querySelector('[data-tab="weekly"]')?.classList.toggle('hidden', dept !== 'mgmt');
  // Probe: kitchen + management only (FOH has no food probe requirement)
  document.querySelector('[data-tab="probe"]')?.classList.toggle('hidden', dept === 'foh');

  // Show/hide dept selector bars — all are in static HTML, just toggle visibility
  const isMgmt = dept === 'mgmt';
  // Equipment selector
  const equipSel = document.getElementById('equip-dept-selector');
  if (equipSel) equipSel.style.display = isMgmt ? 'flex' : 'none';
  // Checklist selectors
  ['opening','closing','cleaning'].forEach(type => {
    const sel = document.getElementById(type + '-dept-selector');
    if (sel) sel.style.display = isMgmt ? 'flex' : 'none';
  });
}

// ── PIN ───────────────────────────────────────────────
function hashPin(pin) {
  let h = 0;
  for (let i = 0; i < pin.length; i++) { h = ((h << 5) - h) + pin.charCodeAt(i); h |= 0; }
  return String(h);
}
function getStoredPinHash() { return localStorage.getItem(SETTINGS_PIN_KEY) || hashPin(DEFAULT_PIN); }
function verifyPin(pin)     { return hashPin(pin) === getStoredPinHash(); }
function changePin(old, np) { if (!verifyPin(old)||np.length<4) return false; localStorage.setItem(SETTINGS_PIN_KEY, hashPin(np)); return true; }

let settingsUnlocked = false;

function showSettingsTab() {
  if (settingsUnlocked) { renderSettingsPage(); return; }
  showPinModal(() => {
    settingsUnlocked = true;
    clearTimeout(window._lockTimer);
    window._lockTimer = setTimeout(() => { settingsUnlocked = false; }, 10 * 60 * 1000);
    renderSettingsPage();
  });
}

function showPinModal(onSuccess) {
  document.getElementById('pin-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'pin-modal'; el.className = 'modal-overlay';
  el.innerHTML = `
    <div class="modal-box" style="max-width:340px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">🔒</div>
      <h2 class="modal-title">Manager Settings</h2>
      <p class="modal-desc" style="margin-bottom:20px">Enter your PIN to access settings</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:20px" id="pin-dots">
        <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
      </div>
      <div class="pin-grid">
        ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k=>`<button class="pin-key" onclick="pinKeyPress('${k}')">${k}</button>`).join('')}
      </div>
      <p id="pin-error" style="color:var(--danger);font-size:12px;margin-top:12px;min-height:18px"></p>
      <button class="btn-cancel" style="margin-top:8px;width:100%" onclick="document.getElementById('pin-modal').remove()">Cancel</button>
    </div>`;
  document.body.appendChild(el);
  window._pinEntry = ''; window._pinSuccess = onSuccess;
}

function pinKeyPress(key) {
  if (key==='⌫') window._pinEntry = window._pinEntry.slice(0,-1);
  else if (key!==''&&window._pinEntry.length<4) window._pinEntry += key;
  document.querySelectorAll('.pin-dot').forEach((d,i)=>d.classList.toggle('filled', i<window._pinEntry.length));
  if (window._pinEntry.length===4) {
    if (verifyPin(window._pinEntry)) {
      document.getElementById('pin-modal')?.remove();
      window._pinSuccess?.();
    } else {
      document.getElementById('pin-error').textContent = 'Incorrect PIN';
      const dots = document.getElementById('pin-dots');
      dots?.classList.add('shake'); setTimeout(()=>dots?.classList.remove('shake'),500);
      window._pinEntry=''; document.querySelectorAll('.pin-dot').forEach(d=>d.classList.remove('filled'));
    }
  }
}

// ── Render settings ───────────────────────────────────
function renderSettingsPage() {
  showTab('settings');
  const s = state.settings;
  document.getElementById('set-restaurant-name').value = s.restaurantName||'';
  document.getElementById('set-kitchen-open').value    = s.openingTimes?.kitchen||'08:00';
  document.getElementById('set-kitchen-close').value   = s.closingTimes?.kitchen||'23:00';
  document.getElementById('set-foh-open').value        = s.openingTimes?.foh||'09:00';
  document.getElementById('set-foh-close').value       = s.closingTimes?.foh||'23:30';
  updateThemeButtons(currentTheme());
  renderStaffList(); renderEquipmentList(); renderCheckEditors(); renderTaskEditor(); renderProbeProductList();
  showSettingsSection('restaurant');
}

function showSettingsSection(id) {
  document.querySelectorAll('.settings-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.settings-tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('settings-panel-'+id)?.classList.add('active');
  document.querySelector(`[data-settings-tab="${id}"]`)?.classList.add('active');
}

function saveRestaurantInfo() {
  const s = state.settings;
  s.restaurantName        = document.getElementById('set-restaurant-name').value.trim()||'My Restaurant';
  s.openingTimes          = s.openingTimes||{};
  s.closingTimes          = s.closingTimes||{};
  s.openingTimes.kitchen  = document.getElementById('set-kitchen-open').value;
  s.closingTimes.kitchen  = document.getElementById('set-kitchen-close').value;
  s.openingTimes.foh      = document.getElementById('set-foh-open').value;
  s.closingTimes.foh      = document.getElementById('set-foh-close').value;
  saveSettings(); syncSettingsToSheets();
  document.querySelector('.brand-name').textContent = s.restaurantName;
  showToast('Saved ✓', 'success');
}

// ── Staff ─────────────────────────────────────────────
function renderStaffList() {
  const list = document.getElementById('staff-list');
  if (!list) return;
  const staff = state.settings.staff||[];
  const byDept = {};
  staff.forEach(s=>{ if (!byDept[s.dept]) byDept[s.dept]=[]; byDept[s.dept].push(s); });
  list.innerHTML = Object.entries(DEPARTMENTS).map(([id, info])=>{
    const members = byDept[id]||[];
    if (!members.length) return `<div class="settings-dept-group"><div class="settings-dept-header">${info.icon} ${info.label}</div><p style="padding:12px 20px;font-size:12px;color:var(--text-dim)">No staff assigned</p></div>`;
    return `<div class="settings-dept-group">
      <div class="settings-dept-header">${info.icon} ${info.label}</div>
      ${members.map(s=>`
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-main">${s.name}</div>
            <div class="settings-item-sub">${s.role}</div>
          </div>
          <div class="settings-item-actions">
            <button class="set-btn-edit" onclick="editStaff('${s.id}')">Edit</button>
            <button class="set-btn-delete" onclick="deleteStaff('${s.id}')">✕</button>
          </div>
        </div>`).join('')}
    </div>`;
  }).join('');
  rebuildSignedByDropdowns();
}

function addStaff() {
  const name = document.getElementById('new-staff-name').value.trim();
  const role = document.getElementById('new-staff-role').value;
  const dept = document.getElementById('new-staff-dept').value;
  if (!name) { showToast('Enter a name', 'error'); return; }
  state.settings.staff.push({ id:'su_'+Date.now(), name, role, dept });
  document.getElementById('new-staff-name').value='';
  saveSettings(); syncSettingsToSheets(); renderStaffList();
  showToast(`${name} added ✓`, 'success');
}

function editStaff(id) {
  const m = state.settings.staff.find(s=>s.id===id); if (!m) return;
  const name = prompt('Name:', m.name); if (name===null) return;
  const role = prompt('Role:', m.role); if (role===null) return;
  m.name = name.trim()||m.name; m.role = role.trim()||m.role;
  saveSettings(); syncSettingsToSheets(); renderStaffList(); showToast('Updated ✓','success');
}

function deleteStaff(id) {
  const m = state.settings.staff.find(s=>s.id===id);
  if (!m||!confirm(`Remove ${m.name}?`)) return;
  state.settings.staff = state.settings.staff.filter(s=>s.id!==id);
  saveSettings(); syncSettingsToSheets(); renderStaffList();
}

// ── Equipment ─────────────────────────────────────────
function renderEquipmentList() {
  const list = document.getElementById('equipment-list'); if (!list) return;
  const equip = state.settings.equipment||[];
  const byDept = {};
  equip.forEach(e=>{ const k=e.dept||'shared'; if (!byDept[k]) byDept[k]=[]; byDept[k].push(e); });
  const groups = [
    { key:'kitchen', label:'🍳 Kitchen',        items:byDept.kitchen||[] },
    { key:'foh',     label:'🍽 Front of House', items:byDept.foh||[]     },
    { key:'shared',  label:'📦 Shared',         items:byDept.shared||[]  },
  ];
  list.innerHTML = groups.map(g=>{
    if (!g.items.length) return '';
    return `<div class="settings-dept-group">
      <div class="settings-dept-header">${g.label}</div>
      ${g.items.map(e=>{
        const ti = EQUIPMENT_TYPES[e.type]||EQUIPMENT_TYPES.other;
        return `<div class="settings-item">
          <div class="settings-item-icon">${ti.icon}</div>
          <div class="settings-item-content">
            <div class="settings-item-main">${e.name}</div>
            <div class="settings-item-sub">${ti.label} · ${ti.target}</div>
          </div>
          <div class="settings-item-actions">
            <button class="set-btn-edit" onclick="editEquipment('${e.id}')">Edit</button>
            <button class="set-btn-delete" onclick="deleteEquipment('${e.id}')">✕</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  rebuildTempLocationDropdown();
}

function addEquipment() {
  const name = document.getElementById('new-equip-name').value.trim();
  const type = document.getElementById('new-equip-type').value;
  const dept = document.getElementById('new-equip-dept').value;
  if (!name) { showToast('Enter a name', 'error'); return; }
  state.settings.equipment.push({ id:'eu_'+Date.now(), name, type, dept });
  document.getElementById('new-equip-name').value='';
  saveSettings(); syncSettingsToSheets(); renderEquipmentList();
  showToast(`${name} added ✓`, 'success');
}

function editEquipment(id) {
  const e = state.settings.equipment.find(e=>e.id===id); if (!e) return;
  const name = prompt('Name:', e.name); if (name===null) return;
  e.name = name.trim()||e.name;
  saveSettings(); syncSettingsToSheets(); renderEquipmentList(); showToast('Updated ✓','success');
}

function deleteEquipment(id) {
  const e = state.settings.equipment.find(e=>e.id===id);
  if (!e||!confirm(`Remove "${e.name}"?`)) return;
  state.settings.equipment = state.settings.equipment.filter(eq=>eq.id!==id);
  saveSettings(); syncSettingsToSheets(); renderEquipmentList();
}

// ── Checklist editors ─────────────────────────────────
function renderCheckEditors() {
  const editorDefs = [
    ['shared-opening',   'sharedChecks',   'opening' ],
    ['shared-closing',   'sharedChecks',   'closing'  ],
    ['kitchen-opening',  'checks.kitchen', 'opening'  ],
    ['kitchen-closing',  'checks.kitchen', 'closing'  ],
    ['kitchen-cleaning', 'checks.kitchen', 'cleaning' ],
    ['foh-opening',      'checks.foh',     'opening'  ],
    ['foh-closing',      'checks.foh',     'closing'  ],
    ['foh-cleaning',     'checks.foh',     'cleaning' ],
    ['mgmt-weekly',      'checks.mgmt',    'weekly'   ],
  ];
  editorDefs.forEach(([eid, path, section]) => renderChecklistEditor(eid, path, section));
}

function getChecksRef(path) {
  return path.split('.').reduce((o,k)=>o?.[k], state.settings);
}

function renderChecklistEditor(editorId, path, section) {
  const container = document.getElementById(`checklist-editor-${editorId}`); if (!container) return;
  const checks = getChecksRef(path)?.[section]||[];
  container.innerHTML = checks.map((c,i)=>`
    <div class="check-edit-item ${c.enabled?'':'disabled'}">
      <label class="check-edit-toggle">
        <input type="checkbox" ${c.enabled?'checked':''} onchange="toggleCheck('${path}','${section}','${c.id}',this.checked)"/>
        <span class="toggle-slider"></span>
      </label>
      <span class="check-edit-label">${c.label}</span>
      <div class="check-edit-actions">
        <button class="set-btn-move" onclick="moveCheck('${path}','${section}','${c.id}',-1)" ${i===0?'disabled':''}>↑</button>
        <button class="set-btn-move" onclick="moveCheck('${path}','${section}','${c.id}',1)"  ${i===checks.length-1?'disabled':''}>↓</button>
        ${c.id.startsWith('cu_')||c.id.startsWith('sh_cu_')?`<button class="set-btn-delete" onclick="deleteCheck('${path}','${section}','${c.id}')">✕</button>`:''}
      </div>
    </div>`).join('');
}

function toggleCheck(path,section,id,enabled) {
  const checks=getChecksRef(path)?.[section]; const c=checks?.find(c=>c.id===id);
  if (c) { c.enabled=enabled; saveSettings(); syncSettingsToSheets(); rebuildAllChecklists(); renderCheckEditors(); }
}
function moveCheck(path,section,id,dir) {
  const checks=getChecksRef(path)?.[section]; if (!checks) return;
  const idx=checks.findIndex(c=>c.id===id); const ni=idx+dir;
  if (ni<0||ni>=checks.length) return;
  [checks[idx],checks[ni]]=[checks[ni],checks[idx]];
  saveSettings(); renderCheckEditors(); rebuildAllChecklists();
}
function deleteCheck(path,section,id) {
  if (!confirm('Remove this check?')) return;
  const ref=getChecksRef(path); if (ref?.[section]) ref[section]=ref[section].filter(c=>c.id!==id);
  saveSettings(); syncSettingsToSheets(); renderCheckEditors(); rebuildAllChecklists();
}
function addCustomCheck(path,section,inputId) {
  const input=document.getElementById(inputId); const label=input?.value.trim();
  if (!label) { showToast('Enter a check description','error'); return; }
  const ref=getChecksRef(path); if (!ref[section]) ref[section]=[];
  ref[section].push({ id:'cu_'+Date.now(), label, enabled:true });
  input.value=''; saveSettings(); syncSettingsToSheets(); renderCheckEditors(); rebuildAllChecklists();
  showToast('Check added ✓','success');
}

// ── PIN change ────────────────────────────────────────
function showChangePinModal() {
  const el=document.createElement('div'); el.id='change-pin-modal'; el.className='modal-overlay';
  el.innerHTML=`<div class="modal-box" style="max-width:360px">
    <h2 class="modal-title">Change PIN</h2>
    <p class="modal-desc">Choose a new 4–6 digit manager PIN</p>
    <div class="modal-field"><label>Current PIN</label><input type="password" id="pin-current" class="text-field" maxlength="6" inputmode="numeric"/></div>
    <div class="modal-field"><label>New PIN</label><input type="password" id="pin-new" class="text-field" maxlength="6" inputmode="numeric"/></div>
    <div class="modal-field"><label>Confirm PIN</label><input type="password" id="pin-confirm" class="text-field" maxlength="6" inputmode="numeric"/></div>
    <p id="pin-change-error" style="color:var(--danger);font-size:12px;min-height:18px"></p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="document.getElementById('change-pin-modal').remove()">Cancel</button>
      <button class="btn-submit" onclick="submitPinChange()">Update PIN</button>
    </div></div>`;
  document.body.appendChild(el);
}

function submitPinChange() {
  const cur=document.getElementById('pin-current').value, np=document.getElementById('pin-new').value, cf=document.getElementById('pin-confirm').value, err=document.getElementById('pin-change-error');
  if (!verifyPin(cur))   { err.textContent='Current PIN incorrect'; return; }
  if (np.length<4)       { err.textContent='Must be 4+ digits'; return; }
  if (np!==cf)           { err.textContent='PINs do not match'; return; }
  if (!/^\d+$/.test(np)){ err.textContent='Digits only'; return; }
  changePin(cur,np); document.getElementById('change-pin-modal')?.remove(); showToast('PIN updated ✓','success');
}

function showReassignDeviceModal() {
  showPinModal(()=>{
    saveDevice(null); state.device=null;
    showDeviceSetup(()=>{ applyDeviceIdentity(); rebuildAllChecklists(); rebuildSignedByDropdowns(); rebuildTempLocationDropdown(); rebuildProbeProductDropdown(); showTab('dashboard'); updateDashboard(); });
  });
}

// ── Probe products ────────────────────────────────────
function rebuildProbeProductDropdown() {
  const select = document.getElementById('probe-product');
  if (!select) return;
  const products = (state.settings.probeProducts || []).filter(p => p.enabled);
  select.innerHTML = `<option value="">Select product / dish...</option>` +
    products.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
}

function renderProbeProductList() {
  const list = document.getElementById('probe-product-list');
  if (!list) return;
  const products = state.settings.probeProducts || [];
  if (!products.length) {
    list.innerHTML = '<p class="empty-state" style="padding:20px">No products added yet</p>';
    return;
  }
  list.innerHTML = products.map((p, i) => `
    <div class="check-edit-item ${p.enabled ? '' : 'disabled'}">
      <label class="check-edit-toggle">
        <input type="checkbox" ${p.enabled ? 'checked' : ''}
          onchange="toggleProbeProduct('${p.id}', this.checked)"/>
        <span class="toggle-slider"></span>
      </label>
      <span class="check-edit-label">${p.name}</span>
      <div class="check-edit-actions">
        <button class="set-btn-move" onclick="moveProbeProduct('${p.id}', -1)" ${i===0?'disabled':''}>↑</button>
        <button class="set-btn-move" onclick="moveProbeProduct('${p.id}',  1)" ${i===products.length-1?'disabled':''}>↓</button>
        <button class="set-btn-edit"   onclick="editProbeProduct('${p.id}')">Edit</button>
        <button class="set-btn-delete" onclick="deleteProbeProduct('${p.id}')">✕</button>
      </div>
    </div>`).join('');
}

function addProbeProduct() {
  const input = document.getElementById('new-probe-product');
  const name  = input?.value.trim();
  if (!name) { showToast('Enter a product name', 'error'); return; }
  if (!state.settings.probeProducts) state.settings.probeProducts = [];
  state.settings.probeProducts.push({ id: 'pp_' + Date.now(), name, enabled: true });
  input.value = '';
  saveSettings(); syncSettingsToSheets();
  renderProbeProductList(); rebuildProbeProductDropdown();
  showToast(`${name} added ✓`, 'success');
}

function editProbeProduct(id) {
  const p = (state.settings.probeProducts || []).find(p => p.id === id);
  if (!p) return;
  const name = prompt('Product name:', p.name);
  if (name === null) return;
  p.name = name.trim() || p.name;
  saveSettings(); syncSettingsToSheets();
  renderProbeProductList(); rebuildProbeProductDropdown();
  showToast('Updated ✓', 'success');
}

function toggleProbeProduct(id, enabled) {
  const p = (state.settings.probeProducts || []).find(p => p.id === id);
  if (p) { p.enabled = enabled; saveSettings(); syncSettingsToSheets(); renderProbeProductList(); rebuildProbeProductDropdown(); }
}

function moveProbeProduct(id, dir) {
  const products = state.settings.probeProducts || [];
  const idx = products.findIndex(p => p.id === id);
  const ni  = idx + dir;
  if (ni < 0 || ni >= products.length) return;
  [products[idx], products[ni]] = [products[ni], products[idx]];
  saveSettings(); renderProbeProductList(); rebuildProbeProductDropdown();
}

function deleteProbeProduct(id) {
  const p = (state.settings.probeProducts || []).find(p => p.id === id);
  if (!p || !confirm(`Remove "${p.name}"?`)) return;
  state.settings.probeProducts = state.settings.probeProducts.filter(p => p.id !== id);
  saveSettings(); syncSettingsToSheets();
  renderProbeProductList(); rebuildProbeProductDropdown();
}
function loadTheme() { applyTheme(localStorage.getItem(THEME_KEY)||'dark', false); }
function applyTheme(theme, save=true) { document.body.classList.toggle('theme-light', theme==='light'); if (save) localStorage.setItem(THEME_KEY, theme); updateThemeButtons(theme); }
function setTheme(theme) { applyTheme(theme); }
function currentTheme()  { return localStorage.getItem(THEME_KEY)||'dark'; }
function updateThemeButtons(theme) { document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('active', b.dataset.theme===theme)); }

// ── Sync settings ─────────────────────────────────────
async function syncSettingsToSheets() {
  if (!state.config?.sheetsUrl) return;
  try { await fetch(state.config.sheetsUrl, { method:'POST', mode:'no-cors', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'saveSettings', sheetTab:SETTINGS_TAB, settings:state.settings }) }); }
  catch(e) { console.warn('Settings sync failed:', e); }
}

async function pullSettingsFromSheets() {
  if (!state.config?.sheetsUrl) return;
  try {
    const resp = await fetch(`${state.config.sheetsUrl}?action=readSettings&tab=${encodeURIComponent(SETTINGS_TAB)}`, { method:'GET', mode:'cors' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.status==='ok'&&data.settings) { state.settings=deepMergeSettings(state.settings, data.settings); saveSettings(); }
  } catch(e) { console.warn('Settings pull failed:', e); }
}
