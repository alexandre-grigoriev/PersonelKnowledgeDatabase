/**
 * chrome-extension/popup.js
 * Popup UI logic: scans the current tab, loads KB list, and
 * dispatches ingestion requests to the service worker (background.js).
 */

'use strict';

const API_BASE = 'http://localhost:3000/api';

// ─── State ────────────────────────────────────────────────────────────────────

let pageInfo      = null;  // result of SCAN_PAGE from content.js
let kbList        = [];
let selectedKbId  = localStorage.getItem('lastKbId') || null;
let selectedPdfUrl = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const statusDot    = document.getElementById('status-dot');
const kbSelect     = document.getElementById('kb-select');
const scanResult   = document.getElementById('scan-result');
const btnPdf       = document.getElementById('btn-pdf');
const btnText      = document.getElementById('btn-text');
const progressSec  = document.getElementById('progress');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const errorMsg     = document.getElementById('error-msg');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showError(msg) {
  errorMsg.textContent = msg;
}

function setProgress(pct, label) {
  progressSec.style.display = 'block';
  progressFill.style.width  = `${pct}%`;
  progressLabel.textContent = label;
}

function disableActions() {
  btnPdf.disabled  = true;
  btnText.disabled = true;
}

// ─── Backend checks ───────────────────────────────────────────────────────────

/**
 * Fetches the KB list from the backend. Sets statusDot green on success.
 */
async function loadKbList() {
  try {
    const res = await fetch(`${API_BASE}/kb`, { signal: AbortSignal.timeout(3000) });
    kbList = await res.json();
    statusDot.className = 'ok';

    kbSelect.innerHTML = kbList.length
      ? kbList.map(kb => `<option value="${kb.id}"${kb.id === selectedKbId ? ' selected' : ''}>${kb.name}</option>`).join('')
      : '<option value="">No knowledge bases found</option>';

    if (!selectedKbId && kbList.length) selectedKbId = kbList[0].id;
  } catch {
    statusDot.className = 'err';
    showError('Backend unavailable. Open the Scientific KB app first.');
    kbSelect.innerHTML = '<option value="">Backend offline</option>';
  }
}

/**
 * Sends a SCAN_PAGE message to the active tab's content script.
 */
async function scanCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' });
  } catch {
    // Content script not injected (e.g. chrome:// pages)
    pageInfo = { pdfLinks: [], meta: {}, hasText: false };
  }
}

/**
 * Renders the scan results and shows appropriate action buttons.
 */
function renderUI() {
  if (!pageInfo) return;

  const { pdfLinks, meta, hasText } = pageInfo;
  const bestPdf = pdfLinks.sort((a, b) => b.confidence - a.confidence)[0];

  let scanText = '';
  if (bestPdf) {
    scanText = `📄 PDF detected: ${bestPdf.label}`;
    selectedPdfUrl = bestPdf.url;
    btnPdf.style.display = 'block';
  } else {
    scanText = 'No PDF link detected on this page.';
  }
  if (hasText) {
    scanText += (bestPdf ? '\n' : '') + '📝 Page text available for capture.';
    btnText.style.display = 'block';
  }
  if (!bestPdf && !hasText) {
    scanText = 'Nothing capturable on this page.';
  }
  scanResult.textContent = scanText;
}

// ─── Ingestion actions ────────────────────────────────────────────────────────

kbSelect.addEventListener('change', () => {
  selectedKbId = kbSelect.value;
  localStorage.setItem('lastKbId', selectedKbId);
});

btnPdf.addEventListener('click', async () => {
  if (!selectedKbId || !selectedPdfUrl) return;
  disableActions();
  setProgress(5, 'Downloading PDF…');
  showError('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({
    type:   'INGEST_PDF',
    pdfUrl: selectedPdfUrl,
    kbId:   selectedKbId,
    meta:   pageInfo?.meta || {},
  }, (response) => {
    if (response?.success) {
      setProgress(10, `Queued (job: ${response.jobId || 'n/a'})`);
    } else {
      showError(response?.error || 'Failed to start ingestion');
      progressSec.style.display = 'none';
      btnPdf.disabled = false;
    }
  });
});

btnText.addEventListener('click', async () => {
  if (!selectedKbId) return;
  disableActions();
  setProgress(5, 'Extracting page text…');
  showError('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const extracted = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TEXT' }).catch(() => null);
  if (!extracted?.text) {
    showError('Could not extract text from this page.');
    progressSec.style.display = 'none';
    btnText.disabled = false;
    return;
  }

  chrome.runtime.sendMessage({
    type: 'INGEST_TEXT',
    text: extracted.text,
    kbId: selectedKbId,
    meta: extracted.meta || pageInfo?.meta || {},
  }, (response) => {
    if (response?.success) {
      setProgress(10, `Queued (job: ${response.jobId || 'n/a'})`);
    } else {
      showError(response?.error || 'Failed to start ingestion');
      progressSec.style.display = 'none';
      btnText.disabled = false;
    }
  });
});

// Listen for job progress updates pushed from the service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'JOB_PROGRESS' && msg.data) {
    const { status, step, progress } = msg.data;
    if (status === 'done') {
      setProgress(100, '✅ Ingestion complete');
    } else if (status === 'failed') {
      setProgress(0, '');
      showError(`Ingestion failed: ${msg.data.error || 'unknown error'}`);
    } else {
      setProgress(progress || 0, `${step || 'processing'}… ${progress || 0}%`);
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadKbList(), scanCurrentPage()]);
  renderUI();
});
