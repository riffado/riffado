/**
 * Mesynx AI Connector — MAIN-world content script
 *
 * Runs in the *page's* JavaScript context (world: "MAIN"), so anything we
 * write to `window` is directly visible to the Mesynx AI React app.
 *
 * Two jobs:
 *   1. Expose window.__mesynxAiConnector so the connect screen's polling
 *      loop finds it and enables the "Continue with Plaud" button.
 *   2. Listen for DELIVER_TOKEN from the ISOLATED world (triggered by the
 *      popup's "Connect to Mesynx AI" button) and POST it directly to
 *      /api/plaud/auth/connect-token using the page's session cookies.
 */
(function () {
  'use strict';

  // ── Job 1: inject the bridge ───────────────────────────────────────────────

  if (!window.__mesynxAiConnector || window.__mesynxAiConnector.version < 1) {
    window.__mesynxAiConnector = {
      version: 1,

      connect() {
        return new Promise((resolve, reject) => {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const TIMEOUT_MS = 120_000;

          let timer = null;

          function cleanup() {
            window.removeEventListener('message', handler);
            if (timer !== null) clearTimeout(timer);
          }

          function handler(event) {
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

          window.postMessage(
            { __mesynxStartAuth: true, id },
            window.location.origin,
          );
        });
      },
    };
  }

  // ── Job 2: receive delivered tokens and POST to the API ────────────────────

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || !d.__mesynxDeliverToken) return;

    const { id, payload } = d;

    try {
      const res = await fetch('/api/plaud/auth/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: payload.accessToken,
          apiBase: payload.apiBase,
          source: 'connector',
        }),
      });

      if (res.ok) {
        // Tell the isolated world (→ popup) it worked.
        window.postMessage(
          { __mesynxDeliverResultId: id, result: { ok: true } },
          window.location.origin,
        );
        // Reload so the dashboard reflects the new Plaud connection.
        window.location.reload();
      } else {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body.error) errorMsg = body.error;
        } catch {
          // ignore parse errors
        }
        window.postMessage(
          { __mesynxDeliverResultId: id, result: { ok: false, error: errorMsg } },
          window.location.origin,
        );
      }
    } catch (err) {
      window.postMessage(
        { __mesynxDeliverResultId: id, result: { ok: false, error: err.message } },
        window.location.origin,
      );
    }
  });
})();
