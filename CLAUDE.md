# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build    # compile popup + options page to dist/
npm run watch    # rebuild on every file save (dev workflow)
```

There are no tests and no linter configured.

After any build, reload the extension in Chrome: `chrome://extensions` → click the ↺ icon on the Event Lens card.

## Architecture

This is a Manifest V3 Chrome extension with no backend. Three independent JS contexts communicate via Chrome messaging:

**content.js** (injected into Gmail / Outlook tabs)
Reads the visible email body from the DOM and returns it as plain text when the popup requests it. Has separate selector paths for Gmail (`.a3s.aiL`) and Outlook (`[aria-label="Message body"]` etc.). If the tab was open before the extension loaded, `popup.jsx` programmatically re-injects it via `chrome.scripting.executeScript` before retrying.

**background.js** (service worker, always-on)
Receives `{ action: 'extractEvent', text, apiKey }` from the popup, calls the Anthropic API (`claude-sonnet-4-5`), and returns a normalised array of event objects. JSON is extracted from Claude's response using a character-walk balanced-brace parser (`extractFirstJSON`) rather than a regex, because greedy regexes break when field values contain `}`. Always returns an array; wraps a bare object if Claude returns one.

**src/popup.jsx** + **src/options.jsx** (React 18, compiled by Vite)
Two separate entry points (`popup.html`, `options.html`) built into `dist/`. Vite bundles the React code; `vite-plugin-static-copy` copies `manifest.json`, `background.js`, and `content.js` straight into `dist/` unchanged. Chrome loads the extension from `dist/`.

## Data flow

```
popup.jsx
  → chrome.tabs.sendMessage      → content.js  (get email text)
  → chrome.runtime.sendMessage   → background.js → Anthropic API
  → chrome.tabs.create(data:text/calendar URI)   → Apple Calendar
```

## Storage schema (`chrome.storage.local`)

| Key | Type | Description |
|---|---|---|
| `apiKey` | string | Anthropic API key |
| `eventTypes` | `EventType[]` | Full list; seeded from `DEFAULT_EVENT_TYPES` on first install |
| `recentTypeIds` | `string[]` | Up to 3 most recently used non-Other type IDs |

`EventType`: `{ id, name, alerts: number[] (minutes), permanent: boolean }`. The `Other` type has `permanent: true` and cannot be deleted. Shared constants and conversion utilities live in `src/eventTypes.js`.

## Popup view states

`boot → settings | loading → picker (multi-event) | main | empty (no events found) | error`

- **empty**: shown when Claude returns `[]`; lets the user type a manual description which is sent back to Claude for a second extraction pass.
- **picker**: shown when Claude returns >1 event; user selects one before proceeding to **main**.
- Type grid in **main**: always shows Other + up to 3 non-Other types (recent first, padded with definition-order types). A **More ▾** button reveals the rest inline when more than 3 non-Other types exist.
