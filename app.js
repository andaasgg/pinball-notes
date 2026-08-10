'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  view: 'list',           // 'list' | 'detail' | 'edit' | 'admin'
  machines: [],
  activeId: null,
  activeLocationId: null, // which location is shown in the "This Machine" tab
  activeTab: 'global',
  searchQuery: '',
  lockedLocation: null,
  editDraft: null,
  prevView: 'list',
  admin: {
    tab: 'import',        // 'import' | 'merge'
    importLocation: '',
    importText: '',
    importRows: null,     // null until "Preview Import" is run
    dismissedPairs: [],   // session-only dismissed duplicate suggestions
    manualA: '',
    manualB: '',
    mergeModal: null,     // { aId, bId, name, globalNotes, locations }
  },
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

// Migrate old formats to current format
function migrate(m) {
  // v1: single location with locationNotes object
  if (!m.locations) {
    return {
      id: m.id,
      name: m.name,
      globalNotes: m.globalNotes || '',
      updatedAt: m.updatedAt || Date.now(),
      locations: [migrateLocation({
        name:      m.location || 'Unknown',
        skillShot: m.locationNotes?.skillShot  || '',
        feeds:     m.locationNotes?.feeds      || '',
        bouncePass:m.locationNotes?.bouncePass || '',
        postPass:  m.locationNotes?.postPass   || '',
        tapPass:   m.locationNotes?.tapPass    || '',
        freeForm:  m.locationNotes?.freeForm   || '',
      })],
    };
  }
  // v2: multi-location but may have old field names
  return { ...m, locations: m.locations.map(migrateLocation) };
}

