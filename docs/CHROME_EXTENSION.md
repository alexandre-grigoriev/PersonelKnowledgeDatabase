# Chrome Extension — Scientific KB Clipper (CHROME_EXTENSION.md)

## Overview
Chrome extension (Manifest V3) that allows from any web page to:
1. Detect whether the page is a scientific article or contains a PDF link
2. Display a popup to choose the target KB and the action
3. Capture the text content of the page OR download the linked PDF
4. Send to the local backend (http://localhost:3000)

## Files
```
chrome-extension/
├── manifest.json
├── background.js       ← service worker (download + API call)
├── content.js          ← injected into the page (detection + extraction)
├── popup.html          ← popup UI
├── popup.js            ← popup logic
├── styles/popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## manifest.json
```json
{
  "manifest_version": 3,
  "name": "Scientific KB Clipper",
  "version": "1.0.0",
  "description": "Capture scientific articles and PDFs into your knowledge base",
  "permissions": [
    "activeTab",
    "downloads",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "http://localhost:3000/*",
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    }
  }
}
```

## content.js — Page detection

Executed in every page. Detects and extracts automatically.

### PDF detection
```javascript
/**
 * Searches for PDF links on the page (direct links, "Download PDF" buttons,
 * Highwire, Dublin Core, OpenGraph metadata).
 * @returns {Array<{url: string, label: string, confidence: number}>}
 */
function detectPdfLinks() {
  const results = [];

  // 1. Highwire Press <meta> tags (Google Scholar, PubMed, etc.)
  const citationPdf = document.querySelector('meta[name="citation_pdf_url"]');
  if (citationPdf) results.push({
    url: citationPdf.content,
    label: 'PDF (Highwire)',
    confidence: 0.99
  });

  // 2. <a> links pointing to .pdf
  document.querySelectorAll('a[href$=".pdf"], a[href*="pdf"]').forEach(a => {
    if (a.href && a.href.startsWith('http')) {
      results.push({ url: a.href, label: a.textContent.trim() || 'PDF', confidence: 0.85 });
    }
  });

  // 3. "Download PDF" buttons (text-based)
  document.querySelectorAll('a, button').forEach(el => {
    if (/download\s+pdf|full\s+text\s+pdf/i.test(el.textContent)) {
      const href = el.href || el.dataset.href;
      if (href) results.push({ url: href, label: 'Download PDF', confidence: 0.9 });
    }
  });

  return results;
}
```

### Page metadata extraction
```javascript
/**
 * Extracts bibliographic metadata from meta tags.
 * Compatible with Highwire Press, Dublin Core, OpenGraph.
 * @returns {PageMeta}
 */
function extractPageMeta() {
  const get = (selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.content || el.getAttribute('content') || el.textContent;
    }
    return null;
  };

  return {
    title: get(['meta[name="citation_title"]', 'meta[property="og:title"]', 'title'])
           || document.title,
    authors: [...document.querySelectorAll('meta[name="citation_author"]')]
             .map(m => m.content),
    doi: get(['meta[name="citation_doi"]', 'meta[name="dc.identifier"]']),
    year: get(['meta[name="citation_year"]', 'meta[name="citation_date"]'])?.slice(0, 4),
    journal: get(['meta[name="citation_journal_title"]', 'meta[name="dc.source"]']),
    abstract: get(['meta[name="dc.description"]', 'meta[name="description"]']),
    pageUrl: window.location.href
  };
}

/**
 * Extracts the main text of the page (article body).
 * Uses a text-density heuristic.
 * @returns {string}
 */
function extractMainText() {
  // Prefer common semantic selectors
  const selectors = [
    'article', '[role="main"]', '.article-body', '.fulltext',
    '#article-content', '.paper-content', 'main'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 500) return el.textContent.trim();
  }
  // Fallback: densest text block
  return document.body.innerText.trim();
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCAN_PAGE') {
    sendResponse({
      pdfLinks: detectPdfLinks(),
      meta: extractPageMeta(),
      hasText: document.body.innerText.length > 200
    });
  }
  if (msg.type === 'EXTRACT_TEXT') {
    sendResponse({ text: extractMainText(), meta: extractPageMeta() });
  }
});
```

## popup.js — Popup logic

### Popup state
```javascript
let pageInfo = null;       // result of the page scan
let kbList = [];           // list of available KBs
let selectedKbId = localStorage.getItem('lastKbId') || null;
let selectedPdfUrl = null;

