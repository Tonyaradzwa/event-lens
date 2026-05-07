chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractEvent') {
    extractEventFromText(message.text, message.apiKey)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

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
          content: `Extract calendar event details from this email. Return ONLY valid JSON with exactly these fields:
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
Rules: if end_time is missing, set it to 1 hour after start_time. If timezone is missing, use America/Los_Angeles. No prose, no markdown, JSON only.

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
  return JSON.parse(extracted);
}

// Walk the string to find the first balanced { ... } block, correctly
// handling strings and escape sequences so that } inside a value doesn't
// prematurely end the match (the old greedy regex broke on those cases).
function extractFirstJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
