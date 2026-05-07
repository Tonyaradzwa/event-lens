# Event Lens

Copying event details from an email into your calendar is tedious — open the email, read the date, open Calendar, create an event, type everything in, set a reminder. Event Lens eliminates that. It reads the open email, sends the text to Claude, and returns a pre-filled calendar event in one click.

Supported email clients: Gmail, Outlook (live.com, office.com, cloud.microsoft).

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Google Chrome**
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)

---

## Setup

**1. Get the code**

```bash
git clone https://github.com/Tonyaradzwa/event-lens.git
cd event-lens
```

Or download and unzip the repository from GitHub.

**2. Install dependencies and build**

```bash
npm install
npm run build
```

This produces a `dist/` folder — the compiled extension Chrome will load.

**3. Load into Chrome**

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder inside the project directory

Pin the Event Lens icon to your toolbar for easy access.

**4. Add your API key**

Click the Event Lens icon, paste your Anthropic API key into the settings screen, and click **Save & Continue**. The key is stored locally in `chrome.storage.local` and is never sent anywhere except Anthropic.

---

## Usage

1. Open an email in Gmail or Outlook
2. Click the **Event Lens** icon
3. Claude extracts the event — review the fields, choose an event type, adjust alert times
4. Click **Add to Apple Calendar**

If an email contains multiple events (e.g. a newsletter with several meetups), a picker screen lists them all. Select one to continue.

**Customize event types and alerts:** right-click the extension icon → **Options**.

---

## Development

To rebuild automatically on every file save:

```bash
npm run watch
```

After each rebuild, click the **↺ reload icon** on the extension card in `chrome://extensions`.

---

## Tech stack

- Manifest V3 Chrome extension
- React 18 (popup and options page, compiled by Vite)
- Vanilla JS for the content script and background service worker
- Claude API (`claude-sonnet-4-5`) for event extraction
- `data:text/calendar` URI to hand off `.ics` files to Apple Calendar
- No backend — API key stored locally, all processing in-browser

---

## Future Work

**1. Chrome Web Store auto-publish**
Publish the extension to the Chrome Web Store as unlisted, with a GitHub Actions workflow that zips `dist/` and calls the Chrome Web Store Publish API on every push to `main`. Installed copies would then auto-update without manual uploads.

**2. Direct Apple Calendar placement**
Replace the `data:text/calendar` URI approach with direct calendar placement via AppleScript or the macOS Calendar URL scheme, removing the intermediate ICS download step entirely.

**3. API response caching**
Cache Claude API responses in `chrome.storage.local`, keyed by a hash of the email page content. Re-opening the extension on the same email would return the cached result instantly. Cache invalidates when page content changes.

**4. Gmail validation**
Extension has only been validated end-to-end on Outlook. Verify the content script DOM selectors work correctly for Gmail's email body structure and confirm the full extraction and calendar creation flow on `mail.google.com`.
