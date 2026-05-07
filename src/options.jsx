import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_EVENT_TYPES, minutesToDisplay, displayToMinutes, formatAlert } from './eventTypes.js';
import './options.css';

// ── Storage ──────────────────────────────────────────────────────────────────

function load() {
  return new Promise(resolve => {
    chrome.storage.local.get(['eventTypes', 'recentTypeIds'], res => {
      resolve({
        types: res.eventTypes ?? DEFAULT_EVENT_TYPES,
        recent: res.recentTypeIds ?? [],
      });
    });
  });
}

function persist(types, recent) {
  return new Promise(resolve =>
    chrome.storage.local.set({ eventTypes: types, recentTypeIds: recent }, resolve)
  );
}

function genId() {
  return `type_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [types, setTypes] = useState(null);
  const [recent, setRecent] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    load().then(({ types, recent }) => {
      // Persist defaults on first install
      chrome.storage.local.get('eventTypes', res => {
        if (!res.eventTypes) persist(types, recent);
      });
      setTypes(types);
      setRecent(recent);
    });
  }, []);

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1800);
  }

  async function saveType(updated) {
    const isNew = !types.find(t => t.id === updated.id);
    let newTypes;
    if (isNew) {
      // Insert before "Other"
      const others = types.filter(t => !t.permanent);
      const perm = types.filter(t => t.permanent);
      newTypes = [...others, updated, ...perm];
    } else {
      newTypes = types.map(t => t.id === updated.id ? updated : t);
    }
    await persist(newTypes, recent);
    setTypes(newTypes);
    setEditingId(null);
    setIsAdding(false);
    showFlash(isNew ? 'Event type added.' : 'Changes saved.');
  }

  async function deleteType(id) {
    const newTypes = types.filter(t => t.id !== id);
    const newRecent = recent.filter(rid => rid !== id);
    await persist(newTypes, newRecent);
    setTypes(newTypes);
    setRecent(newRecent);
    showFlash('Event type deleted.');
  }

  if (types === null) {
    return <div className="opt-loading">Loading…</div>;
  }

  const nonOther = types.filter(t => !t.permanent);
  const otherType = types.find(t => t.permanent);

  return (
    <div className="opt-page">
      <header className="opt-header">
        <span className="opt-logo">◈ Event Lens</span>
        <h1 className="opt-title">Event Types</h1>
        <p className="opt-subtitle">
          Customize event types and their default alert times. Changes take effect immediately in the popup.
        </p>
      </header>

      <main className="opt-main">
        <div className="opt-list">
          {nonOther.map(type =>
            editingId === type.id ? (
              <TypeEditor
                key={type.id}
                type={type}
                onSave={saveType}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <TypeRow
                key={type.id}
                type={type}
                onEdit={() => { setIsAdding(false); setEditingId(type.id); }}
                onDelete={() => deleteType(type.id)}
              />
            )
          )}

          {otherType && <TypeRow key={otherType.id} type={otherType} isPermanent />}
        </div>

        <div className="opt-add-area">
          {isAdding ? (
            <TypeEditor
              type={null}
              onSave={saveType}
              onCancel={() => setIsAdding(false)}
            />
          ) : (
            <button
              className="opt-add-btn"
              onClick={() => { setEditingId(null); setIsAdding(true); }}
            >
              + Add Event Type
            </button>
          )}
        </div>
      </main>

      {flash && <div className="opt-flash">{flash}</div>}
    </div>
  );
}

// ── TypeRow ──────────────────────────────────────────────────────────────────

function TypeRow({ type, onEdit, onDelete, isPermanent }) {
  return (
    <div className="opt-row">
      <div className="opt-row-info">
        <div className="opt-row-name">{type.name}</div>
        <div className="opt-row-alerts">
          {type.alerts.map((m, i) => (
            <span key={i} className="opt-alert-badge">{formatAlert(m)}</span>
          ))}
        </div>
      </div>
      <div className="opt-row-actions">
        {isPermanent ? (
          <span className="opt-perm-label">default · cannot delete</span>
        ) : (
          <>
            <button className="opt-btn opt-btn-edit" onClick={onEdit}>Edit</button>
            <button className="opt-btn opt-btn-delete" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── TypeEditor ───────────────────────────────────────────────────────────────

function TypeEditor({ type, onSave, onCancel }) {
  const [name, setName] = useState(type?.name ?? '');
  const [rows, setRows] = useState(() =>
    type?.alerts?.length
      ? type.alerts.map(m => minutesToDisplay(m))
      : [{ value: 1, unit: 'hours' }]
  );
  const [err, setErr] = useState('');

  function addRow() {
    setRows(prev => [...prev, { value: 1, unit: 'hours' }]);
  }

  function removeRow(i) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i, field, val) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  function handleSave() {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (!rows.length) { setErr('Add at least one alert time.'); return; }
    const badRow = rows.find(r => !r.value || Number(r.value) < 1);
    if (badRow) { setErr('All alert values must be at least 1.'); return; }

    onSave({
      id: type?.id ?? genId(),
      name: name.trim(),
      alerts: rows.map(r => displayToMinutes(r.value, r.unit)),
      permanent: false,
    });
  }

  return (
    <div className="opt-editor">
      <div className="opt-editor-row">
        <label className="opt-editor-label">Name</label>
        <input
          className="opt-editor-input"
          type="text"
          placeholder="e.g. Interview"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          autoFocus
        />
      </div>

      <div className="opt-editor-row opt-editor-alerts">
        <label className="opt-editor-label">Alerts</label>
        <div className="opt-alert-builder">
          {rows.map((row, i) => (
            <div key={i} className="opt-alert-row">
              <input
                className="opt-alert-num"
                type="number"
                min="1"
                value={row.value}
                onChange={e => updateRow(i, 'value', e.target.value)}
              />
              <select
                className="opt-alert-unit"
                value={row.unit}
                onChange={e => updateRow(i, 'unit', e.target.value)}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </select>
              <span className="opt-alert-before">before</span>
              <button
                className="opt-alert-remove"
                onClick={() => removeRow(i)}
                title="Remove"
              >×</button>
            </div>
          ))}
          <button className="opt-add-alert-btn" onClick={addRow}>+ Add alert</button>
        </div>
      </div>

      {err && <p className="opt-err">{err}</p>}

      <div className="opt-editor-btns">
        <button className="opt-btn opt-btn-save" onClick={handleSave}>Save</button>
        <button className="opt-btn opt-btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Mount ────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
