/**
 * chrome-extension/content.js
 * Content script injected into every page at document_idle.
 * Detects PDF links and extracts bibliographic metadata from the page.
 * Responds to messages from popup.js.
 */

'use strict';

/**
 * Searches for PDF links using Highwire Press meta tags, <a href> patterns,
 * and common "Download PDF" button text.
 * @returns {{ url: string, label: string, confidence: number }[]}
 */
function detectPdfLinks() {
  const results = [];

  // 1. Highwire Press meta tag (Google Scholar, PubMed, journal sites)
  const citationPdf = document.querySelector('meta[name="citation_pdf_url"]');
  if (citationPdf && citationPdf.content) {
    results.push({ url: citationPdf.content, label: 'PDF (Highwire)', confidence: 0.99 });
  }

  // 2. <a> tags pointing at .pdf files or /pdf/ paths
  document.querySelectorAll('a[href$=".pdf"], a[href*="/pdf/"], a[href*="?format=pdf"]').forEach(a => {
    if (a.href && a.href.startsWith('http')) {
      results.push({ url: a.href, label: a.textContent.trim() || 'PDF', confidence: 0.85 });
    }
  });

  // 3. Buttons or links with "Download PDF" text
  document.querySelectorAll('a, button').forEach(el => {
    if (/download\s+pdf|télécharger\s+pdf|full[\s-]text\s+pdf/i.test(el.textContent)) {
      const href = el.href || el.dataset.href;
      if (href && href.startsWith('http')) {
        results.push({ url: href, label: 'Download PDF', confidence: 0.90 });
      }
    }
  });

  // Deduplicate by URL
  const seen = new Set();
  return results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
}

/**
 * Extracts bibliographic metadata from Highwire Press, Dublin Core, and
 * OpenGraph meta tags, falling back to the page title.
 * @returns {{ title: string, authors: string[], doi: string|null, year: string|null, journal: string|null, abstract: string|null, pageUrl: string }}
 */
function extractPageMeta() {
  const get = (...selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.getAttribute('content') || el.textContent.trim() || null;
    }
    return null;
  };

  return {
    title:   get('meta[name="citation_title"]', 'meta[property="og:title"]') || document.title,
    authors: [...document.querySelectorAll('meta[name="citation_author"]')].map(m => m.getAttribute('content')).filter(Boolean),
    doi:     get('meta[name="citation_doi"]', 'meta[name="dc.identifier"]'),
    year:    (get('meta[name="citation_year"]', 'meta[name="citation_date"]') || '').slice(0, 4) || null,
    journal: get('meta[name="citation_journal_title"]', 'meta[name="dc.source"]'),
    abstract: get('meta[name="dc.description"]', 'meta[name="description"]'),
    pageUrl: window.location.href,
  };
}

/**
 * Extracts the main article body text using semantic selectors, falling back
 * to the densest text block on the page.
 * @returns {string}
 */
function extractMainText() {
  const selectors = [
    'article', '[role="main"]', '.article-body', '.fulltext',
    '#article-content', '.paper-content', 'main',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 500) return el.textContent.trim();
  }
  return document.body.innerText.trim();
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCAN_PAGE') {
    sendResponse({
      pdfLinks: detectPdfLinks(),
      meta:     extractPageMeta(),
      hasText:  document.body.innerText.length > 200,
    });
    return true;
  }
  if (msg.type === 'EXTRACT_TEXT') {
    sendResponse({ text: extractMainText(), meta: extractPageMeta() });
    return true;
  }
});