// On popup load
document.addEventListener('DOMContentLoaded', async () => {
  await loadKbList();
  await scanCurrentPage();
  renderUI();
});
```

### Loading KBs from the local backend
```javascript
async function loadKbList() {
  try {
    const res = await fetch('http://localhost:3000/api/kb');
    kbList = await res.json();
  } catch (e) {
    showError('Backend unavailable. Open the Scientific KB application.');
  }
}
```

### Available popup actions
1. **"Save PDF"**: if a PDF link is detected → service worker downloads + sends
2. **"Capture page"**: extracts HTML text → sends as text document
3. **Target KB selector**: dropdown with available KBs

## background.js — Service Worker

```javascript
/**
 * Downloads a PDF from a URL and sends it to the backend.
 * @param {string} pdfUrl
 * @param {string} kbId
 * @param {Object} meta
 */
async function downloadAndIngest(pdfUrl, kbId, meta) {
  // 1. Download PDF as blob
  const response = await fetch(pdfUrl);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const blob = await response.blob();

  // 2. Build FormData
  const formData = new FormData();
  formData.append('pdf', blob, meta.title ? `${meta.title}.pdf` : 'document.pdf');
  formData.append('kbId', kbId);
  formData.append('meta', JSON.stringify(meta));
  formData.append('source', 'chrome-extension');
  formData.append('sourceUrl', pdfUrl);

  // 3. Send to local backend
  const res = await fetch('http://localhost:3000/api/ingest', {
    method: 'POST',
    body: formData
  });
  return res.json();  // { jobId, status: 'queued' }
}

/**
 * Sends text content (web page) to the backend as a document.
 * @param {string} text
 * @param {string} kbId
 * @param {Object} meta
 */
async function ingestPageText(text, kbId, meta) {
  const res = await fetch('http://localhost:3000/api/ingest/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, kbId, meta, source: 'chrome-extension' })
  });
  return res.json();
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'INGEST_PDF') {
    downloadAndIngest(msg.pdfUrl, msg.kbId, msg.meta)
      .then(r => sendResponse({ success: true, jobId: r.jobId }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;  // async response
  }
  if (msg.type === 'INGEST_TEXT') {
    ingestPageText(msg.text, msg.kbId, msg.meta)
      .then(r => sendResponse({ success: true, jobId: r.jobId }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});
```

## popup.html — UI structure
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="styles/popup.css">
</head>
<body style="width:340px; min-height:200px;">
  <header>
    <img src="icons/icon48.png" width="24">
    <span>Scientific KB Clipper</span>
    <span id="status-dot"></span>  <!-- green if backend OK, red otherwise -->
  </header>

  <!-- KB selector -->
  <section id="kb-selector">
    <label>Target Knowledge Base:</label>
    <select id="kb-select"></select>
  </section>

  <!-- Scan result -->
  <section id="scan-result">
    <!-- Filled dynamically -->
  </section>

  <!-- Actions -->
  <section id="actions">
    <button id="btn-pdf" class="primary" style="display:none">
      ⬇ Save PDF
    </button>
    <button id="btn-text" class="secondary" style="display:none">
      📄 Capture page
    </button>
  </section>

  <!-- Progress -->
  <section id="progress" style="display:none">
    <div class="progress-bar"><div id="progress-fill"></div></div>
    <span id="progress-label">Waiting...</span>
  </section>

  <script src="popup.js"></script>
</body>
</html>
```

## Backend endpoints for the extension (routes/ingest.js)

```
POST /api/ingest
  Content-Type: multipart/form-data
  Fields: pdf (file), kbId, meta (JSON string), source, sourceUrl
  Response: { jobId, status: 'queued', docId }

POST /api/ingest/text
  Content-Type: application/json
  Body: { text, kbId, meta: {title, authors, doi, year, pageUrl}, source }
  Response: { jobId, status: 'queued', docId }

GET /api/ingest/jobs/:jobId
  Response: { jobId, status, step, progress, error }
```

## Security
- The extension communicates only with `http://localhost:3000` — never with external servers
- No user data is sent to third-party servers
- CORS is configured on the backend to accept only requests from the extension:
  ```javascript
  app.use(cors({ origin: (origin, cb) => {
    if (!origin || origin.startsWith('chrome-extension://')) cb(null, true);
    else cb(new Error('Not allowed'));
  }}));
  ```
