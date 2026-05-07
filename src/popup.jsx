import React, { useState, useEffect } from 'react';
import { DEFAULT_EVENT_TYPES, formatAlert } from './eventTypes.js';

// Standard alert chips always shown in the popup regardless of type
const STANDARD_ALERTS = [
  { label: '20 min before', minutes: 20 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
  { label: '1 week before', minutes: 10080 },
];

// ── ICS generation ───────────────────────────────────────────────────────────

function toICSDatetime(date, time) {
  const [Y, M, D] = date.split('-');
  const [h, m] = time.split(':');
  return `${Y}${M}${D}T${h}${m}00`;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}@eventlens`;
}

function buildICS(event, alertMinutes) {
  const {
    title,
    date,
    start_time,
    end_time,
    timezone = 'America/Los_Angeles',
    location,
    meeting_url,
    description,
  } = event;

  const dtstart = toICSDatetime(date, start_time);
  const dtend = toICSDatetime(date, end_time);

  const descParts = [description, meeting_url ? `Meeting URL: ${meeting_url}` : '']
    .filter(Boolean).join('\\n');

  const alarms = alertMinutes
    .map(min => `BEGIN:VALARM\r\nTRIGGER:-PT${min}M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM`)
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Event Lens//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTART;TZID=${timezone}:${dtstart}`,
    `DTEND;TZID=${timezone}:${dtend}`,
    `SUMMARY:${escICS(title || 'Untitled Event')}`,
    location ? `LOCATION:${escICS(location)}` : '',
    descParts ? `DESCRIPTION:${descParts}` : '',
    alarms,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function escICS(str) {
  return str.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('boot'); // boot | settings | loading | picker | main | error
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('Reading email…');

  // Event types (loaded from storage)
  const [allTypes, setAllTypes] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState(null);
  const [showMore, setShowMore] = useState(false);

  // Extracted calendar events
  const [events, setEvents] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Alert selection for current event
  const [alerts, setAlerts] = useState([60]);

  const [errorMsg, setErrorMsg] = useState('');

  // ── Boot: load storage then start extraction ─────────────────────────────

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'eventTypes', 'recentTypeIds'], res => {
      const types = res.eventTypes ?? DEFAULT_EVENT_TYPES;
      const recent = res.recentTypeIds ?? [];

      // Persist defaults on first install
      if (!res.eventTypes) {
        chrome.storage.local.set({ eventTypes: DEFAULT_EVENT_TYPES, recentTypeIds: [] });
      }

      const otherType = types.find(t => t.permanent);
      setAllTypes(types);
      setRecentIds(recent);
      setSelectedTypeId(otherType?.id ?? null);
      setAlerts(otherType?.alerts ?? [60]);

      if (res.apiKey) {
        setApiKey(res.apiKey);
        // Pass types directly: state hasn't flushed yet at this point in the closure
        run(res.apiKey, types);
      } else {
        setView('settings');
      }
    });
  }, []);

  // ── Core extraction flow ─────────────────────────────────────────────────

  // typesArg: explicit types array for the initial call before state flushes;
  // subsequent calls (retry, saveKey) omit it and use allTypes from closure.
  async function run(key, typesArg) {
    const types = typesArg ?? allTypes;
    setView('loading');
    setStatusMsg('Reading email…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      let emailRes;
      try {
        emailRes = await sendToTab(tab.id, { action: 'getEmailText' });
      } catch (connErr) {
        if (
          connErr.message.includes('Receiving end does not exist') ||
          connErr.message.includes('Could not establish connection')
        ) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          emailRes = await sendToTab(tab.id, { action: 'getEmailText' });
        } else {
          throw connErr;
        }
      }

      if (!emailRes?.text?.trim()) {
        throw new Error('No email content found. Open an email and try again.');
      }

      setStatusMsg('Analysing with Claude…');

      const bgRes = await sendToBackground({ action: 'extractEvent', text: emailRes.text, apiKey: key });
      if (!bgRes.success) throw new Error(bgRes.error);

      const evts = bgRes.data;
      const otherType = types.find(t => t.permanent);

      setEvents(evts);
      setSelectedIndex(0);
      setSelectedTypeId(otherType?.id ?? null);
      setAlerts(otherType?.alerts ?? [60]);
      setShowMore(false);
      setView(evts.length > 1 ? 'picker' : 'main');
    } catch (err) {
      setErrorMsg(err.message);
      setView('error');
    }
  }

  // ── Type selection ───────────────────────────────────────────────────────

  function selectType(type) {
    setSelectedTypeId(type.id);
    setAlerts(type.alerts);
    setShowMore(false);
  }

  // ── Event picking (multi-event) ──────────────────────────────────────────

  function pickEvent(index) {
    setSelectedIndex(index);
    const otherType = allTypes.find(t => t.permanent);
    setSelectedTypeId(otherType?.id ?? null);
    setAlerts(otherType?.alerts ?? [60]);
    setShowMore(false);
    setView('main');
  }

  // ── Alert toggling ───────────────────────────────────────────────────────

  function toggleAlert(minutes) {
    setAlerts(prev =>
      prev.includes(minutes) ? prev.filter(m => m !== minutes) : [...prev, minutes]
    );
  }

  // ── Add to calendar + record recency ─────────────────────────────────────

  function addToCalendar() {
    const ics = buildICS(events[selectedIndex], alerts);
    chrome.tabs.create({ url: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` });

    // Track recency (permanent "Other" type is excluded)
    const type = allTypes.find(t => t.id === selectedTypeId);
    if (type && !type.permanent) {
      const updated = [selectedTypeId, ...recentIds.filter(id => id !== selectedTypeId)].slice(0, 3);
      setRecentIds(updated);
      chrome.storage.local.set({ recentTypeIds: updated });
    }
  }

  // ── Settings: save API key ───────────────────────────────────────────────

  function saveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    chrome.storage.local.set({ apiKey: trimmed }, () => {
      setApiKey(trimmed);
      setKeyInput('');
      run(trimmed); // allTypes is in state by now
    });
  }

  // ── Recency-based type visibility ────────────────────────────────────────

  const otherType = allTypes.find(t => t.permanent);
  const nonOther = allTypes.filter(t => !t.permanent);

  let visibleTypes, moreTypes;
  if (allTypes.length <= 3) {
    visibleTypes = allTypes;
    moreTypes = [];
  } else {
    // Valid recent = existing non-other types, up to 3
    const validRecentIds = recentIds.filter(id => nonOther.some(t => t.id === id));
    const recentTypes = validRecentIds
      .slice(0, 3)
      .map(id => allTypes.find(t => t.id === id))
      .filter(Boolean);
    const recentIdSet = new Set(recentTypes.map(t => t.id));
    moreTypes = nonOther.filter(t => !recentIdSet.has(t.id));
    visibleTypes = [...recentTypes, ...(otherType ? [otherType] : [])];
  }

  // Alert chips: standard set + any type-specific alerts not already in standard
  const standardMinuteSet = new Set(STANDARD_ALERTS.map(o => o.minutes));
  const selectedType = allTypes.find(t => t.id === selectedTypeId);
  const extraChips = (selectedType?.alerts ?? [])
    .filter(m => !standardMinuteSet.has(m))
    .map(m => ({ label: formatAlert(m), minutes: m }));
  const alertChips = [...STANDARD_ALERTS, ...extraChips];

  // ── Views ────────────────────────────────────────────────────────────────

  if (view === 'boot') return null;

  if (view === 'settings') {
    return (
      <div className="container">
        <Header onSettings={null} />
        <div className="settings-body">
          <p className="settings-desc">Paste your Anthropic API key to start extracting events from emails.</p>
          <input
            className="key-input"
            type="password"
            placeholder="sk-ant-…"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveKey()}
            autoFocus
          />
          <button className="btn-primary" onClick={saveKey} disabled={!keyInput.trim()}>
            Save &amp; Continue
          </button>
          <p className="settings-note">
            Stored locally in chrome.storage.local — never sent anywhere except Anthropic.
          </p>
        </div>
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <div className="container">
        <Header onSettings={() => setView('settings')} />
        <div className="loading-body">
          <div className="spinner" />
          <p className="loading-msg">{statusMsg}</p>
        </div>
      </div>
    );
  }

  if (view === 'picker') {
    return (
      <div className="container">
        <Header onSettings={() => setView('settings')} />
        <div className="picker-header">
          <span className="picker-count">{events.length} events found — pick one</span>
        </div>
        <div className="picker-list">
          {events.map((ev, i) => (
            <button key={i} className="event-card" onClick={() => pickEvent(i)}>
              <div className="event-card-info">
                <div className="event-card-title">{ev.title || 'Untitled Event'}</div>
                <div className="event-card-meta">
                  {[ev.date, ev.start_time ? `${ev.start_time}${ev.end_time ? ` – ${ev.end_time}` : ''}` : null]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="event-card-arrow">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div className="container">
        <Header onSettings={() => setView('settings')} />
        <div className="error-body">
          <p className="error-icon">⚠</p>
          <p className="error-msg">{errorMsg}</p>
          <button className="btn-secondary" onClick={() => run(apiKey)}>Try Again</button>
        </div>
      </div>
    );
  }

  // ── main ─────────────────────────────────────────────────────────────────
  const ev = events[selectedIndex] ?? {};

  return (
    <div className="container">
      <Header onSettings={() => setView('settings')} />

      {events.length > 1 && (
        <button className="back-btn" onClick={() => setView('picker')}>
          ‹ All events ({events.length})
        </button>
      )}

      <div className="fields">
        <Field label="Title" value={ev.title} />
        <Field label="Date" value={ev.date} />
        <Field
          label="Time"
          value={ev.start_time && ev.end_time ? `${ev.start_time} – ${ev.end_time}` : ev.start_time}
        />
        <Field label="Timezone" value={ev.timezone} />
        <Field label="Location" value={ev.location} />
        <Field label="Meeting URL" value={ev.meeting_url} isLink />
        <Field label="Description" value={ev.description} multi />
      </div>

      <div className="section">
        <div className="section-label">Event Type</div>
        <div className="type-grid">
          {visibleTypes.map(t => (
            <button
              key={t.id}
              className={`type-btn${selectedTypeId === t.id ? ' active' : ''}`}
              onClick={() => selectType(t)}
            >
              {t.name}
            </button>
          ))}
          {moreTypes.length > 0 && !showMore && (
            <button className="type-btn type-btn-more" onClick={() => setShowMore(true)}>
              More ▾
            </button>
          )}
          {showMore && moreTypes.map(t => (
            <button
              key={t.id}
              className={`type-btn${selectedTypeId === t.id ? ' active' : ''}`}
              onClick={() => selectType(t)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label">Alerts</div>
        <div className="chips">
          {alertChips.map(({ label, minutes }) => (
            <button
              key={minutes}
              className={`chip${alerts.includes(minutes) ? ' active' : ''}`}
              onClick={() => toggleAlert(minutes)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn-primary add-btn" onClick={addToCalendar}>
        Add to Apple Calendar
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ onSettings }) {
  return (
    <div className="header">
      <span className="logo"><span className="logo-icon">◈</span> Event Lens</span>
      {onSettings && (
        <button className="gear-btn" onClick={onSettings} title="Settings">⚙</button>
      )}
    </div>
  );
}

function Field({ label, value, isLink, multi }) {
  if (!value) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {isLink ? (
        <a className="field-value field-link" href={value} target="_blank" rel="noopener noreferrer">{value}</a>
      ) : (
        <span className={`field-value${multi ? ' multi' : ''}`}>{value}</span>
      )}
    </div>
  );
}
