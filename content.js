chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getEmailText') {
    sendResponse({ text: extractEmailText() });
  }
  return true;
});

function extractEmailText() {
  const host = location.hostname;

  if (host === 'mail.google.com') {
    return extractGmail();
  }
  if (
    host === 'outlook.live.com' ||
    host === 'outlook.office.com' ||
    host === 'outlook.cloud.microsoft'
  ) {
    return extractOutlook();
  }
  return '';
}

function extractGmail() {
  const subject =
    document.querySelector('h2.hP')?.innerText ||
    document.querySelector('[data-thread-perm-id] h2')?.innerText ||
    '';

  // Try opened email body selectors in order of specificity
  const bodySelectors = [
    '.a3s.aiL',
    '.a3s.aXjCH',
    '.ii.gt .a3s',
    '[data-message-id] .a3s',
    '.gs .ii .a3s',
  ];

  let body = '';
  for (const sel of bodySelectors) {
    const el = document.querySelector(sel);
    if (el) {
      body = el.innerText.trim();
      break;
    }
  }

  return [subject ? `Subject: ${subject}` : '', body].filter(Boolean).join('\n\n');
}

function extractOutlook() {
  const subject =
    document.querySelector('[class*="subject"]')?.innerText ||
    document.querySelector('[aria-label*="subject" i]')?.innerText ||
    '';

  const bodySelectors = [
    '[aria-label="Message body"]',
    '.ReadingPaneContents',
    '[class*="readingPane"] [class*="body"]',
    '.allowTextSelection',
    'div[id*="UniqueMessageBody"]',
  ];

  let body = '';
  for (const sel of bodySelectors) {
    const el = document.querySelector(sel);
    if (el) {
      body = el.innerText.trim();
      break;
    }
  }

  return [subject ? `Subject: ${subject}` : '', body].filter(Boolean).join('\n\n');
}
