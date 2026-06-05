/**
 * Mesynx AI Connector — ISOLATED-world content script
 *
 * Runs in Chrome's extension isolated world so it has access to chrome.*.
 * Its only job is to bridge between:
 *   ← window.postMessage  (from the MAIN-world content script / page)
 *   → chrome.runtime.sendMessage  (to the background service worker)
 *
 * and then relay the response back the same way in reverse.
 */
'use strict';

window.addEventListener('message', (event) => {
  // Ignore messages from other frames or windows.
  if (event.source !== window) return;

  const d = event.data;
  if (!d || !d.__mesynxStartAuth) return;

  const { id } = d;

  chrome.runtime.sendMessage({ type: 'START_AUTH' }, (response) => {
    // chrome.runtime.lastError must be consumed immediately inside the callback.
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
