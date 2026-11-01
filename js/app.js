// ============================================================
// MyCreativeWork — app.js  v3
// Folders are the primary unit. No Projects.
// ============================================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ────────────────────────────────────────────────────
const State = {
  user: null,
  isAdmin: false,
  view: 'dashboard',
  viewMode: 'grid',
  categories: [],
  folders: [],
  files: [],
  events: [],
  search: '',
  pendingConfirm: null,
  folderStack: [],
  selectedEvent: null,
  sortBy: 'date_desc',
  profile: null,
  profileAvatarUrl: null,
  filterYear: '',
  filterMonth: '',
  filterType: '',
};

// active settings tab — persists during the session
let _settingsTab = 'personal';
// pending photo file before save
let _pendingAvatarFile = null;

// ── Bootstrap ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Set data-view immediately so the loading icon gets the right page colour
  const _initView = location.hash.slice(1) || 'dashboard';
  document.getElementById('view-container').dataset.view = _initView;

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      openModal('admin-login-modal');
    }
  });

  window.addEventListener('hashchange', () => {
    const raw = location.hash.slice(1) || 'dashboard';
    if (raw !== State.view) { State.folderStack = []; State.selectedEvent = null; }
    State.view = raw;
    State.search = '';
    document.getElementById('search-input').value = '';
    renderView();
    updateNavActive();
  });

  const { data: { session } } = await db.auth.getSession();
  if (session) setAdmin(session.user);
  db.auth.onAuthStateChange((_e, s) => { if (s) setAdmin(s.user); else clearAdmin(); });

  await Promise.all([loadCategories(), loadFolders(), loadFiles(), loadEvents()]);
  populateFolderSelects();
  injectFolderModal();
  injectEventModal();

  const hash = location.hash.slice(1) || 'dashboard';
  State.view = hash;
  renderView();
  updateNavActive();
  initVisitor();
});

// ── Auth ─────────────────────────────────────────────────────
function setAdmin(user) {
  State.user = user; State.isAdmin = true;
  document.getElementById('admin-badge').style.display = 'flex';
  document.getElementById('admin-actions').style.display = 'flex';
  document.getElementById('sidebar-mode-label').textContent = 'Admin Mode';
  const av = document.getElementById('header-avatar');
  if (av) av.style.display = 'flex';
  document.body.classList.add('is-admin');
  loadProfile();
  // Hide visitor header/form when admin logs in
  const vh = document.getElementById('header-visitor');
  if (vh) vh.style.display = 'none';
  const vm = document.getElementById('visitor-modal');
  if (vm) { vm.classList.remove('open'); document.body.style.overflow = ''; }
  _visitorStopIdle();
  _visitorSubscribeAdmin();
}
function clearAdmin() {
  State.user = null; State.isAdmin = false;
  State.profile = null; State.profileAvatarUrl = null;
  document.getElementById('admin-badge').style.display = 'none';
  document.getElementById('admin-actions').style.display = 'none';
  document.getElementById('sidebar-mode-label').textContent = 'Creative Workspace';
  const av = document.getElementById('header-avatar');
  if (av) av.style.display = 'none';
  document.body.classList.remove('is-admin');
  refreshHeaderAvatar(null);
  // Re-init visitor flow after admin logout
  _visitorUnsubscribeAdmin();
  initVisitor();
}

// ── Visitor Tracking ──────────────────────────────────────────
const _VID   = 'mcw_visitor_id';
const _VNAME = 'mcw_visitor_name';
const _VIDLE = 10 * 60 * 1000; // 10 minutes
let _vLastAct = Date.now();
let _vIdleTimer = null;
let _vAdminCh = null;
const _VCOLORS = ['#7C3AED','#0D9488','#EC4899','#F97316','#0EA5E9','#10B981','#3B82F6','#EF4444'];

function _visitorBrowserId() {
  let id = localStorage.getItem(_VID);
  if (!id) {
    // Works in all contexts including file://
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem(_VID, id);
  }
  return id;
}
function _visitorGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function _visitorColor(name) {
  return _VCOLORS[(name.charCodeAt(0) || 0) % _VCOLORS.length];
}

async function initVisitor() {
  if (State.isAdmin) return;
  const name = localStorage.getItem(_VNAME);
  if (name) {
    await _visitorActivate(name, false);
    _visitorShowHeader(name);
    _visitorStartIdle();
  } else {
    _visitorShowForm();
  }
}

function _visitorShowForm() {
  const vh = document.getElementById('header-visitor');
  if (vh) vh.style.display = 'none';
  const vm = document.getElementById('visitor-modal');
  if (vm) { vm.classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => document.getElementById('visitor-name-input')?.focus(), 120); }
}

async function submitVisitorName() {
  const input = document.getElementById('visitor-name-input');
  const name  = (input?.value || '').trim();
  if (!name) { input?.focus(); return; }
  input.disabled = true;
  try {
    localStorage.setItem(_VNAME, name);
    await _visitorActivate(name, true);
    const vm2 = document.getElementById('visitor-modal');
    if (vm2) { vm2.classList.remove('open'); document.body.style.overflow = ''; }
    input.value = ''; input.disabled = false;
    _visitorShowHeader(name);
    _visitorStartIdle();
    renderView(); // refresh dashboard greeting with the new name
  } catch(e) {
    input.disabled = false;
  }
}

async function _visitorActivate(name, newSession) {
  const bid = _visitorBrowserId();
  const { data: existing } = await db.from('visitors').select('visit_count').eq('browser_id', bid).maybeSingle();
  if (existing) {
    const upd = { name, is_active: true, last_seen: new Date().toISOString() };
    if (newSession) upd.visit_count = (existing.visit_count || 1) + 1;
    await db.from('visitors').update(upd).eq('browser_id', bid);
  } else {
    await db.from('visitors').insert({ browser_id: bid, name, visit_count: 1, is_active: true });
  }
}

function _visitorShowHeader(name) {
  const el = document.getElementById('header-visitor');
  if (!el) return;
  const color = _visitorColor(name);
  const chip  = document.getElementById('visitor-avatar-chip');
  if (chip) { chip.style.background = color + '20'; chip.style.color = color; chip.style.borderColor = color + '40'; }
  const init = document.getElementById('visitor-initial');
  if (init) { init.textContent = name.charAt(0).toUpperCase(); init.style.color = color; }
  const greet = document.getElementById('visitor-greeting-text');
  if (greet) greet.textContent = `${_visitorGreeting()}, ${name}`;
  el.style.display = 'flex';
}

function _visitorStartIdle() {
  _vLastAct = Date.now();
  document.addEventListener('mousemove', _visitorResetIdle, { passive: true });
  document.addEventListener('keydown',   _visitorResetIdle, { passive: true });
  document.addEventListener('click',     _visitorResetIdle, { passive: true });
  if (_vIdleTimer) clearInterval(_vIdleTimer);
  _vIdleTimer = setInterval(_visitorCheckIdle, 30_000);
}
function _visitorStopIdle() {
  if (_vIdleTimer) { clearInterval(_vIdleTimer); _vIdleTimer = null; }
  document.removeEventListener('mousemove', _visitorResetIdle);
  document.removeEventListener('keydown',   _visitorResetIdle);
  document.removeEventListener('click',     _visitorResetIdle);
}
function _visitorResetIdle() { _vLastAct = Date.now(); }
function _visitorCheckIdle() {
  if (Date.now() - _vLastAct > _VIDLE) visitorLogout(true);
}

async function visitorLogout(silent = false) {
  _visitorStopIdle();
  const bid = localStorage.getItem(_VID);
  if (bid) await db.from('visitors').update({ is_active: false, last_seen: new Date().toISOString() }).eq('browser_id', bid);
  localStorage.removeItem(_VNAME);
  const vh = document.getElementById('header-visitor');
  if (vh) vh.style.display = 'none';
  if (!silent) toast('Session ended. See you soon!', 'info');
  else toast('You were logged out after 10 min of inactivity', 'info');
  _visitorShowForm();
}

// Admin: show current visitors immediately, then poll every 30s for new arrivals
let _vPollTimer = null;
let _vSeenIds   = new Set();

async function _visitorSubscribeAdmin() {
  if (!State.isAdmin || _vPollTimer) return;
  await _visitorPollTick(); // show who's online right now
  _vPollTimer = setInterval(_visitorPollTick, 30_000);
}

async function _visitorPollTick() {
  if (!State.isAdmin) return;
  const { data } = await db.from('visitors').select('id,name,visit_count').eq('is_active', true);
  (data || []).forEach(r => {
    if (!_vSeenIds.has(r.id)) {
      _vSeenIds.add(r.id);
      const times = r.visit_count > 1 ? ` (visit #${r.visit_count})` : '';
      toast(`👁️ ${r.name} is viewing${times}`, 'info');
    }
  });
}

function _visitorUnsubscribeAdmin() {
  if (_vPollTimer) { clearInterval(_vPollTimer); _vPollTimer = null; }
  _vSeenIds.clear();
}

// ── Profile helpers ───────────────────────────────────────────
async function loadProfile() {
  if (!State.user) return;
  const uid = State.user.id;
  const { data, error } = await db.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) { console.warn('loadProfile:', error.message); return; }
  if (!data) {
    const name = State.user.user_metadata?.full_name || '';
    await db.from('profiles').insert({ id: uid, full_name: name });
    State.profile = { id: uid, full_name: name, avatar_path: null };
  } else {
    State.profile = data;
  }
  if (State.profile.avatar_path) {
    const { data: u } = await db.storage.from('avatars').createSignedUrl(State.profile.avatar_path, 3600);
    State.profileAvatarUrl = u?.signedUrl || null;
  } else {
    State.profileAvatarUrl = null;
  }
  refreshHeaderAvatar(State.profileAvatarUrl);
  if (State.view === 'settings') renderView();
}

function refreshHeaderAvatar(url) {
  const src = url || 'assets/myphoto.png';
  document.querySelectorAll('.avatar-photo, .avatar-dropdown-photo').forEach(img => img.src = src);
  const ps = document.getElementById('ps-avatar-img');
  if (ps) ps.src = src;
}

function refreshHeaderName(name) {
  document.querySelectorAll('.avatar-name').forEach(el => el.textContent = name);
  document.querySelectorAll('.avatar-dropdown-name').forEach(el => el.textContent = name);
  const el = document.getElementById('ps-profile-name');
  if (el) el.textContent = name;
}

