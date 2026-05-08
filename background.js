chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractEvent') {
    handleExtraction(message.text, message.apiKey)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.action === 'addToCalendar') {
    chrome.runtime.sendNativeMessage(
      'com.eventlens.calendar',
      { action: 'addEvent', event: message.event, alerts: message.alerts },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response ?? { success: false, error: 'No response from native host' });
        }
      }
    );
    return true;
  }
});

async function handleExtraction(text, apiKey) {
  const cacheKey = 'cache_' + fnv1a(text);
  const stored = await chrome.storage.local.get(cacheKey);
  if (stored[cacheKey]) return stored[cacheKey];

  const data = await extractEventFromText(text, apiKey);
  chrome.storage.local.set({ [cacheKey]: data });
  return data;
}

// FNV-1a 32-bit hash — fast, good distribution, collision risk negligible for email texts
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

async function extractEventFromText(text, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extract ALL actionable calendar entries from this email and return them as a JSON array. Include:
- Meetings, calls, or events with a specific date/time
- Deadlines, expiry dates, or "action required by" dates (e.g. "sign by May 17" → a reminder event on that date)
- Any other date that the recipient should have on their calendar

If there is truly nothing date-related in the email, return an empty array [].

Each element must have exactly these fields:
{
  "title": "string",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM (24h)",
  "end_time": "HH:MM (24h)",
  "timezone": "IANA timezone string",
  "location": "string or null",
  "meeting_url": "string or null",
  "description": "string or null"
}
Rules: if end_time is missing, set it to 1 hour after start_time. If timezone is missing, use America/Los_Angeles. For deadline-style events with no time, use 09:00 as start_time. No prose, no markdown, JSON array only.

Email:
${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `API error ${response.status}`);
  }

  const payload = await response.json();
  const raw = payload.content[0].text;
  const extracted = extractFirstJSON(raw);
  if (!extracted) throw new Error('Claude returned an unexpected format.');
  const parsed = JSON.parse(extracted);
  // Normalise: single object → wrap in array
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Walk the string to find the first balanced JSON value (array or object),
// correctly handling strings and escape sequences.
function extractFirstJSON(text) {
  const arrIdx = text.indexOf('[');
  const objIdx = text.indexOf('{');
  if (arrIdx === -1 && objIdx === -1) return null;

  let start, open, close;
  if (arrIdx === -1 || (objIdx !== -1 && objIdx < arrIdx)) {
    start = objIdx; open = '{'; close = '}';
  } else {
    start = arrIdx; open = '['; close = ']';
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
