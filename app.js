'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  view: 'list',           // 'list' | 'detail' | 'edit'
  machines: [],
  activeId: null,
  activeLocationId: null, // which location is shown in the "This Machine" tab
  activeTab: 'global',
  searchQuery: '',
  lockedLocation: null,
  editDraft: null,
  prevView: 'list',
};

// ── Persistence ────────────────────────────────────────────────────────────

async function load() {
  try {
    const res = await fetch('api.php');
    const data = await res.json();
    state.machines = data.map(migrate);
  } catch (e) {
    state.machines = [];
  }
}

function save() {
  fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.machines),
  });
}

// Migrate old single-location format to multi-location format
function migrate(m) {
  if (m.locations) return m; // already new format
  return {
    id: m.id,
    name: m.name,
    globalNotes: m.globalNotes || '',
    updatedAt: m.updatedAt || Date.now(),
    locations: [{
      id: genId(),
      name: m.location || 'Unknown',
      skillShot:  m.locationNotes?.skillShot  || '',
      feeds:      m.locationNotes?.feeds      || '',
      bouncePass: m.locationNotes?.bouncePass || '',
      postPass:   m.locationNotes?.postPass   || '',
      tapPass:    m.locationNotes?.tapPass    || '',
      freeForm:   m.locationNotes?.freeForm   || '',
    }],
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function blankLocation(name) {
  return { id: genId(), name: name || '', skillShot: '', feeds: '', bouncePass: '', postPass: '', tapPass: '', freeForm: '' };
}

function blankMachine(locationName) {
  return {
    id: genId(),
    name: '',
    globalNotes: '',
    updatedAt: Date.now(),
    locations: [blankLocation(locationName || '')],
  };
}

function getMachine(id) {
  return state.machines.find(m => m.id === id);
}

function getActiveLocation(machine) {
  return machine.locations.find(l => l.id === state.activeLocationId)
    || machine.locations[0];
}

// ── Filtering / sorting ────────────────────────────────────────────────────

function allLocationNames() {
  const names = new Set();
  state.machines.forEach(m => m.locations.forEach(l => { if (l.name) names.add(l.name); }));
  return [...names].sort();
}

function getFilteredMachines() {
  const q = state.searchQuery.toLowerCase();
  return state.machines
    .filter(m => {
      const locNames = m.locations.map(l => l.name.toLowerCase());
      const matchesSearch = m.name.toLowerCase().includes(q)
        || locNames.some(n => n.includes(q));
      const matchesLocation = !state.lockedLocation
        || m.locations.some(l => l.name === state.lockedLocation);
      return matchesSearch && matchesLocation;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Rendering ──────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMachineRows(machines) {
  if (!machines.length) {
    return `<li class="empty-state">
      <p>🎰</p>
      <p>${state.searchQuery || state.lockedLocation ? 'No machines match.' : 'No machines yet.\nTap + to add your first machine.'}</p>
    </li>`;
  }
  return machines.map(m => {
    const locLabel = m.locations.map(l => l.name).filter(Boolean).join(', ');
    return `
      <li class="machine-row" data-action="open-machine" data-id="${esc(m.id)}">
        <div class="machine-row-info">
          <div class="machine-row-name">${esc(m.name)}</div>
          ${locLabel ? `<div class="machine-row-location">${esc(locLabel)}</div>` : ''}
        </div>
        <span class="machine-row-chevron">›</span>
      </li>`;
  }).join('');
}

function renderLocationPills() {
  const locations = allLocationNames();
  if (locations.length < 2) return '';
  const pills = [{ val: '', label: 'All' }, ...locations.map(l => ({ val: l, label: l }))]
    .map(({ val, label }) => {
      const active = val === '' ? !state.lockedLocation : state.lockedLocation === val;
      return `<button class="location-pill${active ? ' active' : ''}" data-action="set-location-lock" data-location="${esc(val)}">${esc(label)}</button>`;
    }).join('');
  return `<div class="location-pills">${pills}</div>`;
}

function renderList() {
  return `
    <div class="app-header">
      <h1>Pinball Notes</h1>
      <a href="logout.php" class="icon-btn" style="font-size:18px; text-decoration:none;" title="Sign out">⏻</a>
    </div>
    <div class="content">
      <div class="search-wrap">
        <input
          class="search-input"
          type="search"
          placeholder="Search machines or locations…"
          value="${esc(state.searchQuery)}"
          data-action="search-input"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        >
      </div>
      ${renderLocationPills()}
      <ul class="machine-list">${renderMachineRows(getFilteredMachines())}</ul>
    </div>
    <button class="fab" data-action="add-machine" aria-label="Add machine">+</button>
  `;
}

function renderGlobalTab(machine) {
  return `
    <div class="tab-content">
      <div class="field-group">
        <label class="field-label">Strategy &amp; Gameplay Notes</label>
        <textarea
          class="field-textarea tall"
          data-action="autosave"
          data-field="globalNotes"
          placeholder="Key shots, multiball rules, modes to focus on, scoring priorities…"
        >${esc(machine.globalNotes)}</textarea>
      </div>
    </div>
  `;
}

function renderLocationTab(machine) {
  const loc = getActiveLocation(machine);
  const locPills = machine.locations.map(l => `
    <button class="location-pill${l.id === loc.id ? ' active' : ''}"
      data-action="switch-location" data-loc-id="${esc(l.id)}">${esc(l.name || 'Unnamed')}</button>
  `).join('');

  return `
    <div class="tab-content">
      <div class="loc-selector">
        <div class="location-pills" style="padding: 0; margin-bottom: 0;">
          ${locPills}
          <button class="location-pill add-loc-btn" data-action="add-location">+ Add</button>
        </div>
        <div class="loc-actions">
          <button class="loc-action-btn" data-action="rename-location" data-loc-id="${esc(loc.id)}">Rename</button>
          ${machine.locations.length > 1
            ? `<button class="loc-action-btn danger" data-action="delete-location" data-loc-id="${esc(loc.id)}">Delete</button>`
            : ''}
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Skill Shot / Plunge</label>
        <input
          class="field-input"
          type="text"
          data-action="autosave-loc"
          data-field="skillShot"
          placeholder="e.g. 3/4 power to second lane"
          value="${esc(loc.skillShot)}"
          autocomplete="off"
        >
      </div>
      <div class="field-group">
        <label class="field-label">Feeds</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="feeds"
          placeholder="Left inlane feeds clean, right outlane drains fast…"
        >${esc(loc.feeds)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Bounce Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="bouncePass"
          placeholder="How the ball bounces off the flipper on this machine…"
        >${esc(loc.bouncePass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Post Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="postPass"
          placeholder="Right-to-left or left-to-right, timing notes…"
        >${esc(loc.postPass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Tap Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="tapPass"
          placeholder="Tap pass feel, timing quirks on this machine…"
        >${esc(loc.tapPass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Additional Notes</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="freeForm"
          placeholder="Any other location-specific observations…"
        >${esc(loc.freeForm)}</textarea>
      </div>
    </div>
  `;
}

function renderDetail() {
  const machine = getMachine(state.activeId);
  if (!machine) { state.view = 'list'; return renderList(); }

  const tabContent = state.activeTab === 'global'
    ? renderGlobalTab(machine)
    : renderLocationTab(machine);

  return `
    <div class="app-header">
      <button class="back-btn" data-action="back">Back</button>
      <h1 style="font-size:16px; color: var(--text);">${esc(machine.name)}</h1>
      <button class="icon-btn" data-action="edit-machine" data-id="${esc(machine.id)}" aria-label="Edit">✎</button>
      <button class="icon-btn danger" data-action="delete-machine" data-id="${esc(machine.id)}" aria-label="Delete">🗑</button>
    </div>
    <div class="tab-bar">
      <button class="tab-btn ${state.activeTab === 'global' ? 'active' : ''}"
        data-action="switch-tab" data-tab="global">Global</button>
      <button class="tab-btn ${state.activeTab === 'location' ? 'active' : ''}"
        data-action="switch-tab" data-tab="location">This Machine</button>
    </div>
    <div class="content">${tabContent}</div>
  `;
}

function renderEditModal() {
  const d = state.editDraft;
  const isNew = !getMachine(d.id);
  return `
    <div class="modal-overlay" data-action="cancel-edit-overlay">
      <div class="modal">
        <h2>${isNew ? 'Add Machine' : 'Edit Machine Name'}</h2>
        <div class="field-group">
          <label class="field-label">Machine Name</label>
          <input
            class="field-input"
            id="edit-name"
            type="text"
            placeholder="e.g. Creature from the Black Lagoon"
            value="${esc(d.name)}"
            autocomplete="off"
            autocorrect="off"
          >
        </div>
        ${isNew ? `
        <div class="field-group">
          <label class="field-label">First Location</label>
          <input
            class="field-input"
            id="edit-location"
            type="text"
            placeholder="e.g. Ground Kontrol, Portland"
            value="${esc(d.locations[0]?.name || '')}"
            autocomplete="off"
            autocorrect="off"
          >
        </div>` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="cancel-edit">Cancel</button>
          <button class="btn btn-primary" data-action="save-edit">Save</button>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const app = document.getElementById('app');
  if (state.view === 'list') {
    app.innerHTML = renderList();
    if (state.searchQuery) {
      const input = app.querySelector('.search-input');
      if (input) input.focus();
    }
  } else if (state.view === 'detail') {
    app.innerHTML = renderDetail();
  } else if (state.view === 'edit') {
    const base = state.prevView === 'detail' ? renderDetail() : renderList();
    app.innerHTML = base + renderEditModal();
    setTimeout(() => {
      const nameInput = app.querySelector('#edit-name');
      if (nameInput && !state.editDraft.name) nameInput.focus();
    }, 50);
  }
}

// ── Auto-save helpers ──────────────────────────────────────────────────────

function autosaveField(field, value, isLocationNote) {
  const machine = getMachine(state.activeId);
  if (!machine) return;
  if (isLocationNote) {
    const loc = getActiveLocation(machine);
    if (loc) loc[field] = value;
  } else {
    machine[field] = value;
  }
  machine.updatedAt = Date.now();
  save();
}

// ── Event handling ─────────────────────────────────────────────────────────

document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'open-machine') {
    state.activeId = el.dataset.id;
    state.activeTab = 'global';
    state.prevView = 'list';
    const machine = getMachine(state.activeId);
    // If a location is locked and this machine has it, open to that location
    const preferred = state.lockedLocation
      && machine?.locations.find(l => l.name === state.lockedLocation);
    state.activeLocationId = preferred ? preferred.id : machine?.locations[0]?.id || null;
    state.view = 'detail';
    render();

  } else if (action === 'back') {
    state.view = 'list';
    render();

  } else if (action === 'add-machine') {
    state.editDraft = blankMachine(state.lockedLocation || '');
    state.prevView = state.view;
    state.view = 'edit';
    render();

  } else if (action === 'edit-machine') {
    const machine = getMachine(el.dataset.id);
    if (!machine) return;
    state.editDraft = { ...machine, locations: machine.locations.map(l => ({ ...l })) };
    state.prevView = 'detail';
    state.view = 'edit';
    render();

  } else if (action === 'delete-machine') {
    const machine = getMachine(el.dataset.id);
    if (!machine) return;
    if (!confirm(`Delete "${machine.name}"? This cannot be undone.`)) return;
    state.machines = state.machines.filter(m => m.id !== machine.id);
    save();
    state.view = 'list';
    state.activeId = null;
    render();

  } else if (action === 'save-edit') {
    const nameInput = document.getElementById('edit-name');
    const locationInput = document.getElementById('edit-location');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      nameInput.focus();
      nameInput.style.borderColor = 'var(--danger)';
      return;
    }
    state.editDraft.name = name;
    if (locationInput) {
      state.editDraft.locations[0].name = locationInput.value.trim();
    }
    state.editDraft.updatedAt = Date.now();

    const existing = getMachine(state.editDraft.id);
    if (existing) {
      existing.name = state.editDraft.name;
      existing.updatedAt = state.editDraft.updatedAt;
    } else {
      state.machines.unshift(state.editDraft);
      state.activeId = state.editDraft.id;
      state.activeLocationId = state.editDraft.locations[0].id;
    }
    save();
    state.activeId = state.editDraft.id;
    state.view = 'detail';
    state.editDraft = null;
    render();

  } else if (action === 'cancel-edit') {
    state.editDraft = null;
    state.view = state.prevView;
    render();

  } else if (action === 'cancel-edit-overlay') {
    if (e.target !== el) return;
    state.editDraft = null;
    state.view = state.prevView;
    render();

  } else if (action === 'switch-tab') {
    if (state.activeTab !== el.dataset.tab) {
      state.activeTab = el.dataset.tab;
      render();
    }

  } else if (action === 'switch-location') {
    if (state.activeLocationId !== el.dataset.locId) {
      state.activeLocationId = el.dataset.locId;
      render();
    }

  } else if (action === 'add-location') {
    const name = prompt('Location name:')?.trim();
    if (!name) return;
    const machine = getMachine(state.activeId);
    if (!machine) return;
    const loc = blankLocation(name);
    machine.locations.push(loc);
    machine.updatedAt = Date.now();
    state.activeLocationId = loc.id;
    save();
    render();

  } else if (action === 'rename-location') {
    const machine = getMachine(state.activeId);
    if (!machine) return;
    const loc = machine.locations.find(l => l.id === el.dataset.locId);
    if (!loc) return;
    const name = prompt('Rename location:', loc.name)?.trim();
    if (!name || name === loc.name) return;
    loc.name = name;
    machine.updatedAt = Date.now();
    save();
    render();

  } else if (action === 'delete-location') {
    const machine = getMachine(state.activeId);
    if (!machine) return;
    const loc = machine.locations.find(l => l.id === el.dataset.locId);
    if (!loc) return;
    if (!confirm(`Delete location "${loc.name}"? Its notes will be lost.`)) return;
    machine.locations = machine.locations.filter(l => l.id !== loc.id);
    machine.updatedAt = Date.now();
    state.activeLocationId = machine.locations[0].id;
    save();
    render();

  } else if (action === 'set-location-lock') {
    state.lockedLocation = el.dataset.location || null;
    render();
  }
});

// Search input — update list without losing focus
document.addEventListener('input', function(e) {
  const el = e.target;
  if (el.dataset.action === 'search-input') {
    state.searchQuery = el.value;
    const list = document.querySelector('.machine-list');
    if (list) list.innerHTML = renderMachineRows(getFilteredMachines());
  }
});

// Auto-save notes on blur
document.addEventListener('blur', function(e) {
  const el = e.target;
  if (el.dataset.action === 'autosave') {
    autosaveField(el.dataset.field, el.value, false);
  } else if (el.dataset.action === 'autosave-loc') {
    autosaveField(el.dataset.field, el.value, true);
  }
}, true);

// ── Init ───────────────────────────────────────────────────────────────────

load().then(render);