function psMsg(type, msg) {
  const el = document.getElementById('ps-msg');
  if (!el) { toast(msg, type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'); return; }
  el.className = 'ps-msg ps-msg-' + type;
  el.textContent = msg;
  el.style.display = 'flex';
  if (type !== 'error') setTimeout(() => { if (el) el.style.display = 'none'; }, 5000);
}

function switchSettingsTab(tab) {
  _settingsTab = tab;
  // swap visible panel without full re-render
  ['personal','password','photo'].forEach(t => {
    const panel = document.getElementById('ps-panel-' + t);
    const btn   = document.getElementById('ps-tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn)   btn.className = 'ps-tab' + (t === tab ? ' active' : '');
  });
  const msgEl = document.getElementById('ps-msg');
  if (msgEl) msgEl.style.display = 'none';
}

async function savePersonalInfo() {
  const nameEl  = document.getElementById('ps-name');
  const emailEl = document.getElementById('ps-email');
  const btn     = document.getElementById('ps-info-btn');
  const name  = nameEl?.value.trim();
  const email = emailEl?.value.trim();
  if (!name)  { psMsg('error', 'Full name is required'); return; }
  if (!email || !email.includes('@')) { psMsg('error', 'Valid email address required'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const { error: pe } = await db.from('profiles')
      .update({ full_name: name, updated_at: new Date().toISOString() })
      .eq('id', State.user.id);
    if (pe) throw pe;
    State.profile = { ...State.profile, full_name: name };
    refreshHeaderName(name);
    if (email !== State.user.email) {
      const { error: ae } = await db.auth.updateUser({ email });
      if (ae) throw ae;
      psMsg('info', `Name saved. Confirm your new email at ${email} to complete the change.`);
    } else {
      psMsg('success', 'Changes saved successfully ✓');
    }
  } catch(e) { psMsg('error', e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save Changes'; }
}

async function changePassword() {
  const cur  = document.getElementById('ps-cur-pass')?.value;
  const nw   = document.getElementById('ps-new-pass')?.value;
  const conf = document.getElementById('ps-conf-pass')?.value;
  const btn  = document.getElementById('ps-pass-btn');
  if (!cur || !nw || !conf) { psMsg('error', 'All fields are required'); return; }
  if (nw !== conf)          { psMsg('error', 'New passwords do not match'); return; }
  if (nw.length < 6)        { psMsg('error', 'Password must be at least 6 characters'); return; }
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const { error: re } = await db.auth.signInWithPassword({ email: State.user.email, password: cur });
    if (re) throw new Error('Current password is incorrect');
    btn.textContent = 'Updating…';
    const { error: ue } = await db.auth.updateUser({ password: nw });
    if (ue) throw ue;
    psMsg('success', 'Password updated successfully ✓');
    document.getElementById('ps-cur-pass').value  = '';
    document.getElementById('ps-new-pass').value  = '';
    document.getElementById('ps-conf-pass').value = '';
  } catch(e) { psMsg('error', e.message); }
  finally { btn.disabled = false; btn.textContent = 'Update Password'; }
}

function togglePassVis(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function handleAvatarSelect(input) {
  const file = input?.files[0];
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/webp'];
  if (!allowed.includes(file.type)) { psMsg('error', 'Only JPG, PNG or WebP allowed'); return; }
  if (file.size > 5 * 1024 * 1024) { psMsg('error', 'File must be under 5 MB'); return; }
  _pendingAvatarFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('ps-photo-preview');
    if (prev) prev.src = e.target.result;
    const saveBtn = document.getElementById('ps-photo-save-btn');
    if (saveBtn) saveBtn.style.display = 'inline-flex';
    psMsg('info', 'Photo selected — click Save Photo to upload');
  };
  reader.readAsDataURL(file);
}

async function saveProfilePhoto() {
  if (!_pendingAvatarFile) { psMsg('error', 'No photo selected'); return; }
  const btn = document.getElementById('ps-photo-save-btn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const uid = State.user.id;
    const ext = _pendingAvatarFile.type === 'image/png' ? 'png'
              : _pendingAvatarFile.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${uid}/avatar.${ext}`;
    const { error: ue } = await db.storage.from('avatars')
      .upload(path, _pendingAvatarFile, { upsert: true, contentType: _pendingAvatarFile.type });
    if (ue) throw ue;
    const { error: de } = await db.from('profiles')
      .update({ avatar_path: path, updated_at: new Date().toISOString() })
      .eq('id', uid);
    if (de) throw de;
    const { data: su } = await db.storage.from('avatars').createSignedUrl(path, 3600);
    State.profile.avatar_path = path;
    State.profileAvatarUrl = su?.signedUrl || null;
    refreshHeaderAvatar(State.profileAvatarUrl);
    _pendingAvatarFile = null;
    psMsg('success', 'Profile photo updated ✓');
    renderView();
  } catch(e) { psMsg('error', e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save Photo'; }
}

async function removeProfilePhoto() {
  if (!State.profile?.avatar_path) return;
  if (!confirm('Remove your profile photo?')) return;
  try {
    await db.storage.from('avatars').remove([State.profile.avatar_path]);
    await db.from('profiles').update({ avatar_path: null }).eq('id', State.user.id);
    State.profile.avatar_path = null;
    State.profileAvatarUrl = null;
    _pendingAvatarFile = null;
    refreshHeaderAvatar(null);
    psMsg('success', 'Profile photo removed');
    renderView();
  } catch(e) { psMsg('error', e.message); }
}
async function adminLogin() {
  const email = document.getElementById('admin-email').value.trim();
  const pass  = document.getElementById('admin-password').value;
  if (!email || !pass) { toast('Enter email and password', 'error'); return; }
  const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
  if (error) { toast(error.message, 'error'); return; }
  setAdmin(data.user);
  closeModal('admin-login-modal');
  document.getElementById('admin-email').value = '';
  document.getElementById('admin-password').value = '';
  toast('Admin mode unlocked ✓', 'success');
  renderView();
}
async function adminLogout() {
  await db.auth.signOut(); clearAdmin();
  toast('Signed out', 'info'); renderView();
}

// ── Data loaders ─────────────────────────────────────────────
async function loadCategories() {
  const { data } = await db.from('categories').select('*').order('name');
  State.categories = data || [];
}
async function loadFolders() {
  const { data } = await db.from('folders').select('*').eq('is_deleted', false).order('name');
  State.folders = data || [];
}
async function loadFiles() {
  const { data } = await db.from('files').select('*').eq('is_deleted', false).order('created_at', { ascending: false });
  State.files = data || [];
}
async function loadEvents() {
  const { data } = await db.from('events').select('*').eq('is_deleted', false).order('event_date', { ascending: false });
  State.events = data || [];
}

// ── Router ────────────────────────────────────────────────────
function navigate(view) { resetFilters(); location.hash = view; closeMobileMenu(); }
function setFilter(key, val) { State[key] = val; renderView(); }
function resetFilters() { State.filterYear = ''; State.filterMonth = ''; State.filterType = ''; }
function updateNavActive() {
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === State.view));
}
function setView(mode) {
  State.viewMode = mode;
  renderView();
}
function viewToggleControl() {
  const svgGrid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`;
  const svgList = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
  return `<div class="inline-view-toggle">
    <button class="ivt-btn${State.viewMode==='grid'?' active':''}" onclick="setView('grid')" title="Grid view">${svgGrid}</button>
    <button class="ivt-btn${State.viewMode==='list'?' active':''}" onclick="setView('list')" title="List view">${svgList}</button>
  </div>`;
}
function handleSearch(val) { State.search = val.toLowerCase(); renderView(); }

const TOGGLE_VIEWS = new Set(['files','videos','images','events','favorites','recent','archive','folders']);

// ── Render dispatcher ─────────────────────────────────────────
function renderView() {
  const c = document.getElementById('view-container');
  c.className = 'fade-in'; c.dataset.view = State.view; void c.offsetWidth;
  const views = {
    dashboard: renderDashboard, files: renderFiles,
    folders:   renderFolders,  videos: renderVideos,
    images:    renderImages,   events: renderEvents,
    favorites: renderFavorites, recent: renderRecent,
    archive:   renderArchive,  trash: renderTrash,
    settings:  renderSettings,
  };
  if (window._clockInterval) { clearInterval(window._clockInterval); window._clockInterval = null; }
  c.innerHTML = (views[State.view] || renderDashboard)();
  const toggle = document.getElementById('view-toggle');
  if (toggle) toggle.style.display = TOGGLE_VIEWS.has(State.view) ? 'flex' : 'none';
  // Start live clock if dashboard rendered
  if (State.view === 'dashboard') {
    window._clockInterval = setInterval(() => {
      const el = document.getElementById('db-live-clock');
      if (!el) { clearInterval(window._clockInterval); return; }
      el.textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }, 1000);
  }
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  const isAdmin = State.isAdmin;
  const totalFiles   = State.files.length;
  const totalFolders = State.folders.length;
  const totalSize    = State.files.reduce((s, f) => s + (f.file_size || 0), 0);
  const storagePct   = Math.min(totalSize / 1073741824 * 100, 100).toFixed(2);

  // Files by type counts
  const typeMap = { video: 0, image: 0, document: 0, audio: 0, other: 0 };
  State.files.forEach(f => {
    const t = f.file_type || 'other';
    if (typeMap[t] !== undefined) typeMap[t]++;
    else typeMap.other++;
  });
  const typeConfig = [
    { key: 'video',    label: 'Video',     color: '#2563EB' },
    { key: 'image',    label: 'Images',    color: '#EC4899' },
    { key: 'document', label: 'Documents', color: '#10B981' },
    { key: 'audio',    label: 'Audio',     color: '#F97316' },
    { key: 'other',    label: 'Others',    color: '#7C3AED' },
  ];

  // Donut chart SVG
  const RADIUS = 70, CX = 90, CY = 90, CIRC = 2 * Math.PI * RADIUS;
  let offset = 0;
  const donutSegments = typeConfig.map(tc => {
    const count = typeMap[tc.key] || 0;
    const pct = totalFiles > 0 ? count / totalFiles : 0;
    const dash = pct * CIRC;
    const gap  = CIRC - dash;
    const seg  = count > 0
      ? `<circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="none" stroke="${tc.color}" stroke-width="18"
           stroke-dasharray="${dash} ${gap}"
           stroke-dashoffset="${-offset}"
           style="transform-origin:${CX}px ${CY}px;transform:rotate(-90deg)"/>`
      : '';
    offset += dash;
    return seg;
  }).join('');

  const donutSvg = `
    <svg width="180" height="180" viewBox="0 0 180 180">
      ${totalFiles === 0
        ? `<circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="none" stroke="#E5E7EB" stroke-width="18"/>`
        : donutSegments}
      <text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="22" font-weight="800" fill="#0F172A">${totalFiles}</text>
      <text x="${CX}" y="${CY + 14}" text-anchor="middle" font-size="11" fill="#6B7280">Total Files</text>
    </svg>`;

  const typeLegend = typeConfig.map(tc => {
    const count = typeMap[tc.key] || 0;
    const pct   = totalFiles > 0 ? Math.round(count / totalFiles * 100) : 0;
    return `<div class="db-type-row">
      <span class="db-type-dot" style="background:${tc.color}"></span>
      <span class="db-type-label">${tc.label}</span>
      <span class="db-type-count">${count}</span>
      <span class="db-type-pct">${pct}%</span>
    </div>`;
  }).join('');

  // Recent files (last 5)
  const recentF = [...State.files]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  const recentRows = recentF.map(f => {
    const typeColors = { video: '#2563EB', image: '#EC4899', document: '#10B981', audio: '#F97316' };
    const tc = typeColors[f.file_type] || '#7C3AED';
    return `<div class="db-recent-row">
      <div class="db-recent-icon" style="background:${tc}18;color:${tc}">${fileTypeIcon(f.file_type)}</div>
      <div class="db-recent-info">
        <p class="db-recent-name">${esc(f.original_name || f.name)}</p>
        <p class="db-recent-meta">${formatBytes(f.file_size || 0)} · ${timeAgo(f.created_at)}</p>
      </div>
      <button class="db-open-btn" onclick="previewFile('${f.id}')">Open</button>
      <button class="db-dots-btn" title="More">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      </button>
    </div>`;
  }).join('');

  // Date/time + greeting
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
  const visitorName = !isAdmin ? localStorage.getItem(_VNAME) : null;
  const welcomeText = isAdmin
    ? `Welcome back, Bharat! 👋`
    : visitorName ? `${greeting}, ${visitorName}! 👋` : `${greeting}! 👋`;
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });


  return `
    <!-- Welcome Banner -->
    <div class="db-welcome">
      <div class="db-welcome-left">
        <h1 class="db-welcome-title">${welcomeText}</h1>
        <p class="db-welcome-sub">Manage your creative content, organize files and track your media assets.</p>
      </div>
      <div class="db-welcome-right">
        <div class="db-welcome-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:#4F46E5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div>
          <p class="db-welcome-date">${dateStr}</p>
          <p class="db-welcome-time" id="db-live-clock">${timeStr}</p>
        </div>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="db-stats-grid">
      <div class="db-stat-card db-stat-purple">
        <div class="db-stat-content">
          <div class="db-stat-icon" style="background:linear-gradient(135deg,#7C3AED,#A78BFA)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:22px;height:22px"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><polyline points="14,2 14,8 20,8"/></svg>
          </div>
          <div class="db-stat-vals">
            <span class="db-stat-num">${totalFiles}</span>
            <span class="db-stat-label">Files</span>
          </div>
        </div>
      </div>

      <div class="db-stat-card db-stat-blue">
        <div class="db-stat-content">
          <div class="db-stat-icon" style="background:linear-gradient(135deg,#2563EB,#3B82F6)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:22px;height:22px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="db-stat-vals">
            <span class="db-stat-num">${totalFolders}</span>
            <span class="db-stat-label">Folders</span>
          </div>
        </div>
      </div>

      <div class="db-stat-card db-stat-green">
        <div class="db-stat-content">
          <div class="db-stat-icon" style="background:linear-gradient(135deg,#10B981,#34D399)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:22px;height:22px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="db-stat-vals">
            <span class="db-stat-num">${State.events.length}</span>
            <span class="db-stat-label">Events</span>
          </div>
        </div>
      </div>

      <div class="db-stat-card db-stat-orange">
        <div class="db-stat-content">
          <div class="db-stat-icon" style="background:linear-gradient(135deg,#F97316,#FB923C)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:22px;height:22px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          </div>
          <div class="db-stat-vals">
            <span class="db-stat-num">${formatBytes(totalSize)}</span>
            <span class="db-stat-label">Storage Used</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions (admin only) -->
    ${isAdmin ? `<div class="db-actions-grid">
      <div class="db-action-card" style="background:linear-gradient(135deg,#4F46E5,#7C3AED)" onclick="openModalWithTheme('upload-modal','purple')">
        <div class="db-action-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>
        <div class="db-action-text">
          <p class="db-action-title">Upload File</p>
          <p class="db-action-sub">Add files to your vault</p>
        </div>
        <div class="db-action-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>

      <div class="db-action-card" style="background:linear-gradient(135deg,#2563EB,#3B82F6)" onclick="openNewFolderModal()">
        <div class="db-action-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        </div>
        <div class="db-action-text">
          <p class="db-action-title">New Folder</p>
          <p class="db-action-sub">Create a folder</p>
        </div>
        <div class="db-action-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>

      <div class="db-action-card" style="background:linear-gradient(135deg,#10B981,#059669)" onclick="navigate('folders')">
        <div class="db-action-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="db-action-text">
          <p class="db-action-title">Browse Folders</p>
          <p class="db-action-sub">Explore all folders</p>
        </div>
        <div class="db-action-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>

      <div class="db-action-card" style="background:linear-gradient(135deg,#F97316,#EA580C)" onclick="openModalWithTheme('event-modal','orange')">
        <div class="db-action-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:28px;height:28px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
        </div>
        <div class="db-action-text">
          <p class="db-action-title">New Event</p>
          <p class="db-action-sub">Schedule an event</p>
        </div>
        <div class="db-action-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="9,18 15,12 9,6"/></svg>
        </div>
      </div>
    </div>` : ''}

    <!-- Storage Usage -->
    <div class="db-storage-card${!isAdmin ? ' db-nonadmin-hide-mobile' : ''}">
      <div class="db-storage-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" style="width:22px;height:22px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      </div>
      <div class="db-storage-body">
        <p class="db-storage-title">Storage Usage</p>
        <p class="db-storage-sub">${formatBytes(totalSize)} used of unlimited storage</p>
        <div class="db-storage-track">
          <div class="db-storage-fill" style="width:${Math.max(parseFloat(storagePct), totalSize > 0 ? 0.5 : 0)}%"></div>
        </div>
      </div>
      <div class="db-storage-pct">${storagePct}%</div>
    </div>

    <!-- Files by Type + Recent Files -->
    <div class="db-bottom-grid${!isAdmin ? ' db-nonadmin-hide-mobile' : ''}">
      <!-- Files by Type -->
      <div class="db-card">
        <div class="db-card-header">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:30px;height:30px;background:#EEF2FF;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <h3 class="db-card-title">Files by Type</h3>
          </div>
          <a onclick="navigate('files')" class="db-view-all">View All →</a>
        </div>
        <div class="db-type-body">
          <div class="db-donut-wrap">${donutSvg}</div>
          <div class="db-type-legend">${typeLegend}</div>
        </div>
      </div>

      <!-- Recent Files -->
      <div class="db-card">
        <div class="db-card-header">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:30px;height:30px;background:#FFF0F8;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#EC4899" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
            </div>
            <h3 class="db-card-title">Recent Files</h3>
          </div>
          <a onclick="navigate('recent')" class="db-view-all">View All →</a>
        </div>
        <div class="db-recent-list">
          ${recentRows || '<p style="font-size:13px;color:#6B7280;padding:16px 0">No files yet</p>'}
        </div>
      </div>
    </div>
  `;
}

// ── Folders (drill-down) ──────────────────────────────────────
function enterFolder(id, name) {
  State.folderStack.push({ id, name });
  renderView();
}

function goToFolderLevel(index) {
  State.folderStack = State.folderStack.slice(0, index + 1);
  renderView();
}

function goToFolderRoot() {
  State.folderStack = [];
  renderView();
}

function renderFolders() {
  const allFolders = State.folders;
  const childrenOf = pid => allFolders.filter(f => f.parent_id === (pid || null));
  const fileCount  = fid => State.files.filter(f => f.folder_id === fid).length;
  const currentFolder = State.folderStack.length > 0
    ? State.folderStack[State.folderStack.length - 1] : null;

  const breadcrumb = `
    <div class="breadcrumb">
      <a onclick="goToFolderRoot()" style="cursor:pointer">All Folders</a>
      ${State.folderStack.map((f, i) => `
        ${svgWrap('<polyline points="9,18 15,12 9,6"/>',12)}
        ${i < State.folderStack.length - 1
          ? `<a onclick="goToFolderLevel(${i})" style="cursor:pointer">${esc(f.name)}</a>`
          : `<span>${esc(f.name)}</span>`}
      `).join('')}
    </div>`;

  const folderCard = f => {
    const subs = childrenOf(f.id);
    const fc   = fileCount(f.id);
    return `
    <div class="folder-card-v2">
      <div class="folder-card-main" onclick="enterFolder('${f.id}','${esc(f.name)}')">
        <div class="folder-icon">${folderIcon()}</div>
        <div class="folder-info">
          <h4>${esc(f.name)}</h4>
          <p>${fc} file${fc!==1?'s':''}${subs.length ? ` · ${subs.length} sub-folder${subs.length!==1?'s':''}` : ''}</p>
          ${f.description ? `<p class="folder-desc">${esc(f.description)}</p>` : ''}
        </div>
      </div>
      ${State.isAdmin ? `
      <div class="folder-card-btns">
        <button class="btn btn-ghost btn-xs" onclick="createSubFolder('${f.id}','${esc(f.name)}')">+ Sub-folder</button>
        <button class="btn btn-ghost btn-xs" onclick="editFolder('${f.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="trashFolder('${f.id}')">Delete</button>
      </div>` : ''}
    </div>`;
  };

  const folderRow = f => {
    const subs = childrenOf(f.id);
    const fc   = fileCount(f.id);
    return `
    <div class="list-row" onclick="enterFolder('${f.id}','${esc(f.name)}')">
      <div class="list-thumb" style="color:var(--green)">${folderIcon()}</div>
      <div class="list-info">
        <p class="list-name">${esc(f.name)}</p>
        <p class="list-meta">${fc} file${fc!==1?'s':''}${subs.length ? ` · ${subs.length} sub-folders` : ''}${f.description ? ` · ${esc(f.description)}` : ''}</p>
      </div>
      ${State.isAdmin ? `
      <div class="row-actions" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-xs" onclick="createSubFolder('${f.id}','${esc(f.name)}')">+ Sub</button>
        <button class="btn btn-ghost btn-xs" onclick="editFolder('${f.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="trashFolder('${f.id}')">Delete</button>
      </div>` : ''}
    </div>`;
  };

  // ── Inside a folder ──
  if (currentFolder) {
    let subFolders  = childrenOf(currentFolder.id);
    let folderFiles = State.files.filter(f => f.folder_id === currentFolder.id);
    if (State.search) {
      const q = State.search;
      subFolders  = subFolders.filter(f => f.name.toLowerCase().includes(q));
      folderFiles = folderFiles.filter(f =>
        (f.name||'').toLowerCase().includes(q) ||
        (f.original_name||'').toLowerCase().includes(q)
      );
    }
    return `
      ${breadcrumb}
      <div class="page-header">
        <div>
          <h1 class="page-title">${esc(currentFolder.name)}</h1>
          <p class="page-subtitle">${subFolders.length ? `${countBadge(subFolders.length)} sub-folder${subFolders.length!==1?'s':''}` : ''} ${folderFiles.length ? `${countBadge(folderFiles.length)} file${folderFiles.length!==1?'s':''}` : ''}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${viewToggleControl()}
          ${State.isAdmin ? `
            <button class="btn btn-sm" style="background:linear-gradient(135deg,#2563EB,#3B82F6);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 3px 10px rgba(37,99,235,.3)" onclick="openUploadInFolder('${currentFolder.id}')">Upload</button>
            <button class="btn btn-secondary btn-sm" onclick="createSubFolder('${currentFolder.id}','${esc(currentFolder.name)}')">+ Sub-folder</button>
            <button class="btn btn-ghost btn-sm" onclick="editFolder('${currentFolder.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="trashFolder('${currentFolder.id}')">Delete</button>
          ` : ''}
        </div>
      </div>

      ${subFolders.length ? `
        <div class="event-section-header"><span>Sub-folders</span><span class="event-section-count">${subFolders.length}</span></div>
        ${State.viewMode === 'grid'
          ? `<div class="folder-grid stagger">${subFolders.map(folderCard).join('')}</div>`
          : `<div class="list-view stagger">${subFolders.map(folderRow).join('')}</div>`}
        <div style="margin-bottom:24px"></div>
      ` : ''}

      ${folderFiles.length ? `
        <div class="event-section-header"><span>Files</span><span class="event-section-count">${folderFiles.length}</span></div>
        ${fileGrid(folderFiles)}
      ` : ''}

      ${!subFolders.length && !folderFiles.length
        ? emptyState('Empty folder', State.isAdmin ? 'Upload files or create sub-folders' : 'Nothing here yet', folderIcon())
        : ''}`;
  }

  // ── Root level ──
  let roots = childrenOf(null);
  if (State.search) roots = roots.filter(f =>
    f.name.toLowerCase().includes(State.search) ||
    (f.description||'').toLowerCase().includes(State.search)
  );

  return `
    ${breadcrumb}
    <div class="page-header">
      <div><h1 class="page-title">Folders ${countBadge(roots.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${viewToggleControl()}${State.isAdmin ? `<button class="btn btn-sm" style="background:linear-gradient(135deg,#2563EB,#3B82F6);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer" onclick="openNewFolderModal('blue')">+ New Folder</button>` : ''}</div>
    </div>
    ${roots.length
      ? (State.viewMode === 'grid'
          ? `<div class="folder-grid stagger">${roots.map(folderCard).join('')}</div>`
          : `<div class="list-view stagger">${roots.map(folderRow).join('')}</div>`)
      : emptyState('No folders yet', State.isAdmin ? 'Create your first folder to organise your files' : 'Folders will appear here', folderIcon())}`;
}

function openUploadInFolder(folderId) {
  openModal('upload-modal');
  const el = document.getElementById('upload-folder');
  if (el) el.value = folderId;
}

function openNewFolderModal(theme) {
  openModalWithTheme('folder-modal', theme || 'blue');
  setTimeout(() => {
    const el = document.getElementById('f-parent');
    if (el) el.value = '';
  }, 10);
}

function createSubFolder(parentId, parentName) {
  openModalWithTheme('folder-modal','blue');
  document.getElementById('folder-modal-title').textContent = `Sub-folder inside "${parentName}"`;
  document.getElementById('folder-save-label').textContent  = 'Create Sub-folder';
  document.getElementById('folder-edit-id').value = '';
  setTimeout(() => {
    const el = document.getElementById('f-parent');
    if (el) el.value = parentId;
  }, 10);
}

// ── Files ─────────────────────────────────────────────────────
function renderFiles() {
  const list = filterFiles(State.files);
  return `
    <div class="page-header">
      <div><h1 class="page-title">All Files ${countBadge(list.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${filterControl('type-year')}${viewToggleControl()}${State.isAdmin?`<button class="btn btn-sm" style="background:linear-gradient(135deg,#0D9488,#0F766E);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 3px 10px rgba(13,148,136,.3)" onclick="openModalWithTheme('upload-modal','teal')">Upload</button>`:''}</div>
    </div>
    ${list.length ? fileGrid(list) : emptyState('No files yet', 'Upload your first file', fileIcon())}`;
}

function renderVideos() {
  const list = filterFiles(State.files.filter(f => f.file_type === 'video'));
  return `
    <div class="page-header">
      <div><h1 class="page-title">Videos ${countBadge(list.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${filterControl('year-month')}${viewToggleControl()}${State.isAdmin?`<button class="btn btn-sm" style="background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;white-space:nowrap" onclick="openModalWithTheme('upload-modal','purple')">Upload</button>`:''}</div>
    </div>
    ${list.length ? fileGrid(list) : emptyState('No videos yet', 'Add videos via the Upload button', videoIcon())}`;
}

function renderImages() {
  const list = filterFiles(State.files.filter(f => f.file_type === 'image'));
  return `
    <div class="page-header">
      <div><h1 class="page-title">Images ${countBadge(list.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${filterControl('year-month')}${viewToggleControl()}${State.isAdmin?`<button class="btn btn-sm" style="background:linear-gradient(135deg,#EC4899,#DB2777);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer;white-space:nowrap" onclick="openModalWithTheme('upload-modal','pink')">Upload</button>`:''}</div>
    </div>
    ${list.length ? fileGrid(list) : emptyState('No images yet', 'Upload your image files', imageIcon())}`;
}

function filterFiles(list) {
  let result = list;
  if (State.search) {
    const q = State.search;
    result = result.filter(f =>
      (f.name||'').toLowerCase().includes(q) ||
      (f.original_name||'').toLowerCase().includes(q) ||
      (f.extension||'').toLowerCase().includes(q)
    );
  }
  if (State.filterType)  result = result.filter(f => f.file_type === State.filterType);
  if (State.filterYear)  result = result.filter(f => new Date(f.created_at).getFullYear() == State.filterYear);
  if (State.filterMonth) result = result.filter(f => (new Date(f.created_at).getMonth() + 1) == State.filterMonth);
  return sortFiles(result);
}

// ── Sort ──────────────────────────────────────────────────────
function sortFiles(list) {
  const s = [...list];
  if (State.sortBy === 'name_asc')  return s.sort((a,b) => (a.original_name||a.name||'').localeCompare(b.original_name||b.name||''));
  if (State.sortBy === 'name_desc') return s.sort((a,b) => (b.original_name||b.name||'').localeCompare(a.original_name||a.name||''));
  if (State.sortBy === 'date_asc')  return s.sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
  if (State.sortBy === 'year_desc') return s.sort((a,b) => {
    const ay = new Date(a.created_at).getFullYear(), by = new Date(b.created_at).getFullYear();
    return by !== ay ? by - ay : new Date(b.created_at)-new Date(a.created_at);
  });
  return s.sort((a,b) => new Date(b.created_at)-new Date(a.created_at)); // date_desc
}
function setSortBy(val) { State.sortBy = val; renderView(); }
function sortControl() {
  return `<select class="sort-select" onchange="setSortBy(this.value)">
    <option value="date_desc" ${State.sortBy==='date_desc'?'selected':''}>Newest first</option>
    <option value="date_asc"  ${State.sortBy==='date_asc' ?'selected':''}>Oldest first</option>
    <option value="name_asc"  ${State.sortBy==='name_asc' ?'selected':''}>A → Z</option>
    <option value="name_desc" ${State.sortBy==='name_desc'?'selected':''}>Z → A</option>
    <option value="year_desc" ${State.sortBy==='year_desc'?'selected':''}>By Year</option>
  </select>`;
}

function filterControl(pageType) {
  const years = [...new Set(State.files.map(f => new Date(f.created_at).getFullYear()))].sort((a,b)=>b-a);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yearSel = `<select class="sort-select" onchange="setFilter('filterYear',this.value)">
    <option value="">All Years</option>
    ${years.map(y=>`<option value="${y}" ${State.filterYear==y?'selected':''}>${y}</option>`).join('')}
  </select>`;
  const monthSel = `<select class="sort-select" onchange="setFilter('filterMonth',this.value)">
    <option value="">All Months</option>
    ${months.map((m,i)=>`<option value="${i+1}" ${State.filterMonth==i+1?'selected':''}>${m}</option>`).join('')}
  </select>`;
  const typeSel = `<select class="sort-select" onchange="setFilter('filterType',this.value)">
    <option value="">All Types</option>
    <option value="video" ${State.filterType==='video'?'selected':''}>Videos</option>
    <option value="image" ${State.filterType==='image'?'selected':''}>Photos</option>
    <option value="document" ${State.filterType==='document'?'selected':''}>Documents</option>
    <option value="other" ${State.filterType==='other'?'selected':''}>Other</option>
  </select>`;
  if (pageType === 'year-month') return yearSel + monthSel;
  if (pageType === 'type')       return typeSel;
  if (pageType === 'type-year')  return typeSel + yearSel;
  if (pageType === 'fav') return `<select class="sort-select" onchange="setFilter('filterType',this.value)">
    <option value="">All Types</option>
    <option value="video" ${State.filterType==='video'?'selected':''}>Videos</option>
    <option value="image" ${State.filterType==='image'?'selected':''}>Photos</option>
  </select>`;
  return '';
}

function fileGrid(list) {
  if (State.viewMode === 'list') {
    const header = `<div class="list-header">
      <div class="list-header-thumb"></div>
      <div class="list-header-col">File</div>
      <div class="list-header-col">Uploaded</div>
      <div class="list-header-col">Size</div>
      <div class="list-header-col list-header-actions">Actions</div>
    </div>`;
    return `<div class="list-view">${header}${list.map(fileListRow).join('')}</div>`;
  }
  return `<div class="file-grid stagger">${list.map(fileCard).join('')}</div>`;
}

function titleColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},52%,42%)`;
}

function fileThumb(f) {
  if (f.thumbnail_url)
    return `<img src="${esc(f.thumbnail_url)}" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`;
  if (f.file_type === 'image' && f.file_url && !f.file_path?.startsWith('url:'))
    return `<img src="${esc(f.file_url)}" alt="${esc(f.name)}" loading="lazy" />`;
  if (f.extension === 'youtube') {
    const id = f.file_url?.match(/(?:v=|youtu\.be\/)([^&?\s]+)/)?.[1];
    if (id) return `<img src="https://img.youtube.com/vi/${id}/mqdefault.jpg" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`;
  }
  if (f.extension === 'vimeo') {
    const id = f.file_url?.match(/vimeo\.com\/(\d+)/)?.[1];
    if (id) return `<img src="https://vumbnail.com/${id}.jpg" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`;
  }
  if (f.extension === 'canva') {
    const title = f.original_name || f.name || 'Canva Video';
    const c1 = titleColor(title), c2 = titleColor(title + '_2');
    const ev = f.event_id ? State.events.find(e => e.id === f.event_id) : null;
    const bgStyle = ev?.cover_image_url
      ? `background:url('${esc(ev.cover_image_url)}') center/cover no-repeat`
      : `background:linear-gradient(135deg,${c1},${c2})`;
    return `<div style="width:100%;height:100%;${bgStyle};position:relative;display:flex;align-items:center;justify-content:center">
      ${ev?.cover_image_url ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>` : ''}
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;text-align:center;gap:6px">
        <div style="width:36px;height:36px;background:rgba(255,255,255,.25);border:2px solid rgba(255,255,255,.8);border-radius:50%;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff" style="width:16px;height:16px;margin-left:2px"><polygon points="5,3 19,12 5,21"/></svg>
        </div>
        <span style="font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:100%">${esc(title)}</span>
        <span style="font-size:8px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.1em">CANVA</span>
      </div>
    </div>`;
  }
  const isUrl = f.file_path?.startsWith('url:');
  const ext   = (f.extension||'link').toUpperCase();
  return `<div class="file-icon-wrap ${isUrl?'url-thumb':''}" style="color:var(--green)">${fileTypeIcon(f.file_type)}${isUrl?`<span class="url-badge">${esc(ext)}</span>`:''}</div>`;
}

function fileCard(f) {
  const extBadge = (f.extension||'').toUpperCase();
  const iconMove = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const iconHeart = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${f.is_favorite?'#EC4899':'none'}" stroke="#EC4899" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  const iconTrash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  return `
  <div class="file-card">
    <div class="file-thumb" onclick="previewFile('${f.id}')" style="cursor:pointer" title="Preview">
      ${fileThumb(f)}
    </div>
    <p class="file-name" title="${esc(f.original_name)}">${esc(f.name || f.original_name)}</p>
    <p class="file-meta">${f.file_size ? formatBytes(f.file_size)+' · ' : ''}${extBadge}</p>
    ${State.isAdmin ? `
    <div class="file-card-actions">
      <button class="btn btn-xs fc-view-btn" onclick="previewFile('${f.id}')">View</button>
      <button class="fc-icon-btn" title="Move" onclick="openMoveModal('${f.id}')">${iconMove}</button>
      <button class="fc-icon-btn fc-fav-btn${f.is_favorite?' active':''}" title="${f.is_favorite?'Unfavorite':'Favorite'}" onclick="toggleFavorite('${f.id}',${f.is_favorite})">${iconHeart}</button>
      <button class="fc-icon-btn fc-del-btn" title="Delete" onclick="trashItem('${f.id}')">${iconTrash}</button>
    </div>` : `
    <div class="file-card-actions">
      <button class="btn btn-xs fc-view-btn" onclick="previewFile('${f.id}')">View</button>
    </div>`}
  </div>`;
}

function fileListRow(f) {
  const folderName = f.folder_id ? (State.folders.find(fd => fd.id === f.folder_id)?.name || '') : '';
  const extBadge  = (f.extension || '').toUpperCase();
  const typeLabel = f.file_type ? (f.file_type.charAt(0).toUpperCase() + f.file_type.slice(1)) : '';
  const sizeStr   = f.file_size ? formatBytes(f.file_size) : '—';
  const dateStr   = timeAgo(f.created_at);
  const iconMove  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  const iconHeart = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${f.is_favorite?'#EC4899':'none'}" stroke="#EC4899" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  const iconTrash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  return `
  <div class="list-row" onclick="previewFile('${f.id}')" style="cursor:pointer">
    <div class="list-row-thumb">${fileThumb(f)}</div>
    <div class="list-row-info">
      <p class="list-name">${esc(f.original_name || f.name)}</p>
      <p class="list-meta list-meta-mobile">${sizeStr} · ${dateStr}${folderName ? ' · '+esc(folderName) : ''}</p>
      <div class="list-row-tags">
        ${typeLabel ? `<span class="list-tag list-tag-type">${typeLabel}</span>` : ''}
        ${extBadge  ? `<span class="list-tag list-tag-ext">${extBadge}</span>`  : ''}
      </div>
    </div>
    <div class="list-row-col list-row-date">
      ${dateStr}
      ${folderName ? `<span class="list-row-folder">${esc(folderName)}</span>` : ''}
    </div>
    <div class="list-row-col list-row-size">${sizeStr}</div>
    <div class="list-row-actions" onclick="event.stopPropagation()">
      <button class="btn fc-view-btn list-view-btn" onclick="previewFile('${f.id}')">View</button>
      ${State.isAdmin ? `
      <button class="fc-icon-btn" title="Move" onclick="openMoveModal('${f.id}')">${iconMove}</button>
      <button class="fc-icon-btn fc-fav-btn${f.is_favorite?' active':''}" title="Favorite" onclick="toggleFavorite('${f.id}',${f.is_favorite})">${iconHeart}</button>
      <button class="fc-icon-btn fc-del-btn" title="Delete" onclick="trashItem('${f.id}')">${iconTrash}</button>` : ''}
    </div>
  </div>`;
}

// ── Events ────────────────────────────────────────────────────
function renderEvents() {
  if (State.selectedEvent) return renderEventDetail(State.selectedEvent);
  let list = State.events;
  if (State.search) list = list.filter(e =>
    e.name.toLowerCase().includes(State.search) ||
    (e.description||'').toLowerCase().includes(State.search)
  );
  return `
    <div class="page-header">
      <div><h1 class="page-title">Events ${countBadge(list.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${viewToggleControl()}${State.isAdmin ? `<button class="btn btn-sm" style="background:linear-gradient(135deg,#F97316,#EA580C);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-weight:600;cursor:pointer" onclick="openModalWithTheme('event-modal','orange')">+ New Event</button>` : ''}</div>
    </div>
    ${list.length
      ? (State.viewMode === 'grid'
          ? `<div class="card-grid stagger">${list.map(eventCard).join('')}</div>`
          : `<div class="list-view">${list.map(eventListRow).join('')}</div>`)
      : emptyState('No events yet', State.isAdmin ? 'Create your first event' : 'Events will appear here', calIcon())}`;
}

function renderEventDetail(evId) {
  const ev = State.events.find(e => e.id === evId);
  if (!ev) { State.selectedEvent = null; return renderEvents(); }
  const relFiles   = sortFiles(State.files.filter(f => f.event_id === evId));
  const relFolders = State.folders.filter(f => f.event_id === evId);
  const dateStr    = ev.event_date ? new Date(ev.event_date).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : null;
  return `
    <div class="breadcrumb">
      <a onclick="State.selectedEvent=null;renderView()" style="cursor:pointer">Events</a>
      ${svgWrap('<polyline points="9,18 15,12 9,6"/>',12)}
      <span>${esc(ev.name)}</span>
    </div>

    ${ev.cover_image_url ? `
    <div class="event-hero">
      <img src="${esc(ev.cover_image_url)}" alt="${esc(ev.name)}" />
      <div class="event-hero-overlay">
        <h1 class="event-hero-title">${esc(ev.name)}</h1>
        ${dateStr ? `<p class="event-hero-meta">${dateStr}</p>` : ''}
      </div>
    </div>` : `
    <div class="page-header" style="margin-bottom:4px">
      <div>
        <h1 class="page-title">${esc(ev.name)}</h1>
        ${dateStr ? `<p class="page-subtitle">${dateStr}</p>` : ''}
      </div>
    </div>`}

    <div class="event-toolbar">
      <p class="event-toolbar-meta">${relFiles.length} file${relFiles.length!==1?'s':''}${relFolders.length ? ` · ${relFolders.length} folder${relFolders.length!==1?'s':''}` : ''}</p>
      <div style="display:flex;gap:8px;align-items:center">
        ${sortControl()}${viewToggleControl()}
        ${State.isAdmin ? `<button class="btn btn-secondary btn-sm" style="white-space:nowrap" onclick="editEvent('${ev.id}')">Edit Event</button>` : ''}
      </div>
    </div>

    ${ev.description ? `<p class="event-description">${esc(ev.description)}</p>` : ''}

    ${relFolders.length ? `
      <div class="event-section-header"><span>Folders</span><span class="event-section-count">${relFolders.length}</span></div>
      ${State.viewMode === 'grid'
        ? `<div class="card-grid stagger event-folder-list">${relFolders.map(f=>`
            <div class="project-card" onclick="navigate('folders');setTimeout(()=>enterFolder('${f.id}','${esc(f.name)}'),80)" style="cursor:pointer">
              <div class="project-thumb" style="background:#FFF7ED;display:flex;align-items:center;justify-content:center;color:#F97316">${folderIcon()}</div>
              <div class="project-info"><h4>${esc(f.name)}</h4>${f.description?`<p style="font-size:11px;color:var(--text-secondary)">${esc(f.description)}</p>`:''}</div>
            </div>`).join('')}
           </div>`
        : `<div class="list-view stagger event-folder-list">${relFolders.map(f=>`
            <div class="list-row" onclick="navigate('folders');setTimeout(()=>enterFolder('${f.id}','${esc(f.name)}'),80)" style="cursor:pointer">
              <div class="list-thumb" style="color:#F97316">${folderIcon()}</div>
              <div class="list-info"><p class="list-name">${esc(f.name)}</p><p class="list-meta">${esc(f.description||'')}</p></div>
              <div style="color:var(--text-secondary);padding-right:8px">${svgWrap('<polyline points="9,18 15,12 9,6"/>',16)}</div>
            </div>`).join('')}
           </div>`}` : ''}

    ${relFiles.length ? `
      <div class="event-section-header"><span>Files</span><span class="event-section-count">${relFiles.length}</span></div>
      ${fileGrid(relFiles)}`
    : (!relFolders.length ? emptyState('No files linked yet', State.isAdmin?'Upload files and link this event':'Nothing here yet', calIcon()) : '')}`;
}

function eventCard(ev) {
  const fileCount = State.files.filter(f => f.event_id === ev.id).length;
  return `
  <div class="project-card event-clickable" onclick="openEventDetail('${ev.id}',event)">
    ${ev.cover_image_url
      ? `<div class="project-thumb"><img src="${esc(ev.cover_image_url)}" loading="lazy" /></div>`
      : `<div class="project-thumb" style="background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--green);opacity:.5">${calIcon()}</div>`}
    <div class="project-info">
      <h4>${esc(ev.name)}</h4>
      ${ev.event_date ? `<p class="project-cat">${new Date(ev.event_date).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
      ${ev.description ? `<p style="font-size:11px;color:var(--text-secondary);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(ev.description)}</p>` : ''}
      <p style="font-size:11px;color:var(--green);margin-top:6px;font-weight:600">${fileCount} file${fileCount!==1?'s':''}</p>
    </div>
    ${State.isAdmin ? `
    <div class="file-card-actions">
      <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();editEvent('${ev.id}')">Edit</button>
      <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteEvent('${ev.id}')">Del</button>
    </div>` : ''}
  </div>`;
}

function openEventDetail(evId, e) {
  if (e) e.stopPropagation();
  State.selectedEvent = evId;
  renderView();
}

function eventListRow(ev) {
  const fileCount = State.files.filter(f => f.event_id === ev.id).length;
  return `
  <div class="list-row event-clickable" onclick="openEventDetail('${ev.id}',event)" style="cursor:pointer">
    <div class="list-thumb" style="color:var(--green)">${calIcon()}</div>
    <div class="list-info">
      <p class="list-name">${esc(ev.name)}</p>
      <p class="list-meta">${ev.event_date ? new Date(ev.event_date).toLocaleDateString() : 'No date'} · ${fileCount} file${fileCount!==1?'s':''}</p>
    </div>
    ${State.isAdmin ? `
    <div class="row-actions">
      <button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();editEvent('${ev.id}')">Edit</button>
      <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteEvent('${ev.id}')">Del</button>
    </div>` : ''}
  </div>`;
}

// ── Favorites ─────────────────────────────────────────────────
function renderFavorites() {
  let favF = State.files.filter(f => f.is_favorite);
  if (State.search) {
    const q = State.search;
    favF = favF.filter(f => (f.original_name||'').toLowerCase().includes(q) || (f.name||'').toLowerCase().includes(q));
  }
  return `
    <div class="page-header">
      <div><h1 class="page-title">Favorites ${countBadge(favF.length)}</h1></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${filterControl('fav')}${viewToggleControl()}</div>
    </div>
    ${favF.length ? fileGrid(favF) : emptyState('No favorites yet', 'Heart any file to save it here', heartIcon())}`;
}

// ── Recent ────────────────────────────────────────────────────
function renderRecent() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  let recentF = State.files.filter(f => new Date(f.created_at) > cutoff);
  if (State.search) {
    const q = State.search;
    recentF = recentF.filter(f => (f.original_name||'').toLowerCase().includes(q) || (f.name||'').toLowerCase().includes(q));
  }
  return `
    <div class="page-header">
      <div><h1 class="page-title">Recent ${countBadge(recentF.length)}</h1><p class="page-subtitle">Last 30 days</p></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${filterControl('type')}${viewToggleControl()}</div>
    </div>
    ${recentF.length ? fileGrid(recentF) : emptyState('Nothing recent', 'Files uploaded in the last 30 days appear here', clockIcon())}`;
}

// ── Archive ───────────────────────────────────────────────────
function renderArchive() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  let list = State.files.filter(f => new Date(f.created_at) < cutoff);
  if (State.search) list = list.filter(f =>
    (f.original_name||'').toLowerCase().includes(State.search) ||
    (f.name||'').toLowerCase().includes(State.search)
  );
  return `
    <div class="page-header">
      <div><h1 class="page-title">Archive ${countBadge(list.length)}</h1><p class="page-subtitle">Files older than 90 days</p></div>
      <div style="display:flex;gap:8px;align-items:center">${sortControl()}${viewToggleControl()}</div>
    </div>
    ${list.length ? fileGrid(list) : emptyState('Archive is empty', 'Files older than 90 days appear here', archiveIcon())}`;
}

// ── Trash ─────────────────────────────────────────────────────
function renderTrash() {
  if (!State.isAdmin) return `
    <div class="page-header"><h1 class="page-title">Trash</h1></div>
    ${emptyState('Admin only', 'Log in as admin to manage trash', trashIcon())}`;
  return `
    <div class="page-header">
      <div><h1 class="page-title">Trash</h1><p class="page-subtitle">Items are permanently deleted after 30 days</p></div>
      <button class="btn btn-danger btn-sm" onclick="emptyTrash()">Empty Trash</button>
    </div>
    <div id="trash-content"><div class="empty-state">${spinnerSvg()}<p>Loading…</p></div></div>`;
}

async function loadTrashContent() {
  const [{ data: tf }, { data: tfd }] = await Promise.all([
    db.from('files').select('*').eq('is_deleted', true),
    db.from('folders').select('*').eq('is_deleted', true),
  ]);
  const el = document.getElementById('trash-content');
  if (!el) return;
  const all = [...(tf||[]), ...(tfd||[])];
  if (!all.length) { el.innerHTML = emptyState('Trash is empty', '', trashIcon()); return; }
  el.innerHTML = `<div class="list-view">${all.map(item => `
    <div class="list-row">
      <div class="list-thumb" style="color:var(--green)">${item.file_path ? fileIcon() : folderIcon()}</div>
      <div class="list-info">
        <p class="list-name">${esc(item.name || item.original_name)}</p>
        <p class="list-meta">Deleted ${timeAgo(item.deleted_at || item.updated_at)} · ${item.file_path ? 'File' : 'Folder'}</p>
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-xs" onclick="restoreItem('${item.id}','${item.file_path?'file':'folder'}')">Restore</button>
        <button class="btn btn-danger btn-xs" onclick="permanentlyDelete('${item.id}','${item.file_path?'file':'folder'}')">Delete forever</button>
      </div>
    </div>`).join('')}</div>`;
}

// ── Settings ──────────────────────────────────────────────────
function renderSettings() {

  // ── Non-admin: two-column read-only view ──────────────────────
  if (!State.isAdmin) {
    const iconPerson = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const iconMail   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
    const iconInfo   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const iconCal    = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const memberStr  = 'Oct 2024';

    return `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:48px;height:48px;background:#F0F9FF;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#0EA5E9;flex-shrink:0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
        <div>
          <h1 class="page-title" style="margin:0">Settings</h1>
          <p style="font-size:13px;color:#64748B;margin:2px 0 0">View your account information and application details.</p>
        </div>
      </div>
    </div>

    <div class="settings-layout settings-layout-nonadmin">
      <!-- Left: Account Info + About -->
      <div class="settings-left">
        <div class="ps-guest-card">
          <div class="ps-guest-card-head">
            <div class="ps-section-icon" style="background:#F0F9FF;color:#0EA5E9">${iconPerson}</div>
            <div style="flex:1">
              <h4 style="font-size:14px;font-weight:700;color:#0F172A;margin:0">Account Information</h4>
              <p style="font-size:12px;color:#64748B;margin:2px 0 0">Your account details and current status.</p>
            </div>
            <span class="ps-user-badge">User</span>
          </div>
          <div class="ps-guest-signin-row">
            <div style="width:28px;height:28px;background:#DCFCE7;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="3" style="width:13px;height:13px"><polyline points="20,6 9,17 4,12"/></svg>
            </div>
            <span style="font-size:13px;color:#374151">Viewing as <strong style="color:#0EA5E9">Guest</strong></span>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #F3F4F6">
            <p style="font-size:12px;color:#64748B;margin-bottom:10px">Press <kbd style="background:#F3F4F6;border:1px solid #E5E7EB;border-radius:4px;padding:1px 5px;font-size:11px">Ctrl+Shift+A</kbd> for admin login.</p>
            <button class="btn ps-btn-cyan" style="width:100%;justify-content:center" onclick="openModal('admin-login-modal')">Admin Login</button>
          </div>
        </div>
        <div class="ps-guest-card" style="margin-bottom:20px">
          <div class="ps-guest-card-head">
            <div class="ps-section-icon" style="background:#F0F9FF;color:#0EA5E9">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <div>
              <h4 style="font-size:14px;font-weight:700;color:#0F172A;margin:0">About</h4>
            </div>
          </div>
          <div style="padding-top:4px">
            <p style="font-size:13px;color:#64748B">${APP_NAME} v${APP_VERSION} — Motion Vault</p>
            <p style="font-size:13px;color:#64748B;margin-top:4px;padding-bottom:8px">Powered by Supabase · Pure HTML/CSS/JS</p>
          </div>
        </div>
      </div>

      <!-- Right: Profile read-only -->
      <div class="settings-right">
        <div class="ps-banner" style="justify-content:space-between">
          <div style="display:flex;align-items:center;gap:16px">
            <div class="ps-banner-icon">${iconPerson}</div>
            <div>
              <h2 class="ps-banner-title">Profile</h2>
              <p class="ps-banner-sub">Your account information.</p>
            </div>
          </div>
          <span class="ps-user-badge" style="position:relative;z-index:1">${iconPerson} User</span>
        </div>

        <div class="ps-identity-card">
          <div class="ps-avatar-wrap">
            <img src="assets/myphoto.png" class="ps-avatar-img" alt="Bharat" />
          </div>
          <div class="ps-identity-info">
            <h3 class="ps-identity-name">Bharat Chandra Mohanty</h3>
            <div class="ps-identity-meta">
              <span>${iconMail} bharatmohanty06@gmail.com</span>
              <span>${iconCal} Member since ${memberStr}</span>
            </div>
          </div>
        </div>

        <div class="ps-section-card">
          <div class="ps-section-head">
            <div class="ps-section-icon" style="background:#F0F9FF;color:#0EA5E9">${iconPerson}</div>
            <div>
              <h4>Profile Information</h4>
              <p>Your account information is managed by the administrator.</p>
            </div>
          </div>
          <div class="ps-readonly-row">
            <div class="ps-readonly-icon">${iconPerson}</div>
            <span class="ps-readonly-label">Full Name</span>
            <span class="ps-readonly-value">Bharat Chandra Mohanty</span>
          </div>
          <div class="ps-readonly-row" style="margin-bottom:0">
            <div class="ps-readonly-icon">${iconMail}</div>
            <span class="ps-readonly-label">Email Address</span>
            <span class="ps-readonly-value">bharatmohanty06@gmail.com</span>
          </div>
        </div>

        <div class="ps-note-card" style="background:#F0F9FF;border-color:#BAE6FD">
          <div class="ps-note-icon" style="background:#0EA5E9">${iconInfo}</div>
          <div>
            <strong style="color:#0369A1">Need to make changes?</strong>
            <p style="color:#0EA5E9">To update your name, email address or profile photo, please contact the administrator.</p>
          </div>
        </div>
      </div>
    </div>`; // end non-admin
  }

  // ── Admin left column (no Stats/Categories) ───────────────────
  const leftCol = `
    <div class="card">
      <div class="card-header"><h3 class="card-title">Admin Access</h3></div>
      <div class="card-body">
        <p style="color:#0EA5E9;font-size:13px;margin-bottom:12px">✓ Signed in as <strong>${esc(State.user?.email||'')}</strong></p>
        <button class="btn btn-danger" onclick="adminLogout()">Sign out</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-header"><h3 class="card-title">About</h3></div>
      <div class="card-body" style="padding-bottom:20px">
        <p style="font-size:13px;color:var(--text-secondary)">${APP_NAME} v${APP_VERSION} — Motion Vault</p>
        <p style="font-size:13px;color:var(--text-secondary);margin-top:4px">Powered by Supabase · Pure HTML/CSS/JS</p>
      </div>
    </div>`;

  const profile     = State.profile || {};
  const displayName = profile.full_name || State.user?.user_metadata?.full_name || 'Bharat Chandra Mohanty';
  const email       = State.user?.email || '';
  const avatarSrc   = State.profileAvatarUrl || 'assets/myphoto.png';
  const memberSince = State.user?.created_at
    ? new Date(State.user.created_at).toLocaleDateString('en-US',{month:'short',year:'numeric'})
    : '';

  const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const photoTab = `
    <div id="ps-panel-photo" style="display:${_settingsTab==='photo'?'block':'none'}">
      <div class="ps-section-card">
        <div class="ps-section-head">
          <div class="ps-section-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
          </div>
          <div>
            <h4>Profile Photo</h4>
            <p>Upload a profile photo (JPG, PNG, WebP · max 5 MB)</p>
          </div>
        </div>
        <div class="ps-photo-area">
          <img src="${avatarSrc}" id="ps-photo-preview" class="ps-photo-preview-img" alt="Preview" />
          <div class="ps-photo-actions">
            <label class="btn ps-btn-purple" style="cursor:pointer">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Choose Photo
              <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleAvatarSelect(this)">
            </label>
            ${profile.avatar_path ? `<button class="btn btn-ghost" onclick="removeProfilePhoto()" style="color:#EF4444">Remove Photo</button>` : ''}
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:16px">
          <button class="btn ps-btn-purple" id="ps-photo-save-btn" style="display:none" onclick="saveProfilePhoto()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            Save Photo
          </button>
        </div>
      </div>
      <div class="ps-note-card">
        <div class="ps-note-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div><strong>Note</strong><p>Photo is stored securely. Only you can see or change it.</p></div>
      </div>
    </div>`;

  const passTab = `
    <div id="ps-panel-password" style="display:${_settingsTab==='password'?'block':'none'}">
      <div class="ps-section-card">
        <div class="ps-section-head">
          <div class="ps-section-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <h4>Change Password</h4>
            <p>Secure your account with a strong password.</p>
          </div>
        </div>
        <div class="ps-form-group">
          <label class="ps-label">Current Password <span style="color:#EF4444">*</span></label>
          <div class="ps-input-wrap">
            <span class="ps-input-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            <input type="password" id="ps-cur-pass" class="ps-input" placeholder="Enter current password" autocomplete="current-password" />
            <button type="button" class="ps-eye-btn" onclick="togglePassVis('ps-cur-pass')">${eyeIcon}</button>
          </div>
        </div>
        <div class="ps-form-group">
          <label class="ps-label">New Password <span style="color:#EF4444">*</span></label>
          <div class="ps-input-wrap">
            <span class="ps-input-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            <input type="password" id="ps-new-pass" class="ps-input" placeholder="At least 6 characters" autocomplete="new-password" />
            <button type="button" class="ps-eye-btn" onclick="togglePassVis('ps-new-pass')">${eyeIcon}</button>
          </div>
        </div>
        <div class="ps-form-group">
          <label class="ps-label">Confirm New Password <span style="color:#EF4444">*</span></label>
          <div class="ps-input-wrap">
            <span class="ps-input-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            <input type="password" id="ps-conf-pass" class="ps-input" placeholder="Repeat new password" autocomplete="new-password" />
            <button type="button" class="ps-eye-btn" onclick="togglePassVis('ps-conf-pass')">${eyeIcon}</button>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn ps-btn-purple" id="ps-pass-btn" onclick="changePassword()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Update Password
          </button>
        </div>
      </div>
    </div>`;

  const infoTab = `
    <div id="ps-panel-personal" style="display:${_settingsTab==='personal'?'block':'none'}">
      <div class="ps-section-card">
        <div class="ps-section-head">
          <div class="ps-section-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <h4>Personal Information</h4>
            <p>Update your name and email address. Changes will be saved to your account.</p>
          </div>
        </div>
        <div class="ps-form-group">
          <label class="ps-label">Full Name <span style="color:#EF4444">*</span></label>
          <div class="ps-input-wrap">
            <span class="ps-input-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <input type="text" id="ps-name" class="ps-input" value="${esc(displayName)}" placeholder="Your full name" autocomplete="name" />
          </div>
        </div>
        <div class="ps-form-group">
          <label class="ps-label">Email Address <span style="color:#EF4444">*</span></label>
          <div class="ps-input-wrap">
            <span class="ps-input-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></span>
            <input type="email" id="ps-email" class="ps-input" value="${esc(email)}" placeholder="your@email.com" autocomplete="email" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn ps-btn-purple" id="ps-info-btn" onclick="savePersonalInfo()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            Save Changes
          </button>
        </div>
      </div>
      <div class="ps-note-card">
        <div class="ps-note-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div><strong>Note</strong><p>Changes are updated in your Supabase account and reflected across the application, including the header profile.</p></div>
      </div>
    </div>`;

  return `
    <div class="page-header"><h1 class="page-title">Settings</h1></div>
    <div class="settings-layout">
      <div class="settings-left">${leftCol}</div>

      <div class="settings-right">
        <!-- Header banner -->
        <div class="ps-banner">
          <div class="ps-banner-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div>
            <h2 class="ps-banner-title">Profile Settings</h2>
            <p class="ps-banner-sub">Update your personal information, profile photo and security settings.</p>
          </div>
        </div>

        <!-- Profile identity card -->
        <div class="ps-identity-card">
          <div class="ps-avatar-wrap">
            <img src="${avatarSrc}" id="ps-avatar-img" class="ps-avatar-img" alt="${esc(displayName)}" />
            <button class="ps-camera-btn" onclick="switchSettingsTab('photo')" title="Change photo">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </button>
          </div>
          <div class="ps-identity-info">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <h3 id="ps-profile-name" class="ps-identity-name">${esc(displayName)}</h3>
              <span class="ps-admin-badge">Admin</span>
            </div>
            <div class="ps-identity-meta">
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                ${esc(email)}
              </span>
              ${memberSince ? `<span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Member since ${memberSince}
              </span>` : ''}
            </div>
          </div>
        </div>

        <!-- Shared message bar -->
        <div id="ps-msg" class="ps-msg" style="display:none"></div>

        <!-- Tabs -->
        <div class="ps-tabs">
          <button id="ps-tab-personal" class="ps-tab${_settingsTab==='personal'?' active':''}" onclick="switchSettingsTab('personal')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Personal Information
          </button>
          <button id="ps-tab-password" class="ps-tab${_settingsTab==='password'?' active':''}" onclick="switchSettingsTab('password')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Change Password
          </button>
          <button id="ps-tab-photo" class="ps-tab${_settingsTab==='photo'?' active':''}" onclick="switchSettingsTab('photo')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Profile Photo
          </button>
        </div>

        <!-- Tab panels -->
        ${infoTab}
        ${passTab}
        ${photoTab}
      </div>
    </div>`;
}

// ── CRUD: Files ───────────────────────────────────────────────
async function toggleFavorite(id, current) {
  await db.from('files').update({ is_favorite: !current }).eq('id', id);
  await loadFiles(); renderView();
  toast(current ? 'Removed from favorites' : 'Added to favorites', 'success');
}

async function trashItem(id) {
  await db.from('files').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
  await loadFiles(); renderView(); toast('Moved to trash', 'info');
}

async function trashFolder(id) {
  await db.from('folders').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
  const idx = State.folderStack.findIndex(f => f.id === id);
  if (idx >= 0) State.folderStack = State.folderStack.slice(0, idx);
  await loadFolders(); renderView(); toast('Folder deleted', 'info');
}

async function restoreItem(id, type) {
  const table = type === 'folder' ? 'folders' : 'files';
  await db.from(table).update({ is_deleted: false, deleted_at: null }).eq('id', id);
  if (type === 'folder') await loadFolders(); else await loadFiles();
  loadTrashContent(); toast('Restored', 'success');
}

async function permanentlyDelete(id, type) {
  const table = type === 'folder' ? 'folders' : 'files';
  await db.from(table).delete().eq('id', id);
  if (type === 'folder') await loadFolders(); else await loadFiles();
  loadTrashContent(); toast('Permanently deleted', 'info');
}

async function emptyTrash() {
  if (!confirm('Permanently delete ALL items in trash?')) return;
  await db.from('files').delete().eq('is_deleted', true);
  await db.from('folders').delete().eq('is_deleted', true);
  await loadFiles(); await loadFolders();
  loadTrashContent(); toast('Trash emptied', 'info');
}

// ── CRUD: Folders ─────────────────────────────────────────────
async function saveFolder() {
  const id       = document.getElementById('folder-edit-id').value;
  const name     = document.getElementById('f-name').value.trim();
  if (!name) { toast('Folder name is required', 'error'); return; }
  const parentId   = document.getElementById('f-parent').value || null;
  const parentPath = parentId ? State.folders.find(f => f.id === parentId)?.path || '' : '';
  const data = {
    name,
    description: document.getElementById('f-desc').value.trim() || null,
    parent_id:   parentId,
    path:        `${parentPath}/${name}`,
    event_id:    document.getElementById('f-event')?.value || null,
  };
  let err;
  if (id) ({ error: err } = await db.from('folders').update(data).eq('id', id));
  else    ({ error: err } = await db.from('folders').insert(data));
  if (err) { toast(err.message, 'error'); return; }
  toast(id ? 'Folder updated' : 'Folder created', 'success');
  closeModal('folder-modal');
  await loadFolders(); populateFolderSelects(); renderView();
}

function editFolder(id) {
  const f = State.folders.find(x => x.id === id);
  if (!f) return;
  openModalWithTheme('folder-modal','blue');
  document.getElementById('folder-modal-title').textContent = 'Edit Folder';
  document.getElementById('folder-save-label').textContent  = 'Save Changes';
  document.getElementById('folder-edit-id').value = id;
  document.getElementById('f-name').value         = f.name || '';
  document.getElementById('f-desc').value         = f.description || '';
  setTimeout(() => {
    const p = document.getElementById('f-parent'); if (p) p.value = f.parent_id || '';
    const e = document.getElementById('f-event');  if (e) e.value = f.event_id  || '';
  }, 10);
}

// ── CRUD: Events ──────────────────────────────────────────────
async function saveEvent() {
  const id   = document.getElementById('event-edit-id').value;
  const name = document.getElementById('ev-name').value.trim();
  if (!name) { toast('Event name is required', 'error'); return; }
  const dateVal = document.getElementById('ev-date').value;
  const data = {
    name,
    description:     document.getElementById('ev-desc').value.trim() || null,
    event_date:      dateVal || null,
    event_year:      dateVal ? new Date(dateVal).getFullYear() : null,
    event_month:     dateVal ? new Date(dateVal).getMonth() + 1 : null,
    cover_image_url: document.getElementById('ev-cover').value.trim() || null,
  };
  let err;
  if (id) ({ error: err } = await db.from('events').update(data).eq('id', id));
  else    ({ error: err } = await db.from('events').insert(data));
  if (err) { toast(err.message, 'error'); return; }
  toast(id ? 'Event updated' : 'Event created', 'success');
  closeModal('event-modal');
  await loadEvents(); renderView();
}

function editEvent(id) {
  const ev = State.events.find(x => x.id === id);
  if (!ev) return;
  openModalWithTheme('event-modal','orange');
  document.getElementById('event-modal-title').textContent = 'Edit Event';
  document.getElementById('event-save-label').textContent  = 'Save Changes';
  document.getElementById('event-edit-id').value = id;
  document.getElementById('ev-name').value  = ev.name || '';
  document.getElementById('ev-desc').value  = ev.description || '';
  document.getElementById('ev-date').value  = ev.event_date || '';
  document.getElementById('ev-cover').value = ev.cover_image_url || '';
  const prev = document.getElementById('ev-cover-preview');
  const stat = document.getElementById('ev-cover-status');
  if (ev.cover_image_url) {
    if (prev) { prev.src = ev.cover_image_url; prev.style.display = 'block'; }
    if (stat) stat.textContent = 'Image set ✓';
  }
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await db.from('events').update({ is_deleted: true }).eq('id', id);
  await loadEvents(); renderView(); toast('Event deleted', 'info');
}

// ── Move File ─────────────────────────────────────────────────
function injectMoveModal() {
  if (document.getElementById('move-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="move-modal">
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon">${folderIcon()}</div>
          <div><h3>Move File</h3><p>Select a destination folder</p></div>
        </div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal('move-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="move-file-id" />
        <p id="move-file-name" style="font-size:13px;font-weight:600;color:var(--green-dark);margin-bottom:14px;padding:10px 12px;background:var(--bg);border-radius:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></p>
        <div class="field-wrap field-wrap-select animated-field">
          <select id="move-folder-select"></select>
          <label for="move-folder-select">Destination Folder</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('move-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="confirmMoveFile()">
          ${folderIcon()} Move Here
        </button>
      </div>
    </div>
  </div>`);
}

function openMoveModal(fileId) {
  injectMoveModal();
  const f = State.files.find(x => x.id === fileId);
  document.getElementById('move-file-id').value = fileId;
  document.getElementById('move-file-name').textContent = f?.original_name || f?.name || '';
  const sel = document.getElementById('move-folder-select');
  if (sel) {
    sel.innerHTML = `<option value="">Root (no folder)</option>` +
      State.folders.map(fd => `<option value="${fd.id}" ${f?.folder_id===fd.id?'selected':''}>${esc(fd.path || fd.name)}</option>`).join('');
  }
  openModalWithTheme('move-modal', viewTheme());
}

async function confirmMoveFile() {
  const fileId   = document.getElementById('move-file-id').value;
  const folderId = document.getElementById('move-folder-select').value || null;
  if (!fileId) return;
  const { error } = await db.from('files').update({ folder_id: folderId }).eq('id', fileId);
  if (error) { toast(error.message, 'error'); return; }
  const dest = folderId ? State.folders.find(f => f.id === folderId)?.name : 'Root';
  toast(`Moved to ${dest}`, 'success');
  closeModal('move-modal');
  await loadFiles(); renderView();
}

// ── Upload ────────────────────────────────────────────────────
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  handleFileSelect(e.dataTransfer.files);
}
function handleFileSelect(files) { Array.from(files).forEach(queueUpload); }

function queueUpload(file) {
  const id = 'u-' + Date.now() + Math.random().toString(36).slice(2);
  document.getElementById('upload-list').insertAdjacentHTML('beforeend', `
    <div class="upload-item" id="${id}">
      <div class="upload-item-info">
        <p class="upload-name">${esc(file.name)}</p>
        <p class="upload-size">${formatBytes(file.size)}</p>
      </div>
      <div class="upload-progress-wrap"><div class="upload-progress-bar" id="${id}-bar" style="width:0%"></div></div>
      <span class="upload-status" id="${id}-status">Uploading…</span>
    </div>`);
  uploadFile(file, id);
}

async function uploadFile(file, itemId) {
  const ext   = file.name.split('.').pop().toLowerCase();
  const ftype = guessFileType(file.type, ext);
  const path  = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const setStatus = (msg, cls='') => {
    const el = document.getElementById(`${itemId}-status`);
    if (el) { el.textContent = msg; el.className = `upload-status${cls?' '+cls:''}`; }
  };
  const setBar = pct => { const el = document.getElementById(`${itemId}-bar`); if (el) el.style.width = pct+'%'; };

  const { error } = await db.storage.from('media').upload(path, file, { upsert: false });
  if (error) { setStatus('Failed', 'error'); toast('Upload failed: ' + error.message, 'error'); return; }
  setBar(100); setStatus('Saving…');
  const { data: { publicUrl: fileUrl } } = db.storage.from('media').getPublicUrl(path);
  const folderId = document.getElementById('upload-folder')?.value || null;
  const eventId  = document.getElementById('upload-event')?.value  || null;
  const { error: dbErr } = await db.from('files').insert({
    name: file.name, original_name: file.name,
    file_path: path, file_url: fileUrl,
    file_size: file.size, mime_type: file.type,
    file_type: ftype, extension: ext,
    folder_id: folderId,
    event_id:  eventId,
  });
  if (dbErr) { setStatus('DB error', 'error'); toast(dbErr.message, 'error'); return; }
  await loadFiles(); setStatus('Done ✓', 'success');
}

// ── URL tab ───────────────────────────────────────────────────
function detectUrlType(url) {
  if (/youtube\.com\/watch|youtu\.be\//.test(url))      return 'youtube';
  if (/vimeo\.com\/\d+/.test(url))                      return 'vimeo';
  if (/canva\.com\/design\//.test(url))                 return 'canva';   // all canva design URLs
  if (/\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url)) return 'image';
  return 'embed';
}

function getEmbedUrl(url, type) {
  if (type === 'youtube') {
    const id = url.match(/(?:v=|youtu\.be\/)([^&?\s]+)/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : url;
  }
  if (type === 'vimeo') {
    const id = url.match(/vimeo\.com\/(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : url;
  }
  if (type === 'canva') {
    // Strip query string, replace /edit with /watch, then add ?embed
    const base = url.split('?')[0].replace(/\/edit$/, '/watch');
    return base + '?embed';
  }
  return url;
}

function switchUploadTab(tab) {
  document.getElementById('upload-tab-file').style.display = tab === 'file' ? '' : 'none';
  document.getElementById('upload-tab-url').style.display  = tab === 'url'  ? '' : 'none';
  document.getElementById('url-add-btn').style.display     = tab === 'url'  ? '' : 'none';
  document.getElementById('tab-btn-file').classList.toggle('active', tab === 'file');
  document.getElementById('tab-btn-url').classList.toggle('active',  tab === 'url');
}

function previewUrlInput(url) {
  const wrap  = document.getElementById('url-preview-wrap');
  const tWrap = document.getElementById('url-title-wrap');
  const btn   = document.getElementById('url-add-btn');
  if (!url || !url.startsWith('http')) {
    wrap.style.display = 'none'; tWrap.style.display = 'none'; btn.style.display = 'none';
    return;
  }
  const type     = detectUrlType(url);
  const embedUrl = getEmbedUrl(url, type);
  let html;
  if (type === 'video') {
    html = `<video src="${esc(url)}" controls style="width:100%;max-height:200px;display:block"></video>`;
  } else if (type === 'image') {
    html = `<img src="${esc(url)}" style="width:100%;max-height:200px;object-fit:contain;display:block" />`;
  } else if (type === 'canva') {
    html = `<div style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:#7D2AE820;border-radius:12px">
      <svg viewBox="0 0 40 40" style="width:36px;height:36px;flex-shrink:0" fill="none"><circle cx="20" cy="20" r="20" fill="#7D2AE8"/><text x="20" y="27" text-anchor="middle" font-size="20" font-family="sans-serif" fill="#fff" font-weight="bold">C</text></svg>
      <div>
        <p style="font-size:13px;font-weight:600;color:var(--green-dark)">Canva Design detected ✓</p>
        <p style="font-size:11px;color:var(--text-secondary)">Will open in Canva when previewed</p>
      </div>
    </div>`;
  } else if (type === 'youtube' || type === 'vimeo') {
    html = `<iframe src="${esc(embedUrl)}" style="width:100%;height:200px;border:none;display:block;border-radius:10px" allowfullscreen allow="autoplay"></iframe>`;
  } else {
    html = `<div style="padding:14px 18px;background:var(--bg);border-radius:10px;font-size:12px;color:var(--text-secondary)">Link saved — preview opens on click</div>`;
  }
  wrap.innerHTML = html;
  wrap.style.display = '';
  tWrap.style.display = '';
  btn.style.display = '';
}

async function saveFileByUrl() {
  const url   = document.getElementById('url-input').value.trim();
  const title = document.getElementById('url-title').value.trim();
  if (!url || !url.startsWith('http')) { toast('Enter a valid URL', 'error'); return; }
  const type    = detectUrlType(url);
  const ftype   = (type === 'image') ? 'image' : 'video';
  const ext     = { youtube:'youtube', vimeo:'vimeo', canva:'canva', embed:'link', video: url.split('.').pop().split('?')[0].toLowerCase(), image: url.split('.').pop().split('?')[0].toLowerCase() }[type] || 'link';
  const name    = title || (type === 'youtube' ? 'YouTube Video' : type === 'vimeo' ? 'Vimeo Video' : type === 'canva' ? 'Canva Design' : url.split('/').pop().split('?')[0] || 'Untitled');
  const folderId = document.getElementById('upload-folder')?.value || null;
  const eventId  = document.getElementById('upload-event')?.value  || null;
  const { error } = await db.from('files').insert({
    name, original_name: name,
    file_path: `url:${type}:${url}`,
    file_url: url,
    file_size: 0, mime_type: 'text/html',
    file_type: ftype, extension: ext,
    folder_id: folderId, event_id: eventId,
  });
  if (error) { toast(error.message, 'error'); return; }
  toast('Added to vault ✓', 'success');
  closeModal('upload-modal');
  await loadFiles(); renderView();
}

function guessFileType(mime, ext) {
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm','mxf','m4v'].includes(ext)) return 'video';
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','tif','tiff','heic'].includes(ext)) return 'image';
  if (['pdf'].includes(ext)) return 'document';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'archive';
  if (['psd','ai','sketch','fig','xd','aep','prproj','mogrt','c4d'].includes(ext)) return 'design';
  return 'other';
}

// ── Selects ───────────────────────────────────────────────────
function populateFolderSelects() {
  const folderOpts = `<option value="">No folder / Root</option>` +
    State.folders.map(f => `<option value="${f.id}">${esc(f.path || f.name)}</option>`).join('');
  ['f-parent','upload-folder'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = folderOpts;
  });
  const eventOpts = `<option value="">No event</option>` +
    State.events.map(e => `<option value="${e.id}">${esc(e.name)}${e.event_date ? ' ('+new Date(e.event_date).getFullYear()+')' : ''}</option>`).join('');
  ['upload-event','f-event'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = eventOpts;
  });
}

// ── Folder Modal (sexy floating label design) ─────────────────
function injectFolderModal() {
  if (document.getElementById('folder-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="folder-modal">
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon">
            ${folderIcon()}
          </div>
          <div>
            <h3 id="folder-modal-title">New Folder</h3>
            <p id="folder-modal-subtitle">Organise your work</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal('folder-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="folder-edit-id" />
        <div class="field-wrap animated-field">
          <input type="text" id="f-name" placeholder=" " autocomplete="off"
            onkeydown="if(event.key==='Enter') saveFolder()" />
          <label for="f-name">Folder Name <span class="req">*</span></label>
        </div>
        <div class="field-wrap animated-field">
          <input type="text" id="f-desc" placeholder=" " />
          <label for="f-desc">Description (optional)</label>
        </div>
        <div class="field-wrap field-wrap-select animated-field">
          <select id="f-parent"><option value="">Root (top level)</option></select>
          <label for="f-parent">Parent Folder</label>
        </div>
        <div class="field-wrap field-wrap-select animated-field">
          <select id="f-event"><option value="">No event</option></select>
          <label for="f-event">Link to Event (optional)</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('folder-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="saveFolder()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          <span id="folder-save-label">Create Folder</span>
        </button>
      </div>
    </div>
  </div>`);
}

// ── Event Modal (floating label design) ──────────────────────
function injectEventModal() {
  if (document.getElementById('event-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="event-modal">
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon">${calIcon()}</div>
          <div><h3 id="event-modal-title">New Event</h3><p>Add an event to your timeline</p></div>
        </div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal('event-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="event-edit-id" />
        <div class="field-wrap animated-field">
          <input type="text" id="ev-name" placeholder=" " autocomplete="off" />
          <label for="ev-name">Event Name <span class="req">*</span></label>
        </div>
        <div class="field-wrap animated-field">
          <textarea id="ev-desc" placeholder=" "></textarea>
          <label for="ev-desc">Description</label>
        </div>
        <div class="field-wrap animated-field">
          <input type="date" id="ev-date" placeholder=" " />
          <label for="ev-date">Event Date</label>
        </div>
        <div class="animated-field" style="margin-top:6px">
          <input type="hidden" id="ev-cover" />
          <input type="file" id="ev-cover-file" accept="image/*" style="display:none" onchange="uploadEventCover(this)" />
          <div style="display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--bg);border-radius:12px;border:1px solid var(--border)">
            <button type="button" class="btn btn-secondary btn-sm" style="flex-shrink:0" onclick="document.getElementById('ev-cover-file').click()">
              ${svgWrap('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>',14)}
              Upload Banner
            </button>
            <span id="ev-cover-status" style="font-size:11px;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">No image selected</span>
          </div>
          <img id="ev-cover-preview" src="" alt="Cover" style="display:none;width:100%;max-height:130px;object-fit:cover;border-radius:10px;margin-top:8px" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('event-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="saveEvent()">
          <span id="event-save-label">Create Event</span>
        </button>
      </div>
    </div>
  </div>`);
}

async function uploadEventCover(input) {
  const file = input.files[0];
  if (!file) return;
  const stat = document.getElementById('ev-cover-status');
  const prev = document.getElementById('ev-cover-preview');
  if (stat) stat.textContent = 'Uploading…';
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `events/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await db.storage.from('media').upload(path, file, { upsert: false });
  if (error) {
    if (stat) stat.textContent = 'Upload failed';
    toast('Cover upload failed: ' + error.message, 'error');
    return;
  }
  const { data: { publicUrl } } = db.storage.from('media').getPublicUrl(path);
  document.getElementById('ev-cover').value = publicUrl;
  if (stat) stat.textContent = file.name;
  if (prev) { prev.src = publicUrl; prev.style.display = 'block'; }
  toast('Cover uploaded ✓', 'success');
}

// ── Modals ────────────────────────────────────────────────────
// Theme colours for modals: 'purple' | 'blue' | 'green' | 'orange'
const MODAL_THEMES = {
  'upload-modal': 'purple',
  'folder-modal': 'blue',
  'event-modal':  'orange',
};
function viewTheme() {
  const map = {
    files: 'teal', videos: 'purple', images: 'pink',
    recent: 'blue', favorites: 'pink', events: 'orange',
    folders: 'blue', archive: 'green', trash: 'green',
  };
  return map[State.view] || 'green';
}
function openModalWithTheme(id, theme) {
  const t = theme || MODAL_THEMES[id] || null;
  const el = document.getElementById(id);
  if (el && t) {
    el.classList.remove('modal-theme-purple','modal-theme-blue','modal-theme-green','modal-theme-orange','modal-theme-teal','modal-theme-pink');
    el.classList.add('modal-theme-' + t);
  }
  openModal(id);
}

function toggleAvatarDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('avatar-dropdown');
  if (!dd) return;
  const open = dd.classList.toggle('open');
  if (open) {
    setTimeout(() => document.addEventListener('click', () => dd.classList.remove('open'), { once: true }), 0);
  }
}

function openModal(id) {
  const modal = document.getElementById(id); if (!modal) return;
  modal.classList.add('open'); document.body.style.overflow = 'hidden';
  if (id === 'folder-modal') {
    document.getElementById('folder-modal-title').textContent = 'New Folder';
    document.getElementById('folder-save-label').textContent  = 'Create Folder';
    document.getElementById('folder-edit-id').value = '';
    document.getElementById('f-name').value = '';
    document.getElementById('f-desc').value = '';
    populateFolderSelects();
    setTimeout(() => {
      const fe = document.getElementById('f-event'); if (fe) fe.value = '';
    }, 10);
    // Re-trigger stagger animations
    modal.querySelectorAll('.animated-field').forEach(el => {
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    });
    setTimeout(() => { const n = document.getElementById('f-name'); if (n) n.focus(); }, 120);
  }
  if (id === 'upload-modal') {
    document.getElementById('upload-list').innerHTML = '';
    populateFolderSelects();
    if (State.folderStack.length > 0) {
      const el = document.getElementById('upload-folder');
      if (el) el.value = State.folderStack[State.folderStack.length - 1].id;
    }
    // reset URL tab
    switchUploadTab('file');
    const ui = document.getElementById('url-input'); if (ui) ui.value = '';
    const ut = document.getElementById('url-title'); if (ut) ut.value = '';
    const uw = document.getElementById('url-preview-wrap'); if (uw) { uw.innerHTML = ''; uw.style.display = 'none'; }
    const tw = document.getElementById('url-title-wrap'); if (tw) tw.style.display = 'none';
  }
  if (id === 'event-modal') {
    document.getElementById('event-modal-title').textContent = 'New Event';
    document.getElementById('event-save-label').textContent  = 'Create Event';
    document.getElementById('event-edit-id').value = '';
    ['ev-name','ev-desc','ev-date','ev-cover'].forEach(f => { const el = document.getElementById(f); if(el) el.value=''; });
    const prev = document.getElementById('ev-cover-preview');
    const stat = document.getElementById('ev-cover-status');
    const fi   = document.getElementById('ev-cover-file');
    if (prev) { prev.src = ''; prev.style.display = 'none'; }
    if (stat) stat.textContent = 'No image selected';
    if (fi)   fi.value = '';
    modal.querySelectorAll('.animated-field').forEach(el => {
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    });
  }
}
function closeModal(id) {
  const modal = document.getElementById(id); if (!modal) return;
  modal.classList.remove('open'); document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

function confirmAction(title, msg, btnLabel, fn) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = msg;
  document.getElementById('confirm-action-btn').textContent = btnLabel;
  State.pendingConfirm = fn; openModal('confirm-modal');
}
function executeConfirm() {
  closeModal('confirm-modal');
  if (State.pendingConfirm) { State.pendingConfirm(); State.pendingConfirm = null; }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const id = 'toast-' + Date.now();
  const icons = { success:'✓', error:'✕', info:'i', warning:'!' };
  document.getElementById('toast-container').insertAdjacentHTML('beforeend', `
    <div class="toast toast-${type}" id="${id}">
      <span class="toast-icon">${icons[type]||'i'}</span>
      <span>${esc(msg)}</span>
    </div>`);
  setTimeout(() => { const el = document.getElementById(id); if (el) el.remove(); }, 3200);
}

// ── Mobile nav ─────────────────────────────────────────────────
function openMobileMenu() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mobile-overlay').classList.add('open');
}
function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-overlay').classList.remove('open');
}

// ── Utilities ─────────────────────────────────────────────────
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatBytes(b) {
  if (!b) return '0 B';
  const gb = b/1073741824, mb = b/1048576, kb = b/1024;
  if (gb >= 1) return gb.toFixed(1)+' GB';
  if (mb >= 1) return mb.toFixed(1)+' MB';
  if (kb >= 1) return kb.toFixed(0)+' KB';
  return b+' B';
}
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso))/1000);
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}

// ── Preview modal ─────────────────────────────────────────────
function injectPreviewModal() {
  if (document.getElementById('preview-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="preview-modal">
    <div class="modal preview-modal-inner" style="max-width:860px;width:95vw">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon">${videoIcon()}</div>
          <div>
            <h3 id="preview-title" style="max-width:540px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Preview</h3>
            <p id="preview-meta"></p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button id="preview-edit-btn" class="btn btn-secondary btn-sm" style="display:none" onclick="openEditFileModal(_previewFileId)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button class="btn btn-ghost btn-icon" onclick="closePreview()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div id="preview-content" style="background:#111;border-radius:0 0 var(--radius-lg) var(--radius-lg);min-height:300px;display:flex;align-items:center;justify-content:center;overflow:hidden"></div>
    </div>
  </div>`);
}

let _previewFileId = null;

function previewFile(fileId) {
  const f = State.files.find(x => x.id === fileId);
  if (!f) return;
  _previewFileId = fileId;
  injectPreviewModal();
  document.getElementById('preview-title').textContent = f.original_name || f.name;
  document.getElementById('preview-meta').textContent  =
    (f.file_size ? formatBytes(f.file_size) + ' · ' : '') +
    (f.extension || f.file_type || '').toUpperCase();

  const url    = f.file_url || '';
  const isUrl  = f.file_path?.startsWith('url:');
  const type   = isUrl ? detectUrlType(url) : f.file_type;
  const embed  = isUrl ? getEmbedUrl(url, type) : url;
  let content;

  if (type === 'image') {
    content = `<img src="${esc(url)}" style="max-width:100%;max-height:75vh;object-fit:contain;border-radius:0 0 var(--radius-lg) var(--radius-lg)" />`;
  } else if (type === 'video') {
    content = `<video src="${esc(url)}" controls autoplay style="width:100%;max-height:75vh;display:block;border-radius:0 0 var(--radius-lg) var(--radius-lg)"></video>`;
  } else if (type === 'canva') {
    content = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:60px 32px;color:#fff;min-height:320px">
      <svg viewBox="0 0 80 80" style="width:64px;height:64px" fill="none"><circle cx="40" cy="40" r="40" fill="#7D2AE8"/><text x="40" y="52" text-anchor="middle" font-size="36" font-family="sans-serif" fill="#fff" font-weight="bold">C</text></svg>
      <div style="text-align:center">
        <p style="font-size:18px;font-weight:700;margin-bottom:8px">${esc(f.original_name || f.name)}</p>
        <p style="font-size:13px;opacity:.6;margin-bottom:24px">Canva designs open natively in Canva for the best experience</p>
        <a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;background:#7D2AE8;color:#fff;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open in Canva
        </a>
      </div>
    </div>`;
  } else if (type === 'youtube' || type === 'vimeo') {
    content = `<iframe src="${esc(embed)}" style="width:100%;height:480px;border:none;border-radius:0 0 var(--radius-lg) var(--radius-lg)" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
  } else if (url) {
    content = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:60px 32px;color:#aaa;min-height:320px">
      ${fileTypeIcon(f.file_type)}
      <p style="font-size:13px">No inline preview</p>
      <a href="${esc(url)}" target="_blank" rel="noopener" class="btn btn-primary">Open file</a>
    </div>`;
  } else {
    content = `<div style="color:#aaa;padding:48px;text-align:center">${fileTypeIcon(f.file_type)}<p style="margin-top:12px;font-size:13px">No preview available</p></div>`;
  }

  document.getElementById('preview-content').innerHTML = content;
  const editBtn = document.getElementById('preview-edit-btn');
  if (editBtn) editBtn.style.display = State.isAdmin ? '' : 'none';
  openModal('preview-modal');
}

function closePreview() {
  const c = document.getElementById('preview-content');
  if (c) c.innerHTML = ''; // stops video/audio playback
  closeModal('preview-modal');
}

const urlTypeIcon = ext => ({
  youtube: svgWrap('<path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02"/>',32),
  vimeo:   svgWrap('<path d="M21.7 8.3c-.1 2.3-1.7 5.4-4.8 9.3C13.7 22 11 24 8.8 24c-1.4 0-2.5-1.3-3.5-3.8L3.6 14c-.7-2.5-1.4-3.8-2.2-3.8-.2 0-.8.4-1.9 1.1L0 10.2c1.2-1 2.3-2.1 3.4-3 1.5-1.3 2.6-2 3.4-2 1.8-.2 2.9 1 3.3 3.6l1.4 9.2c.4 2.6 1 3.9 1.7 3.9.5 0 1.2-.8 2.2-2.3 1-1.5 1.5-2.7 1.6-3.5.1-1.3-.4-2-1.6-2-.5 0-1.1.1-1.7.4 1.1-3.7 3.3-5.5 6.4-5.3z"/>',32),
  canva:   svgWrap('<circle cx="12" cy="12" r="10"/><path d="M8 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4"/>',32),
}[ext] || videoIcon());

// ── Edit file modal ───────────────────────────────────────────
function injectEditFileModal() {
  if (document.getElementById('edit-file-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="edit-file-modal">
    <div class="modal" style="max-width:460px">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon">${fileIcon()}</div>
          <div><h3>Edit File Details</h3><p>Update name, folder or event</p></div>
        </div>
        <button class="btn btn-ghost btn-icon" onclick="closeModal('edit-file-modal')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="edit-file-id" />
        <div class="field-wrap animated-field">
          <input type="text" id="edit-file-name" placeholder=" " />
          <label for="edit-file-name">Title / Name <span class="req">*</span></label>
        </div>
        <div class="field-wrap animated-field" id="edit-file-url-wrap" style="display:none">
          <input type="url" id="edit-file-url" placeholder=" " />
          <label for="edit-file-url">URL</label>
        </div>
        <div class="field-wrap field-wrap-select animated-field">
          <select id="edit-file-folder"></select>
          <label for="edit-file-folder">Folder</label>
        </div>
        <div class="field-wrap field-wrap-select animated-field">
          <select id="edit-file-event"></select>
          <label for="edit-file-event">Event</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('edit-file-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="saveFileEdit()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save Changes
        </button>
      </div>
    </div>
  </div>`);
}

function openEditFileModal(fileId) {
  injectEditFileModal();
  const f = State.files.find(x => x.id === fileId);
  if (!f) return;
  document.getElementById('edit-file-id').value   = fileId;
  document.getElementById('edit-file-name').value = f.original_name || f.name || '';
  const isUrl   = f.file_path?.startsWith('url:');
  const urlWrap = document.getElementById('edit-file-url-wrap');
  if (urlWrap) {
    urlWrap.style.display = isUrl ? '' : 'none';
    if (isUrl) document.getElementById('edit-file-url').value = f.file_url || '';
  }
  const folderOpts = `<option value="">No folder / Root</option>` +
    State.folders.map(fd => `<option value="${fd.id}" ${f.folder_id===fd.id?'selected':''}>${esc(fd.path||fd.name)}</option>`).join('');
  document.getElementById('edit-file-folder').innerHTML = folderOpts;
  const eventOpts = `<option value="">No event</option>` +
    State.events.map(e => `<option value="${e.id}" ${f.event_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('');
  document.getElementById('edit-file-event').innerHTML = eventOpts;
  closePreview();
  openModalWithTheme('edit-file-modal', viewTheme());
}

async function saveFileEdit() {
  const id   = document.getElementById('edit-file-id').value;
  const name = document.getElementById('edit-file-name').value.trim();
  if (!name) { toast('Name is required', 'error'); return; }
  const f        = State.files.find(x => x.id === id);
  const isUrl    = f?.file_path?.startsWith('url:');
  const newUrl   = isUrl ? document.getElementById('edit-file-url').value.trim() : null;
  const folderId = document.getElementById('edit-file-folder').value || null;
  const eventId  = document.getElementById('edit-file-event').value  || null;
  const update   = { name, original_name: name, folder_id: folderId, event_id: eventId };
  if (isUrl && newUrl) {
    const type       = detectUrlType(newUrl);
    update.file_url  = newUrl;
    update.file_path = `url:${type}:${newUrl}`;
    update.extension = { youtube:'youtube', vimeo:'vimeo', canva:'canva' }[type] || newUrl.split('.').pop().split('?')[0];
  }
  const { error } = await db.from('files').update(update).eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Saved ✓', 'success');
  closeModal('edit-file-modal');
  await loadFiles(); renderView();
}

// ── SVG icons ─────────────────────────────────────────────────
const svgWrap    = (path, size=18) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:${size}px;height:${size}px">${path}</svg>`;
const countBadge = (n) => `<span class="event-section-count">${n}</span>`;
const fileIcon   = () => svgWrap('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><polyline points="14,2 14,8 20,8"/>');
const folderIcon = () => svgWrap('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
const videoIcon  = () => svgWrap('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>');
const imageIcon  = () => svgWrap('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>');
const calIcon    = () => svgWrap('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
const heartIcon  = () => svgWrap('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>');
const clockIcon  = () => svgWrap('<circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>');
const archiveIcon= () => svgWrap('<polyline points="21,8 21,21 3,21 3,8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>');
const trashIcon  = () => svgWrap('<polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');
const storageIcon= () => svgWrap('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>');

const fileTypeIcon = type => ({ video: videoIcon(), image: imageIcon(), document: fileIcon(), design: fileIcon(), archive: archiveIcon() }[type] || fileIcon());
const spinnerSvg   = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

// ── Layout helpers ────────────────────────────────────────────
function statCard(label, val, iconSvg, color) {
  return `<div class="stat-card"><div class="stat-icon" style="background:${color}20;color:${color}">${iconSvg}</div><div><p class="stat-value">${val}</p><p class="stat-label">${label}</p></div></div>`;
}
function emptyState(title, subtitle, iconSvg) {
  return `<div class="empty-state"><div class="empty-icon">${iconSvg}</div><h3>${title}</h3>${subtitle?`<p>${subtitle}</p>`:''}</div>`;
}

// ── Trash async load ──────────────────────────────────────────
const _origRender = renderView;
window.renderView = function() {
  _origRender();
  if (State.view === 'trash' && State.isAdmin) setTimeout(loadTrashContent, 60);
};
