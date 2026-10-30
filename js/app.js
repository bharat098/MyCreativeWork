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
  folderStack: [], // [{id, name}] — breadcrumb trail for folder drill-down
};

// ── Bootstrap ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      openModal('admin-login-modal');
    }
  });

  window.addEventListener('hashchange', () => {
    const raw = location.hash.slice(1) || 'dashboard';
    if (raw !== State.view) State.folderStack = [];
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
});

// ── Auth ─────────────────────────────────────────────────────
function setAdmin(user) {
  State.user = user; State.isAdmin = true;
  document.getElementById('admin-badge').style.display = 'flex';
  document.getElementById('admin-actions').style.display = 'flex';
  document.getElementById('sidebar-mode-label').textContent = 'Admin Mode';
  document.body.classList.add('is-admin');
}
function clearAdmin() {
  State.user = null; State.isAdmin = false;
  document.getElementById('admin-badge').style.display = 'none';
  document.getElementById('admin-actions').style.display = 'none';
  document.getElementById('sidebar-mode-label').textContent = 'Creative Workspace';
  document.body.classList.remove('is-admin');
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
function navigate(view) { location.hash = view; closeMobileMenu(); }
function updateNavActive() {
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === State.view));
}
function setView(mode) {
  State.viewMode = mode;
  document.getElementById('view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('view-list').classList.toggle('active', mode === 'list');
  renderView();
}
function handleSearch(val) { State.search = val.toLowerCase(); renderView(); }

const TOGGLE_VIEWS = new Set(['files','videos','images','events','favorites','recent','archive','folders']);

// ── Render dispatcher ─────────────────────────────────────────
function renderView() {
  const c = document.getElementById('view-container');
  c.className = 'fade-in'; void c.offsetWidth;
  const views = {
    dashboard: renderDashboard, files: renderFiles,
    folders:   renderFolders,  videos: renderVideos,
    images:    renderImages,   events: renderEvents,
    favorites: renderFavorites, recent: renderRecent,
    archive:   renderArchive,  trash: renderTrash,
    settings:  renderSettings,
  };
  c.innerHTML = (views[State.view] || renderDashboard)();
  const toggle = document.getElementById('view-toggle');
  if (toggle) toggle.style.display = TOGGLE_VIEWS.has(State.view) ? 'flex' : 'none';
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  const totalFiles   = State.files.length;
  const totalFolders = State.folders.length;
  const totalSize    = State.files.reduce((s, f) => s + (f.file_size || 0), 0);
  const recentF      = [...State.files].slice(0, 8);

  const typeMap = {};
  State.files.forEach(f => { const t = f.file_type || 'other'; typeMap[t] = (typeMap[t] || 0) + 1; });
  const typeEntries = Object.entries(typeMap).sort((a,b) => b[1]-a[1]);
  const typeRows = typeEntries.map(([name, count]) => {
    const pct = Math.round(count / Math.max(totalFiles, 1) * 100);
    return `<div class="cat-row">
      <span style="flex:0 0 130px">${name.charAt(0).toUpperCase()+name.slice(1)}</span>
      <div class="cat-row-bar"><div class="cat-row-fill" style="width:${pct}%;background:var(--green)"></div></div>
      <span style="width:24px;text-align:right;font-weight:600;font-size:12px">${count}</span>
    </div>`;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Your Motion Vault — overview</p>
      </div>
      ${State.isAdmin
        ? `<button class="btn btn-ghost btn-sm" onclick="adminLogout()">Sign out admin</button>`
        : `<span style="font-size:11px;color:var(--text-secondary)">Press <kbd>Ctrl+Shift+A</kbd> for admin</span>`}
    </div>

    <div class="stats-grid stagger">
      ${statCard('Files', totalFiles, fileIcon(), 'var(--green)')}
      ${statCard('Folders', totalFolders, folderIcon(), 'var(--green-dark)')}
      ${statCard('Events', State.events.length, calIcon(), '#22C55E')}
      ${statCard('Storage', formatBytes(totalSize), storageIcon(), '#0D7A4A')}
    </div>

    ${State.isAdmin ? `
    <div class="quick-actions stagger" style="margin-top:16px">
      <button class="qa-btn" onclick="openModal('upload-modal')">
        <div class="qa-icon">${svgWrap('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>',20)}</div>
        <span>Upload File</span>
      </button>
      <button class="qa-btn" onclick="openNewFolderModal()">
        <div class="qa-icon">${folderIcon()}</div>
        <span>New Folder</span>
      </button>
      <button class="qa-btn" onclick="navigate('folders')">
        <div class="qa-icon">${folderIcon()}</div>
        <span>Browse Folders</span>
      </button>
      <button class="qa-btn" onclick="openModal('event-modal')">
        <div class="qa-icon">${calIcon()}</div>
        <span>New Event</span>
      </button>
    </div>` : ''}

    <div class="storage-bar-wrap" style="margin-top:20px">
      ${storageIcon()}
      <div class="storage-info">
        <p>Storage Used <span>${formatBytes(totalSize)}</span></p>
        <div class="storage-track"><div class="storage-fill" style="width:${Math.min(totalSize/1073741824*100,100).toFixed(1)}%"></div></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px" class="responsive-grid">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Files by Type</h3>
          <a onclick="navigate('files')" style="font-size:12px;color:var(--green);cursor:pointer">View all →</a>
        </div>
        <div class="card-body">
          ${typeRows || '<p style="font-size:13px;color:var(--text-secondary)">No files yet</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Recent Files</h3>
          <a onclick="navigate('recent')" style="font-size:12px;color:var(--green);cursor:pointer">See all →</a>
        </div>
        <div class="card-body">
          ${recentF.length ? recentF.map(f => `
            <div class="dash-proj-row">
              <div style="width:28px;height:28px;border-radius:8px;background:var(--mint);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--green)">${fileTypeIcon(f.file_type)}</div>
              <div class="dash-proj-info">
                <p class="dash-proj-name">${esc(f.original_name || f.name)}</p>
                <p class="dash-proj-meta">${formatBytes(f.file_size)} · ${timeAgo(f.created_at)}</p>
              </div>
              ${f.file_url ? `<a href="${esc(f.file_url)}" target="_blank" class="btn btn-ghost btn-xs" onclick="event.stopPropagation()">Open</a>` : ''}
            </div>`).join('')
          : '<p style="font-size:13px;color:var(--text-secondary)">No files yet</p>'}
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
          <p class="page-subtitle">${subFolders.length} sub-folder${subFolders.length!==1?'s':''} · ${folderFiles.length} file${folderFiles.length!==1?'s':''}</p>
        </div>
        ${State.isAdmin ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="openUploadInFolder('${currentFolder.id}')">Upload</button>
          <button class="btn btn-secondary btn-sm" onclick="createSubFolder('${currentFolder.id}','${esc(currentFolder.name)}')">+ Sub-folder</button>
          <button class="btn btn-ghost btn-sm" onclick="editFolder('${currentFolder.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="trashFolder('${currentFolder.id}')">Delete</button>
        </div>` : ''}
      </div>

      ${subFolders.length ? `
        <div class="section-header" style="margin-bottom:12px">
          <h2 class="section-title">Sub-folders (${subFolders.length})</h2>
        </div>
        ${State.viewMode === 'grid'
          ? `<div class="folder-grid stagger">${subFolders.map(folderCard).join('')}</div>`
          : `<div class="list-view stagger">${subFolders.map(folderRow).join('')}</div>`}
        <div style="margin-bottom:24px"></div>
      ` : ''}

      ${folderFiles.length ? `
        <div class="section-header" style="margin-bottom:12px">
          <h2 class="section-title">Files (${folderFiles.length})</h2>
        </div>
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
      <div><h1 class="page-title">Folders</h1><p class="page-subtitle">${roots.length} folder${roots.length!==1?'s':''}</p></div>
      ${State.isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openNewFolderModal()">+ New Folder</button>` : ''}
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

function openNewFolderModal() {
  openModal('folder-modal');
  setTimeout(() => {
    const el = document.getElementById('f-parent');
    if (el) el.value = '';
  }, 10);
}

function createSubFolder(parentId, parentName) {
  openModal('folder-modal');
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
      <div><h1 class="page-title">All Files</h1><p class="page-subtitle">${list.length} file${list.length!==1?'s':''}</p></div>
      ${State.isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openModal('upload-modal')">Upload</button>` : ''}
    </div>
    ${list.length ? fileGrid(list) : emptyState('No files yet', 'Upload your first file', fileIcon())}`;
}

function renderVideos() {
  const list = filterFiles(State.files.filter(f => f.file_type === 'video'));
  return `
    <div class="page-header">
      <div><h1 class="page-title">Videos</h1><p class="page-subtitle">${list.length} video${list.length!==1?'s':''}</p></div>
      ${State.isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openModal('upload-modal')">Upload</button>` : ''}
    </div>
    ${list.length ? fileGrid(list) : emptyState('No videos yet', 'Upload your video files', videoIcon())}`;
}

function renderImages() {
  const list = filterFiles(State.files.filter(f => f.file_type === 'image'));
  return `
    <div class="page-header">
      <div><h1 class="page-title">Images</h1><p class="page-subtitle">${list.length} image${list.length!==1?'s':''}</p></div>
      ${State.isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openModal('upload-modal')">Upload</button>` : ''}
    </div>
    ${list.length ? fileGrid(list) : emptyState('No images yet', 'Upload your image files', imageIcon())}`;
}

function filterFiles(list) {
  if (!State.search) return list;
  const q = State.search;
  return list.filter(f =>
    (f.name||'').toLowerCase().includes(q) ||
    (f.original_name||'').toLowerCase().includes(q) ||
    (f.extension||'').toLowerCase().includes(q)
  );
}

function fileGrid(list) {
  return State.viewMode === 'list'
    ? `<div class="list-view">${list.map(fileListRow).join('')}</div>`
    : `<div class="file-grid stagger">${list.map(fileCard).join('')}</div>`;
}

function fileCard(f) {
  const isImg   = f.file_type === 'image';
  const isUrl   = f.file_path?.startsWith('url:');
  const extBadge = isUrl ? (f.extension||'link').toUpperCase() : (f.extension||'').toUpperCase();
  const thumb = isImg && f.file_url
    ? `<img src="${esc(f.file_url)}" alt="${esc(f.name)}" loading="lazy" />`
    : isUrl
      ? `<div class="file-icon-wrap url-thumb" style="color:var(--green)">${urlTypeIcon(f.extension)}
           <span class="url-badge">${extBadge}</span></div>`
      : `<div class="file-icon-wrap" style="color:var(--green)">${fileTypeIcon(f.file_type)}</div>`;
  return `
  <div class="file-card">
    <div class="file-thumb" onclick="previewFile('${f.id}')" style="cursor:pointer" title="Preview">
      ${thumb}
    </div>
    <p class="file-name" title="${esc(f.original_name)}">${esc(f.name || f.original_name)}</p>
    <p class="file-meta">${f.file_size ? formatBytes(f.file_size)+' · ' : ''}${extBadge}</p>
    ${State.isAdmin ? `
    <div class="file-card-actions">
      <button class="btn btn-ghost btn-xs" onclick="previewFile('${f.id}')">View</button>
      <button class="btn btn-ghost btn-xs" onclick="openMoveModal('${f.id}')">Move</button>
      <button class="btn btn-ghost btn-xs fav-btn${f.is_favorite?' active':''}" onclick="toggleFavorite('${f.id}',${f.is_favorite})">${f.is_favorite?'♥':'♡'}</button>
      <button class="btn btn-danger btn-xs" onclick="trashItem('${f.id}')">Del</button>
    </div>` : `
    <div class="file-card-actions">
      <button class="btn btn-ghost btn-xs" onclick="previewFile('${f.id}')">View</button>
    </div>`}
  </div>`;
}

function fileListRow(f) {
  const folderName = f.folder_id ? (State.folders.find(fd => fd.id === f.folder_id)?.name || '') : '';
  return `
  <div class="list-row">
    <div class="list-thumb" style="width:36px;height:36px;color:var(--green)">${fileTypeIcon(f.file_type)}</div>
    <div class="list-info">
      <p class="list-name">${esc(f.original_name)}</p>
      <p class="list-meta">${formatBytes(f.file_size)} · ${timeAgo(f.created_at)}${folderName ? ` · ${esc(folderName)}` : ''}</p>
    </div>
    <span class="badge">${esc(f.file_type || 'other')}</span>
    ${State.isAdmin ? `
    <div class="row-actions">
      ${f.file_url ? `<a href="${esc(f.file_url)}" target="_blank" class="btn btn-ghost btn-xs">Open</a>` : ''}
      <button class="btn btn-ghost btn-xs" onclick="openMoveModal('${f.id}')">Move</button>
      <button class="btn btn-ghost btn-xs" onclick="toggleFavorite('${f.id}',${f.is_favorite})">${f.is_favorite?'♥':'♡'}</button>
      <button class="btn btn-danger btn-xs" onclick="trashItem('${f.id}')">Del</button>
    </div>` : ''}
  </div>`;
}

// ── Events ────────────────────────────────────────────────────
function renderEvents() {
  let list = State.events;
  if (State.search) list = list.filter(e =>
    e.name.toLowerCase().includes(State.search) ||
    (e.description||'').toLowerCase().includes(State.search)
  );
  return `
    <div class="page-header">
      <div><h1 class="page-title">Events</h1><p class="page-subtitle">${list.length} event${list.length!==1?'s':''}</p></div>
      ${State.isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openModal('event-modal')">+ New Event</button>` : ''}
    </div>
    ${list.length
      ? (State.viewMode === 'grid'
          ? `<div class="card-grid stagger">${list.map(eventCard).join('')}</div>`
          : `<div class="list-view">${list.map(eventListRow).join('')}</div>`)
      : emptyState('No events yet', State.isAdmin ? 'Create your first event' : 'Events will appear here', calIcon())}`;
}

function eventCard(ev) {
  return `
  <div class="project-card">
    ${ev.cover_image_url
      ? `<div class="project-thumb"><img src="${esc(ev.cover_image_url)}" loading="lazy" /></div>`
      : `<div class="project-thumb" style="background:var(--mint);display:flex;align-items:center;justify-content:center;color:var(--green);opacity:.5">${calIcon()}</div>`}
    <div class="project-info">
      <h4>${esc(ev.name)}</h4>
      ${ev.event_date ? `<p class="project-cat">${new Date(ev.event_date).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
      ${ev.description ? `<p style="font-size:11px;color:var(--text-secondary);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(ev.description)}</p>` : ''}
    </div>
    ${State.isAdmin ? `
    <div class="card-actions" onclick="event.stopPropagation()">
      <button class="btn btn-ghost btn-xs" onclick="editEvent('${ev.id}')">Edit</button>
      <button class="btn btn-danger btn-xs" onclick="deleteEvent('${ev.id}')">Del</button>
    </div>` : ''}
  </div>`;
}

function eventListRow(ev) {
  return `
  <div class="list-row">
    <div class="list-thumb" style="color:var(--green)">${calIcon()}</div>
    <div class="list-info">
      <p class="list-name">${esc(ev.name)}</p>
      <p class="list-meta">${ev.event_date ? new Date(ev.event_date).toLocaleDateString() : 'No date'}</p>
    </div>
    ${State.isAdmin ? `
    <div class="row-actions">
      <button class="btn btn-ghost btn-xs" onclick="editEvent('${ev.id}')">Edit</button>
      <button class="btn btn-danger btn-xs" onclick="deleteEvent('${ev.id}')">Del</button>
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
      <div><h1 class="page-title">Favorites</h1><p class="page-subtitle">${favF.length} item${favF.length!==1?'s':''}</p></div>
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
      <div><h1 class="page-title">Recent</h1><p class="page-subtitle">Last 30 days · ${recentF.length} file${recentF.length!==1?'s':''}</p></div>
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
      <div><h1 class="page-title">Archive</h1><p class="page-subtitle">Files older than 90 days · ${list.length} file${list.length!==1?'s':''}</p></div>
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
  return `
    <div class="page-header"><h1 class="page-title">Settings</h1></div>
    <div style="max-width:620px;display:flex;flex-direction:column;gap:20px">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Admin Access</h3></div>
        <div class="card-body">
          ${State.isAdmin
            ? `<p style="color:var(--green);font-size:13px;margin-bottom:12px">✓ Signed in as <strong>${State.user?.email}</strong></p>
               <button class="btn btn-danger" onclick="adminLogout()">Sign out</button>`
            : `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Press <kbd>Ctrl+Shift+A</kbd> anywhere to open admin login.</p>
               <button class="btn btn-primary" onclick="openModal('admin-login-modal')">Admin Login</button>`}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">Workspace Stats</h3></div>
        <div class="card-body" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          ${[['Files', State.files.length], ['Folders', State.folders.length],
             ['Events', State.events.length], ['Categories', State.categories.length],
             ['Storage', formatBytes(State.files.reduce((s,f)=>s+(f.file_size||0),0))]
            ].map(([l,v]) => `<div style="text-align:center;padding:12px;background:var(--bg);border-radius:8px"><p style="font-size:20px;font-weight:800;color:var(--green-dark)">${v}</p><p style="font-size:11px;color:var(--text-secondary)">${l}</p></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">Categories</h3></div>
        <div class="card-body">
          <div class="tags-row" style="flex-wrap:wrap;gap:8px">
            ${State.categories.map(c => `<span class="tag" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${esc(c.name)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">About</h3></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text-secondary)">${APP_NAME} v${APP_VERSION} — Motion Vault</p>
          <p style="font-size:13px;color:var(--text-secondary);margin-top:4px">Powered by Supabase · Pure HTML/CSS/JS</p>
        </div>
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
  openModal('folder-modal');
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
  openModal('event-modal');
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
  openModal('move-modal');
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
            <h3 id="preview-title" style="max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Preview</h3>
            <p id="preview-meta"></p>
          </div>
        </div>
        <button class="btn btn-ghost btn-icon" onclick="closePreview()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="preview-content" style="background:#111;border-radius:0 0 var(--radius-lg) var(--radius-lg);min-height:300px;display:flex;align-items:center;justify-content:center;overflow:hidden"></div>
    </div>
  </div>`);
}

function previewFile(fileId) {
  const f = State.files.find(x => x.id === fileId);
  if (!f) return;
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

// ── SVG icons ─────────────────────────────────────────────────
const svgWrap    = (path, size=18) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:${size}px;height:${size}px">${path}</svg>`;
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
