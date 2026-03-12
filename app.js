'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  view: 'list',       // 'list' | 'detail' | 'edit'
  machines: [],
  activeId: null,
  activeTab: 'global',
  searchQuery: '',
  lockedLocation: null,
  editDraft: null,
  prevView: 'list',   // for cancel-edit navigation
};

// ── Persistence ────────────────────────────────────────────────────────────

async function load() {
  try {
    const res = await fetch('api.php');
    state.machines = await res.json();
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

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getMachine(id) {
  return state.machines.find(m => m.id === id);
}

function blankMachine() {
  return {
    id: genId(),
    name: '',
    location: '',
    globalNotes: '',
    locationNotes: {
      skillShot: '',
      feeds: '',
      bouncePass: '',
      postPass: '',
      tapPass: '',
      freeForm: '',
    },
    updatedAt: Date.now(),
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFilteredMachines() {
  const q = state.searchQuery.toLowerCase();
  return state.machines
    .filter(m => {
      const matchesSearch = m.name.toLowerCase().includes(q) || m.location.toLowerCase().includes(q);
      const matchesLocation = !state.lockedLocation || m.location === state.lockedLocation;
      return matchesSearch && matchesLocation;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderMachineRows(machines) {
  return machines.length
    ? machines.map(m => `
      <li class="machine-row" data-action="open-machine" data-id="${esc(m.id)}">
        <div class="machine-row-info">
          <div class="machine-row-name">${esc(m.name)}</div>
          ${m.location ? `<div class="machine-row-location">${esc(m.location)}</div>` : ''}
        </div>
        <span class="machine-row-chevron">›</span>
      </li>`).join('')
    : `<li class="empty-state">
        <p>🎰</p>
        <p>${state.searchQuery || state.lockedLocation ? 'No machines match.' : 'No machines yet.\nTap + to add your first machine.'}</p>
       </li>`;
}

function renderLocationPills() {
  const locations = [...new Set(state.machines.map(m => m.location).filter(Boolean))].sort();
  if (locations.length < 2) return '';
  const pills = [{ val: '', label: 'All' }, ...locations.map(l => ({ val: l, label: l }))]
    .map(({ val, label }) => {
      const active = val === '' ? !state.lockedLocation : state.lockedLocation === val;
      return `<button class="location-pill${active ? ' active' : ''}" data-action="set-location-lock" data-location="${esc(val)}">${esc(label)}</button>`;
    }).join('');
  return `<div class="location-pills">${pills}</div>`;
}

function renderList() {
  const filtered = getFilteredMachines();

  return `
    <div class="app-header">
      <h1>Pinball Notes</h1>
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
      <ul class="machine-list">${renderMachineRows(filtered)}</ul>
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
  const ln = machine.locationNotes;
  return `
    <div class="tab-content">
      <div class="field-group">
        <label class="field-label">Skill Shot / Plunge</label>
        <input
          class="field-input"
          type="text"
          data-action="autosave-loc"
          data-field="skillShot"
          placeholder="e.g. 3/4 power to second lane"
          value="${esc(ln.skillShot)}"
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
        >${esc(ln.feeds)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Bounce Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="bouncePass"
          placeholder="How the ball bounces off the flipper on this machine…"
        >${esc(ln.bouncePass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Post Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="postPass"
          placeholder="Right-to-left or left-to-right, timing notes…"
        >${esc(ln.postPass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Tap Pass</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="tapPass"
          placeholder="Tap pass feel, timing quirks on this machine…"
        >${esc(ln.tapPass)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Additional Notes</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="freeForm"
          placeholder="Any other location-specific observations…"
        >${esc(ln.freeForm)}</textarea>
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
    ${machine.location ? `<div class="detail-meta">${esc(machine.location)}</div>` : ''}
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
        <h2>${isNew ? 'Add Machine' : 'Edit Machine'}</h2>
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
        <div class="field-group">
          <label class="field-label">Location</label>
          <input
            class="field-input"
            id="edit-location"
            type="text"
            placeholder="e.g. Ground Kontrol, Portland"
            value="${esc(d.location)}"
            autocomplete="off"
            autocorrect="off"
          >
        </div>
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
    // Restore focus to search if query is active
    if (state.searchQuery) {
      const input = app.querySelector('.search-input');
      if (input) input.focus();
    }
  } else if (state.view === 'detail') {
    app.innerHTML = renderDetail();
  } else if (state.view === 'edit') {
    // Render the underlying view first, then overlay the modal
    const base = state.prevView === 'detail' ? renderDetail() : renderList();
    app.innerHTML = base + renderEditModal();
    // Auto-focus the name field
    setTimeout(() => {
      const nameInput = app.querySelector('#edit-name');
      if (nameInput && !state.editDraft.name) nameInput.focus();
    }, 50);
  }
}

// ── Auto-save helpers ──────────────────────────────────────────────────────

// Updates machine field in memory + storage without re-rendering
function autosaveField(field, value, isLocationNote) {
  const machine = getMachine(state.activeId);
  if (!machine) return;
  if (isLocationNote) {
    machine.locationNotes[field] = value;
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
    state.view = 'detail';
    render();

  } else if (action === 'back') {
    state.view = 'list';
    render();

  } else if (action === 'add-machine') {
    state.editDraft = blankMachine();
    state.prevView = state.view;
    state.view = 'edit';
    render();

  } else if (action === 'edit-machine') {
    const machine = getMachine(el.dataset.id);
    if (!machine) return;
    state.editDraft = { ...machine };
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
    state.editDraft.location = locationInput ? locationInput.value.trim() : '';
    state.editDraft.updatedAt = Date.now();

    const existing = getMachine(state.editDraft.id);
    if (existing) {
      // Update in place, preserving notes
      Object.assign(existing, state.editDraft);
    } else {
      state.machines.unshift(state.editDraft);
      state.activeId = state.editDraft.id;
    }
    save();

    if (state.prevView === 'detail' || state.activeId === state.editDraft.id) {
      state.activeId = state.editDraft.id;
      state.view = 'detail';
    } else {
      state.view = 'list';
    }
    state.editDraft = null;
    render();

  } else if (action === 'cancel-edit') {
    state.editDraft = null;
    state.view = state.prevView;
    render();

  } else if (action === 'cancel-edit-overlay') {
    // Only cancel if clicking directly on the overlay, not a child element
    if (e.target !== el) return;
    state.editDraft = null;
    state.view = state.prevView;
    render();

  } else if (action === 'switch-tab') {
    if (state.activeTab !== el.dataset.tab) {
      state.activeTab = el.dataset.tab;
      render();
    }

  } else if (action === 'set-location-lock') {
    state.lockedLocation = el.dataset.location || null;
    render();
  }
});

// Search input
document.addEventListener('input', function(e) {
  const el = e.target;
  if (el.dataset.action === 'search-input') {
    state.searchQuery = el.value;
    // Re-render only the list portion without losing focus
    const list = document.querySelector('.machine-list');
    if (list) {
      list.innerHTML = renderMachineRows(getFilteredMachines());
    }
  }
});

// Auto-save notes on blur (no re-render, just memory + storage)
document.addEventListener('blur', function(e) {
  const el = e.target;
  if (el.dataset.action === 'autosave') {
    autosaveField(el.dataset.field, el.value, false);
  } else if (el.dataset.action === 'autosave-loc') {
    autosaveField(el.dataset.field, el.value, true);
  }
}, true); // capture phase so it fires on all elements including inputs

// ── Init ───────────────────────────────────────────────────────────────────

load().then(render);
