/**
 * chrome-extension/background.js
 * Manifest V3 service worker.
 * Handles PDF download + backend ingestion on behalf of the popup.
 * All communication with the backend is strictly to http://localhost:3000.
 */

'use strict';

const API_BASE = 'http://localhost:3000/api';

/**
 * Downloads a PDF from a remote URL and POSTs it to the backend as multipart.
 * @param {string} pdfUrl
 * @param {string} kbId
 * @param {Object} meta - Bibliographic metadata from the page
 * @returns {Promise<{ jobId: string, status: string }>}
 */
async function downloadAndIngest(pdfUrl, kbId, meta) {
  const response = await fetch(pdfUrl);
  if (!response.ok) throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
  const blob = await response.blob();

  const filename = meta.title ? `${meta.title.slice(0, 80)}.pdf` : 'document.pdf';

  const formData = new FormData();
  formData.append('pdf', blob, filename);
  formData.append('kbId', kbId);
  formData.append('meta', JSON.stringify(meta));
  formData.append('source', 'chrome-extension');
  formData.append('sourceUrl', pdfUrl);

  const res = await fetch(`${API_BASE}/ingest`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Backend ingest failed: ${res.status}`);
  return res.json();
}

/**
 * Sends captured page text to the backend text ingestion endpoint.
 * @param {string} text
 * @param {string} kbId
 * @param {Object} meta
 * @returns {Promise<{ jobId: string, status: string }>}
 */
async function ingestPageText(text, kbId, meta) {
  const res = await fetch(`${API_BASE}/ingest/text`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, kbId, meta, source: 'chrome-extension' }),
  });
  if (!res.ok) throw new Error(`Backend ingest/text failed: ${res.status}`);
  return res.json();
}

/**
 * Polls job status until done or failed.
 * Sends progress updates back to the popup via chrome.tabs messaging.
 * @param {string} jobId
 * @param {string} kbId
 * @param {number} tabId
 */
async function pollJobStatus(jobId, kbId, tabId) {
  const maxAttempts = 120; // 10 min at 5 s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res  = await fetch(`${API_BASE}/ingest/jobs/${jobId}?kbId=${kbId}`);
      const data = await res.json();
      chrome.tabs.sendMessage(tabId, { type: 'JOB_PROGRESS', data }).catch(() => {});
      if (data.status === 'done' || data.status === 'failed') return;
    } catch { /* backend might be briefly unavailable */ }
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'INGEST_PDF') {
    downloadAndIngest(msg.pdfUrl, msg.kbId, msg.meta)
      .then(r => {
        sendResponse({ success: true, jobId: r.jobId, docId: r.docId });
        if (r.jobId && sender.tab?.id) pollJobStatus(r.jobId, msg.kbId, sender.tab.id);
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async sendResponse
  }

  if (msg.type === 'INGEST_TEXT') {
    ingestPageText(msg.text, msg.kbId, msg.meta)
      .then(r => {
        sendResponse({ success: true, jobId: r.jobId, docId: r.docId });
        if (r.jobId && sender.tab?.id) pollJobStatus(r.jobId, msg.kbId, sender.tab.id);
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
