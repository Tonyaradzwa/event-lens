import React, { useState, useEffect } from 'react';

const ALERT_OPTIONS = [
  { label: '20 min before', minutes: 20 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
  { label: '1 week before', minutes: 10080 },
];

const TYPE_ALERT_DEFAULTS = {
  Travel: [10080, 1440],
  Hangout: [1440, 60],
  Subscription: [10080],
  Other: [60],
};

const EVENT_TYPES = Object.keys(TYPE_ALERT_DEFAULTS);

// ── ICS generation ──────────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, '0');
}

function toICSDatetime(date, time) {
  // date: "YYYY-MM-DD", time: "HH:MM"
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
    .filter(Boolean)
    .join('\\n');

  const alarms = alertMinutes
    .map(
      min => `BEGIN:VALARM
TRIGGER:-PT${min}M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM`
    )
    .join('\r\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Event Lens//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTART;TZID=${timezone}:${dtstart}`,
    `DTEND;TZID=${timezone}:${dtend}`,
    `SUMMARY:${escape(title || 'Untitled Event')}`,
    location ? `LOCATION:${escape(location)}` : '',
    descParts ? `DESCRIPTION:${descParts}` : '',
    alarms,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(l => l !== '')
    .join('\r\n');

  return lines;
}

function escape(str) {
  return str.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n');
}

// ── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('boot'); // boot | settings | loading | picker | main | error
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('Reading email…');
  const [events, setEvents] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [eventType, setEventType] = useState('Other');
  const [alerts, setAlerts] = useState(TYPE_ALERT_DEFAULTS['Other']);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    chrome.storage.local.get(['apiKey'], res => {
      if (res.apiKey) {
        setApiKey(res.apiKey);
        run(res.apiKey);
      } else {
        setView('settings');
      }
    });
  }, []);

  async function run(key) {
    setView('loading');
    setStatusMsg('Reading email…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      // Inject content script if tab was open before the extension loaded
      let emailRes;
      try {
        emailRes = await sendToTab(tab.id, { action: 'getEmailText' });
      } catch (connErr) {
        if (connErr.message.includes('Receiving end does not exist') ||
            connErr.message.includes('Could not establish connection')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
          emailRes = await sendToTab(tab.id, { action: 'getEmailText' });
        } else {
          throw connErr;
        }
      }

      if (!emailRes?.text?.trim()) {
        throw new Error('No email content found. Open an email and try again.');
      }

      setStatusMsg('Analysing with Claude…');

      const bgRes = await sendToBackground({
        action: 'extractEvent',
        text: emailRes.text,
        apiKey: key,
      });

      if (!bgRes.success) throw new Error(bgRes.error);

      const evts = bgRes.data; // always an array
      setEvents(evts);
      setSelectedIndex(0);
      setEventType('Other');
      setAlerts(TYPE_ALERT_DEFAULTS['Other']);
      setView(evts.length > 1 ? 'picker' : 'main');
    } catch (err) {
      setErrorMsg(err.message);
      setView('error');
    }
  }

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

  function selectType(type) {
    setEventType(type);
    setAlerts(TYPE_ALERT_DEFAULTS[type]);
  }

  function toggleAlert(minutes) {
    setAlerts(prev =>
      prev.includes(minutes) ? prev.filter(m => m !== minutes) : [...prev, minutes]
    );
  }

  function pickEvent(index) {
    setSelectedIndex(index);
    setEventType('Other');
    setAlerts(TYPE_ALERT_DEFAULTS['Other']);
    setView('main');
  }

  function addToCalendar() {
    const ics = buildICS(events[selectedIndex], alerts);
    const uri = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    chrome.tabs.create({ url: uri });
  }

  function saveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    chrome.storage.local.set({ apiKey: trimmed }, () => {
      setApiKey(trimmed);
      setKeyInput('');
      run(trimmed);
    });
  }

  // ── Views ────────────────────────────────────────────────────────────────

  if (view === 'boot') return null;

  if (view === 'settings') {
    return (
      <div className="container">
        <Header onSettings={null} />
        <div className="settings-body">
          <p className="settings-desc">
            Paste your Anthropic API key to start extracting events from emails.
          </p>
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
          <button className="btn-secondary" onClick={() => run(apiKey)}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // main
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
          {EVENT_TYPES.map(t => (
            <button
              key={t}
              className={`type-btn${eventType === t ? ' active' : ''}`}
              onClick={() => selectType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label">Alerts</div>
        <div className="chips">
          {ALERT_OPTIONS.map(({ label, minutes }) => (
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

function Header({ onSettings }) {
  return (
    <div className="header">
      <span className="logo">
        <span className="logo-icon">◈</span> Event Lens
      </span>
      {onSettings && (
        <button className="gear-btn" onClick={onSettings} title="Settings">
          ⚙
        </button>
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
        <a className="field-value field-link" href={value} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      ) : (
        <span className={`field-value${multi ? ' multi' : ''}`}>{value}</span>
      )}
    </div>
  );
}