// Migrate a single location object to the current field schema
function migrateLocation(l) {
  if ('flippers' in l) return l; // already current
  // Fold bouncePass/postPass/tapPass into flippers
  const parts = [l.bouncePass, l.postPass, l.tapPass].filter(Boolean);
  return {
    id:        l.id || genId(),
    name:      l.name || '',
    skillShot: l.skillShot || '',
    tilt:      l.tilt || '',
    feeds:     l.feeds || '',
    flippers:  parts.join('\n\n') || '',
    freeForm:  l.freeForm || '',
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function blankLocation(name) {
  return { id: genId(), name: name || '', skillShot: '', tilt: '', feeds: '', flippers: '', freeForm: '' };
}

function blankMachine(locationName, name) {
  return {
    id: genId(),
    name: name || '',
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

// ── Fuzzy name matching (for import / duplicate detection) ────────────────

// Lowercase, strip punctuation, collapse whitespace — so "Avengers: Infinity
// Quest (Pro)" and "avengers infinity quest pro" compare equal-ish.
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bigramCounts(s) {
  const map = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.substr(i, 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

// Sørensen–Dice coefficient over character bigrams, 0..1.
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const mapA = bigramCounts(a);
  const mapB = bigramCounts(b);
  let intersection = 0;
  mapA.forEach((count, bg) => {
    if (mapB.has(bg)) intersection += Math.min(count, mapB.get(bg));
  });
  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * intersection) / total;
}

// Similarity score 0..1 between two machine/game names. Robust to variant
// suffixes like "(Pro)", "(LE)", punctuation, and casing — e.g. "Avengers
// Infinity Quest" vs "Avengers Infinity Quest (Pro)" scores high via the
// substring-containment bonus even though the bigram overlap alone is lower.
function nameSimilarity(rawA, rawB) {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  let score = diceCoefficient(a, b);
  if (a.includes(b) || b.includes(a)) {
    score = Math.max(score, 0.88);
  }
  return score;
}

const DUPLICATE_THRESHOLD = 0.72;

// Best existing-machine match for a candidate name. Returns {machine, score} or null.
function bestMachineMatch(name, excludeId) {
  let best = null;
  state.machines.forEach(m => {
    if (m.id === excludeId) return;
    const score = nameSimilarity(name, m.name);
    if (!best || score > best.score) best = { machine: m, score };
  });
  return best && best.score > 0 ? best : null;
}

function pairKey(aId, bId) {
  return [aId, bId].sort().join('|');
}

// All pairs of existing machines whose names look like likely duplicates.
function findDuplicateCandidates() {
  const machines = state.machines;
  const pairs = [];
  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) {
      const score = nameSimilarity(machines[i].name, machines[j].name);
      if (score >= DUPLICATE_THRESHOLD) {
        pairs.push({ aId: machines[i].id, bId: machines[j].id, score });
      }
    }
  }
  return pairs
    .filter(p => !state.admin.dismissedPairs.includes(pairKey(p.aId, p.bId)))
    .sort((a, b) => b.score - a.score);
}

// ── Merge helpers ───────────────────────────────────────────────────────────

function combineText(a, b) {
  a = (a || '').trim();
  b = (b || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return a + '\n\n' + b;
}

// Combine two locations arrays. Locations with the same name (case-insensitive)
// are folded into one, with each note field concatenated; everything else is
// just appended.
function mergeLocationArrays(locsA, locsB) {
  const merged = locsA.map(l => ({ ...l }));
  locsB.forEach(lb => {
    const key = lb.name.trim().toLowerCase();
    const match = key && merged.find(la => la.name.trim().toLowerCase() === key);
    if (match) {
      match.skillShot = combineText(match.skillShot, lb.skillShot);
      match.tilt      = combineText(match.tilt, lb.tilt);
      match.feeds      = combineText(match.feeds, lb.feeds);
      match.flippers   = combineText(match.flippers, lb.flippers);
      match.freeForm   = combineText(match.freeForm, lb.freeForm);
    } else {
      merged.push({ ...lb, id: genId() });
    }
  });
  return merged;
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
      <button class="icon-btn" data-action="open-admin" aria-label="Admin" title="Admin">⚙</button>
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
        <label class="field-label">Tilt</label>
        <input
          class="field-input"
          type="text"
          data-action="autosave-loc"
          data-field="tilt"
          placeholder="Tilt sensitivity"
          value="${esc(loc.tilt)}"
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
        <label class="field-label">Flippers</label>
        <textarea
          class="field-textarea"
          data-action="autosave-loc"
          data-field="flippers"
          placeholder="Flipper notes — bounce pass, alley pass, post pass, etc."
        >${esc(loc.flippers)}</textarea>
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

function renderMachineOptions(selectedId) {
  return [...state.machines]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => `<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`)
    .join('');
}

function renderAdmin() {
  const a = state.admin;
  return `
    <div class="app-header">
      <button class="back-btn" data-action="admin-back">Back</button>
      <h1 style="font-size:16px; color: var(--text);">Admin</h1>
    </div>
    <div class="tab-bar">
      <button class="tab-btn ${a.tab === 'import' ? 'active' : ''}"
        data-action="switch-admin-tab" data-tab="import">Import Games</button>
      <button class="tab-btn ${a.tab === 'merge' ? 'active' : ''}"
        data-action="switch-admin-tab" data-tab="merge">Merge / Duplicates</button>
    </div>
    <div class="content">${a.tab === 'import' ? renderAdminImport() : renderAdminMerge()}</div>
    ${a.mergeModal ? renderMergeModal() : ''}
  `;
}

function renderAdminImport() {
  const a = state.admin;

  if (!a.importRows) {
    const locOptions = allLocationNames().map(n => `<option value="${esc(n)}">`).join('');
    return `
      <div class="admin-section">
        <p class="admin-hint">Paste a list of game names (one per line) to add them all to a location at once. Likely duplicates already in your collection will be flagged for review before anything is saved.</p>
        <div class="field-group">
          <label class="field-label">Location</label>
          <input
            class="field-input"
            id="import-location"
            type="text"
            list="import-location-list"
            placeholder="e.g. Ground Kontrol, Portland"
            value="${esc(a.importLocation)}"
            autocomplete="off"
            autocorrect="off"
          >
          <datalist id="import-location-list">${locOptions}</datalist>
        </div>
        <div class="field-group">
          <label class="field-label">Game Names</label>
          <textarea
            class="field-textarea tall"
            id="import-text"
            placeholder="Godzilla&#10;Avengers Infinity Quest&#10;Deadpool…"
          >${esc(a.importText)}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="preview-import">Preview Import</button>
        </div>
      </div>
    `;
  }

  const rows = a.importRows;
  const createCount = rows.filter(r => r.decision === 'create').length;
  const mergeCount = rows.filter(r => r.decision === 'merge').length;
  const skipCount = rows.filter(r => r.decision === 'skip').length;
  const importCount = rows.length - skipCount;

  const rowsHtml = rows.map((r, i) => {
    const matchBadge = r.match && r.decision === 'merge'
      ? `<span class="import-row-match">${Math.round(r.match.score * 100)}% match</span>`
      : '';
    return `
      <li class="import-row">
        <div class="import-row-name">${esc(r.name)}${matchBadge}</div>
        <select class="field-input import-row-select" data-action="set-import-decision" data-index="${i}">
          <option value="create" ${r.decision === 'create' ? 'selected' : ''}>➕ Create new machine</option>
          <option value="skip" ${r.decision === 'skip' ? 'selected' : ''}>Skip this game</option>
          <optgroup label="Merge into existing…">
            ${[...state.machines].sort((x, y) => x.name.localeCompare(y.name)).map(m => `
              <option value="merge:${esc(m.id)}" ${r.decision === 'merge' && r.matchId === m.id ? 'selected' : ''}>${esc(m.name)}</option>
            `).join('')}
          </optgroup>
        </select>
      </li>`;
  }).join('');

  return `
    <div class="admin-section">
      <p class="admin-hint">Importing into <strong>${esc(a.importLocation)}</strong> — ${createCount} new, ${mergeCount} merged, ${skipCount} skipped.</p>
      <ul class="import-row-list">${rowsHtml}</ul>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-action="cancel-import-preview">Start Over</button>
        <button class="btn btn-primary" data-action="confirm-import" ${importCount === 0 ? 'disabled' : ''}>Import ${importCount} Game${importCount === 1 ? '' : 's'}</button>
      </div>
    </div>
  `;
}

function renderAdminMerge() {
  const a = state.admin;
  const candidates = findDuplicateCandidates();

  const candidatesHtml = candidates.length
    ? candidates.map(p => {
        const ma = getMachine(p.aId), mb = getMachine(p.bId);
        if (!ma || !mb) return '';
        return `
          <li class="dup-row">
            <div class="dup-row-names">
              <div>${esc(ma.name)}</div>
              <div class="dup-row-vs">↔ ${Math.round(p.score * 100)}% match</div>
              <div>${esc(mb.name)}</div>
            </div>
            <div class="dup-row-actions">
              <button class="loc-action-btn" data-action="dismiss-dup" data-a="${esc(p.aId)}" data-b="${esc(p.bId)}">Not a duplicate</button>
              <button class="btn btn-primary" style="flex:0; padding:8px 14px;" data-action="open-merge" data-a="${esc(p.aId)}" data-b="${esc(p.bId)}">Merge</button>
            </div>
          </li>`;
      }).join('')
    : `<p class="admin-hint">No likely duplicates found.</p>`;

  return `
    <div class="admin-section">
      <h2 class="admin-subheading">Possible Duplicates</h2>
      <ul class="dup-list">${candidatesHtml}</ul>

      <h2 class="admin-subheading">Manual Merge</h2>
      <p class="admin-hint">Pick any two machines to merge into one.</p>
      <div class="field-group">
        <label class="field-label">Machine A</label>
        <select class="field-input" data-action="set-manual-a">
          <option value="">Select a machine…</option>
          ${renderMachineOptions(a.manualA)}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Machine B</label>
        <select class="field-input" data-action="set-manual-b">
          <option value="">Select a machine…</option>
          ${renderMachineOptions(a.manualB)}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" data-action="open-manual-merge">Merge Selected</button>
      </div>
    </div>
  `;
}

function renderMergeModal() {
  const mm = state.admin.mergeModal;
  const ma = getMachine(mm.aId), mb = getMachine(mm.bId);
  if (!ma || !mb) return '';
  return `
    <div class="modal-overlay" data-action="cancel-merge-overlay">
      <div class="modal">
        <h2>Merge Machines</h2>
        <p class="admin-hint">Combines locations and notes from both into one machine. This cannot be undone.</p>
        <div class="field-group">
          <label class="field-label">Machine Name</label>
          <input class="field-input" id="merge-name" type="text" value="${esc(mm.name)}" autocomplete="off">
          <div class="dup-row-actions">
            <button class="loc-action-btn" data-action="use-name-a">Use "${esc(ma.name)}"</button>
            <button class="loc-action-btn" data-action="use-name-b">Use "${esc(mb.name)}"</button>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Global Notes (combined)</label>
          <textarea class="field-textarea tall" id="merge-notes">${esc(mm.globalNotes)}</textarea>
        </div>
        <div class="field-group">
          <label class="field-label">Locations (${mm.locations.length})</label>
          <div class="admin-hint">${mm.locations.map(l => esc(l.name || 'Unnamed')).join(', ')}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="cancel-merge">Cancel</button>
          <button class="btn btn-primary" data-action="confirm-merge">Merge</button>
        </div>
      </div>
    </div>
  `;
}

function openMergeModal(aId, bId) {
  const ma = getMachine(aId), mb = getMachine(bId);
  if (!ma || !mb) return;
  // Default the canonical name to whichever machine covers more locations.
  const primary = ma.locations.length >= mb.locations.length ? ma : mb;
  state.admin.mergeModal = {
    aId, bId,
    name: primary.name,
    globalNotes: combineText(ma.globalNotes, mb.globalNotes),
    locations: mergeLocationArrays(ma.locations, mb.locations),
  };
  render();
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
  } else if (state.view === 'admin') {
    app.innerHTML = renderAdmin();
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
    state.activeTab = state.lockedLocation ? 'location' : 'global';
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

  // ── Admin ──

  } else if (action === 'open-admin') {
    state.view = 'admin';
    render();

  } else if (action === 'admin-back') {
    state.view = 'list';
    render();

  } else if (action === 'switch-admin-tab') {
    state.admin.tab = el.dataset.tab;
    render();

  } else if (action === 'preview-import') {
    const locInput = document.getElementById('import-location');
    const textInput = document.getElementById('import-text');
    const location = locInput.value.trim();
    if (!location) {
      locInput.focus();
      locInput.style.borderColor = 'var(--danger)';
      return;
    }
    const names = [...new Set(
      textInput.value.split('\n').map(s => s.trim()).filter(Boolean)
    )];
    if (!names.length) {
      textInput.focus();
      textInput.style.borderColor = 'var(--danger)';
      return;
    }
    state.admin.importLocation = location;
    state.admin.importText = textInput.value;
    state.admin.importRows = names.map(name => {
      const match = bestMachineMatch(name);
      const isMatch = match && match.score >= DUPLICATE_THRESHOLD;
      return {
        name,
        match,
        matchId: isMatch ? match.machine.id : null,
        decision: isMatch ? 'merge' : 'create',
      };
    });
    render();

  } else if (action === 'cancel-import-preview') {
    state.admin.importRows = null;
    render();

  } else if (action === 'confirm-import') {
    const rows = state.admin.importRows || [];
    const location = state.admin.importLocation;
    rows.forEach(r => {
      if (r.decision === 'skip') return;
      if (r.decision === 'merge' && r.matchId) {
        const machine = getMachine(r.matchId);
        if (!machine) return;
        const existingLoc = machine.locations.find(
          l => l.name.trim().toLowerCase() === location.toLowerCase()
        );
        if (!existingLoc) machine.locations.push(blankLocation(location));
        machine.updatedAt = Date.now();
      } else {
        state.machines.push(blankMachine(location, r.name));
      }
    });
    save();
    state.admin.importRows = null;
    state.admin.importText = '';
    state.admin.importLocation = '';
    state.view = 'list';
    render();

  } else if (action === 'dismiss-dup') {
    state.admin.dismissedPairs.push(pairKey(el.dataset.a, el.dataset.b));
    render();

  } else if (action === 'open-merge') {
    openMergeModal(el.dataset.a, el.dataset.b);

  } else if (action === 'open-manual-merge') {
    const { manualA, manualB } = state.admin;
    if (!manualA || !manualB || manualA === manualB) {
      alert('Pick two different machines to merge.');
      return;
    }
    openMergeModal(manualA, manualB);

  } else if (action === 'use-name-a') {
    const ma = getMachine(state.admin.mergeModal.aId);
    const input = document.getElementById('merge-name');
    if (ma && input) input.value = ma.name;

  } else if (action === 'use-name-b') {
    const mb = getMachine(state.admin.mergeModal.bId);
    const input = document.getElementById('merge-name');
    if (mb && input) input.value = mb.name;

  } else if (action === 'cancel-merge') {
    state.admin.mergeModal = null;
    render();

  } else if (action === 'cancel-merge-overlay') {
    if (e.target !== el) return;
    state.admin.mergeModal = null;
    render();

  } else if (action === 'confirm-merge') {
    const mm = state.admin.mergeModal;
    const ma = getMachine(mm.aId), mb = getMachine(mm.bId);
    if (!ma || !mb) { state.admin.mergeModal = null; render(); return; }
    const nameInput = document.getElementById('merge-name');
    const notesInput = document.getElementById('merge-notes');
    const merged = {
      id: ma.id,
      name: nameInput.value.trim() || ma.name,
      globalNotes: notesInput.value,
      updatedAt: Date.now(),
      locations: mm.locations,
    };
    state.machines = state.machines.filter(m => m.id !== ma.id && m.id !== mb.id);
    state.machines.push(merged);
    save();
    state.admin.mergeModal = null;
    state.admin.manualA = '';
    state.admin.manualB = '';
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

// Admin dropdowns (import row decisions, manual merge picks)
document.addEventListener('change', function(e) {
  const el = e.target;
  if (el.dataset.action === 'set-import-decision') {
    const row = state.admin.importRows?.[Number(el.dataset.index)];
    if (!row) return;
    const val = el.value;
    if (val === 'create' || val === 'skip') {
      row.decision = val;
      row.matchId = null;
    } else if (val.startsWith('merge:')) {
      row.decision = 'merge';
      row.matchId = val.slice('merge:'.length);
    }
    render();
  } else if (el.dataset.action === 'set-manual-a') {
    state.admin.manualA = el.value;
  } else if (el.dataset.action === 'set-manual-b') {
    state.admin.manualB = el.value;
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
