# Extension Chrome — Scientific KB Clipper (CHROME_EXTENSION.md)

## Vue d'ensemble
Extension Chrome (Manifest V3) permettant depuis n'importe quelle page web de :
1. Détecter si la page est un article scientifique ou contient un lien PDF
2. Afficher un popup pour choisir la KB cible et l'action
3. Capturer le contenu textuel de la page OU télécharger le PDF lié
4. Envoyer au backend local (http://localhost:3000)

## Fichiers
```
chrome-extension/
├── manifest.json
├── background.js       ← service worker (téléchargement + API call)
├── content.js          ← injecté dans la page (détection + extraction)
├── popup.html          ← UI du popup
├── popup.js            ← logique popup
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
  "description": "Capture articles scientifiques et PDFs dans votre knowledge base",
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

## content.js — Détection de la page

Exécuté dans chaque page. Détecte et extrait automatiquement.

### Détection PDF
```javascript
/**
 * Cherche des liens PDF dans la page (liens directs, boutons "Download PDF",
 * métadonnées Highwire, Dublin Core, OpenGraph).
 * @returns {Array<{url: string, label: string, confidence: number}>}
 */
function detectPdfLinks() {
  const results = [];

  // 1. Balises <meta> Highwire Press (Google Scholar, PubMed, etc.)
  const citationPdf = document.querySelector('meta[name="citation_pdf_url"]');
  if (citationPdf) results.push({
    url: citationPdf.content,
    label: 'PDF (Highwire)',
    confidence: 0.99
  });

  // 2. Liens <a> pointant vers .pdf
  document.querySelectorAll('a[href$=".pdf"], a[href*="pdf"]').forEach(a => {
    if (a.href && a.href.startsWith('http')) {
      results.push({ url: a.href, label: a.textContent.trim() || 'PDF', confidence: 0.85 });
    }
  });

  // 3. Boutons "Download PDF" (texte)
  document.querySelectorAll('a, button').forEach(el => {
    if (/download\s+pdf|télécharger\s+pdf|full\s+text\s+pdf/i.test(el.textContent)) {
      const href = el.href || el.dataset.href;
      if (href) results.push({ url: href, label: 'Download PDF', confidence: 0.9 });
    }
  });

  return results;
}
```

### Extraction des métadonnées de la page
```javascript
/**
 * Extrait les métadonnées bibliographiques depuis les balises meta.
 * Compatible avec Highwire Press, Dublin Core, OpenGraph.
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
 * Extrait le texte principal de la page (article body).
 * Utilise une heuristique de densité de texte.
 * @returns {string}
 */
function extractMainText() {
  // Priorité aux sélecteurs sémantiques courants
  const selectors = [
    'article', '[role="main"]', '.article-body', '.fulltext',
    '#article-content', '.paper-content', 'main'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 500) return el.textContent.trim();
  }
  // Fallback : bloc de texte le plus dense
  return document.body.innerText.trim();
}

// Écouter les messages du popup
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

## popup.js — Logique du popup

### État du popup
```javascript
let pageInfo = null;   // résultat du scan de la page
let kbList = [];       // liste des KBs disponibles
let selectedKbId = localStorage.getItem('lastKbId') || null;
let selectedPdfUrl = null;

// Au chargement du popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadKbList();
  await scanCurrentPage();
  renderUI();
});
```

### Chargement des KBs depuis le backend local
```javascript
async function loadKbList() {
  try {
    const res = await fetch('http://localhost:3000/api/kb');
    kbList = await res.json();
  } catch (e) {
    showError('Backend non disponible. Ouvrez l\'application Scientific KB.');
  }
}
```

### Actions disponibles dans le popup
1. **"Enregistrer le PDF"** : si un lien PDF est détecté → service worker télécharge + envoie
2. **"Capturer la page"** : extrait le texte HTML → envoie comme document texte
3. **Choix de la KB cible** : dropdown avec les KBs disponibles

## background.js — Service Worker

```javascript
/**
 * Télécharge un PDF depuis une URL et l'envoie au backend.
 * @param {string} pdfUrl
 * @param {string} kbId
 * @param {Object} meta
 */
async function downloadAndIngest(pdfUrl, kbId, meta) {
  // 1. Télécharger le PDF en blob
  const response = await fetch(pdfUrl);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const blob = await response.blob();

  // 2. Construire FormData
  const formData = new FormData();
  formData.append('pdf', blob, meta.title ? `${meta.title}.pdf` : 'document.pdf');
  formData.append('kbId', kbId);
  formData.append('meta', JSON.stringify(meta));
  formData.append('source', 'chrome-extension');
  formData.append('sourceUrl', pdfUrl);

  // 3. Envoyer au backend local
  const res = await fetch('http://localhost:3000/api/ingest', {
    method: 'POST',
    body: formData
  });
  return res.json();  // { jobId, status: 'queued' }
}

/**
 * Envoie un contenu textuel (page web) au backend comme document.
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

// Écouter les messages du popup
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

## popup.html — Structure UI
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
    <span id="status-dot"></span>  <!-- vert si backend OK, rouge sinon -->
  </header>

  <!-- Sélecteur de KB -->
  <section id="kb-selector">
    <label>Knowledge Base cible :</label>
    <select id="kb-select"></select>
  </section>

  <!-- Résultat du scan -->
  <section id="scan-result">
    <!-- Rempli dynamiquement -->
  </section>

  <!-- Actions -->
  <section id="actions">
    <button id="btn-pdf" class="primary" style="display:none">
      ⬇ Enregistrer le PDF
    </button>
    <button id="btn-text" class="secondary" style="display:none">
      📄 Capturer la page
    </button>
  </section>

  <!-- Progression -->
  <section id="progress" style="display:none">
    <div class="progress-bar"><div id="progress-fill"></div></div>
    <span id="progress-label">En attente...</span>
  </section>

  <script src="popup.js"></script>
</body>
</html>
```

## Endpoint backend pour l'extension (routes/ingest.js)

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

## Sécurité
- L'extension ne communique qu'avec `http://localhost:3000` — jamais vers l'extérieur
- Pas de données utilisateur envoyées vers des serveurs tiers
- CORS configuré côté backend pour accepter uniquement les requêtes de l'extension :
  ```javascript
  app.use(cors({ origin: (origin, cb) => {
    if (!origin || origin.startsWith('chrome-extension://')) cb(null, true);
    else cb(new Error('Not allowed'));
  }}));
  ```
