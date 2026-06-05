/**
 * Mesynx AI Connector — MAIN-world content script
 *
 * Runs in the *page's* JavaScript context (world: "MAIN"), so anything we
 * write to `window` is directly visible to the Mesynx AI React app.
 *
 * Responsibility: expose window.__mesynxAiConnector so the connect screen's
 * polling loop finds it and enables the "Continue with Plaud" button.
 *
 * Communication with chrome.* APIs flows through the companion ISOLATED-world
 * script (content-app-isolated.js) via window.postMessage.
 */
(function injectBridge() {
  'use strict';

  // Idempotent: never replace a bridge that's already installed (e.g. if the
  // script is injected twice due to an SPA soft-navigation).
  if (window.__mesynxAiConnector && window.__mesynxAiConnector.version >= 1) {
    return;
  }

  window.__mesynxAiConnector = {
    /** Bump when the connect() API contract changes. */
    version: 1,

    /**
     * Called by the Mesynx AI app when the user clicks "Continue with Plaud".
     *
     * Sends a postMessage to the ISOLATED world, which relays it to the
     * background service worker.  Resolves with:
     *   { accessToken, apiBase, region, capturedAt }
     */
    connect() {
      return new Promise((resolve, reject) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const TIMEOUT_MS = 120_000; // 2 minutes

        let timer = null;

        function cleanup() {
          window.removeEventListener('message', handler);
          if (timer !== null) clearTimeout(timer);
        }

        function handler(event) {
          // Only accept messages from this same window (the ISOLATED script
          // posts back to window with targetOrigin '*', but event.source is
          // still this window).
          if (event.source !== window) return;
          const d = event.data;
          if (!d || d.__mesynxResultId !== id) return;
          cleanup();
          if (d.error) {
            reject(new Error(`Mesynx AI Connector: ${d.error}`));
          } else {
            resolve(d.payload);
          }
        }

        window.addEventListener('message', handler);

        timer = setTimeout(() => {
          cleanup();
          reject(new Error('Mesynx AI Connector: authentication timed out after 2 minutes.'));
        }, TIMEOUT_MS);

        // Kick off the auth via the ISOLATED world → background.
        // Use window.location.origin as the target origin so stray tabs on
        // other domains can't receive this message.
        window.postMessage(
          { __mesynxStartAuth: true, id },
          window.location.origin,
        );
      });
    },
  };
})();
