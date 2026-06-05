/**
 * Mesynx AI Connector — ISOLATED-world content script
 *
 * Runs in Chrome's extension isolated world so it has access to chrome.*.
 * Bridges two directions:
 *
 *   1. MAIN world → background  (when the Mesynx AI app calls bridge.connect())
 *      ← window.postMessage from content-app-main.js
 *      → chrome.runtime.sendMessage to background.js
 *
 *   2. Background → MAIN world  (when the popup sends CONNECT_TO_MESYNX)
 *      ← chrome.runtime.onMessage from background.js
 *      → window.postMessage to content-app-main.js
 */
'use strict';

// ─── Direction 1: MAIN world → background (bridge.connect() flow) ────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const d = event.data;
  if (!d || !d.__mesynxStartAuth) return;

  const { id } = d;

  chrome.runtime.sendMessage({ type: 'START_AUTH' }, (response) => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      window.postMessage(
        { __mesynxResultId: id, error: runtimeError.message },
        '*',
      );
      return;
    }

    if (response?.error) {
      window.postMessage(
        { __mesynxResultId: id, error: response.error },
        '*',
      );
    } else {
      window.postMessage(
        { __mesynxResultId: id, payload: response?.payload },
        '*',
      );
    }
  });
});

// ─── Direction 2: Background → MAIN world (popup "Connect" button flow) ──────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'DELIVER_TOKEN') return false;

  const { payload } = message;
  const id = `deliver-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Listen for the result from the MAIN world after it POSTs to the API.
  function handler(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.__mesynxDeliverResultId !== id) return;
    window.removeEventListener('message', handler);
    clearTimeout(timeout);
    sendResponse(event.data.result);
  }

  // Timeout if the MAIN world doesn't respond within 15 seconds.
  const timeout = setTimeout(() => {
    window.removeEventListener('message', handler);
    sendResponse({ ok: false, error: 'Timed out waiting for Mesynx AI to accept the token.' });
  }, 15_000);

  window.addEventListener('message', handler);

  // Hand the token to the MAIN world content script.
  window.postMessage(
    { __mesynxDeliverToken: true, id, payload },
    '*',
  );

  // Keep the message channel open for the async response.
  return true;
});
