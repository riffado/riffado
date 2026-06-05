# Mesynx AI Connector

A Chrome extension that bridges your Plaud account to Mesynx AI in **one click** — no copy-pasting JWT tokens, no DevTools required. Works with Google SSO, Apple SSO, and email/password accounts.

## How it works

When you click **Continue with Plaud** on the Mesynx AI connect screen:

1. The extension opens `web.plaud.ai` in a small popup window.
2. You sign in with Google, Apple, or email — exactly like you do in the Plaud app.
3. The extension reads your session token from the browser's secure cookie store (using the `chrome.cookies` API — the same way a password manager reads saved credentials).
4. The popup closes automatically and Mesynx AI receives the token directly, no clipboard involved.

If you're **already signed in** to web.plaud.ai, step 1–2 are skipped — Mesynx AI connects instantly.

## Install (developer mode)

Chrome Web Store submission is pending review. Until then, load the extension as an unpacked extension:

1. Download or clone this repo.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the `chrome-extension/` directory from this repo.
5. The "Mesynx AI Connector" extension appears in your toolbar.

## Usage

1. In Mesynx AI, open **Settings → Plaud account** (or the onboarding wizard).
2. You'll see a **"Sign in with Plaud"** tab — click it.
3. If the extension is detected, a **"Continue with Plaud"** button appears.
4. Click it. If you're not already signed in, a small Plaud window opens.
5. Sign in with Google, Apple, or email as normal.
6. The window closes automatically. Done.

## Running Mesynx AI on a custom URL?

By default, the extension injects on `http://localhost:8790` and `https://mesynx.r0073dl053r.com`. If you are running Mesynx AI at a custom URL (Tailscale IP, custom domain, etc.):

1. Open the extension popup by clicking the extension icon in your toolbar.
2. Type your custom address into the **"Mesynx AI instance URL"** field (e.g. `http://100.77.248.40:8790` or `https://mesynx.example.com`).
3. Accept the browser's permission prompt. This allows the extension to dynamically register its communication script on your custom host at runtime.
4. Reload your Mesynx AI tab, and it is ready to connect. No manual modification of `manifest.json` is needed.

## Security model

- The extension only requests `cookies`, `tabs`, `storage`, and `windows` permissions.
- `host_permissions` are limited to `*.plaud.ai`, `localhost`, and the Mesynx AI production domain.
- Cookies are read **in-process** by the background service worker and handed to the Mesynx AI app via a short-lived `postMessage` bridge — they are never written to disk, logged, or sent anywhere other than your own Mesynx AI instance.
- The bridge (`window.__mesynxAiConnector`) is injected only on the configured Mesynx AI origin, not on arbitrary pages.
- All source code is in this directory. AGPL-3.0.

## Technical architecture

```text
web.plaud.ai (user's browser session)
      │
      │  chrome.cookies.getAll / onChanged
      ▼
background.js  ←──── chrome.runtime.sendMessage ────  content-app-isolated.js
(service worker)      (ISOLATED world)                  (runs on Mesynx AI page)
      │                                                        ↕ window.postMessage
      │                                               content-app-main.js
      │                                               (MAIN world — sets window.__mesynxAiConnector)
      │                                                        ↕
      │                                               Mesynx AI React app
      │                                               (polls window.__mesynxAiConnector)
      │
      └── Opens chrome.windows.create({ url: 'https://web.plaud.ai' })
          Watches chrome.cookies.onChanged for JWT cookie
          Closes popup when token found
```

## License

AGPL-3.0 — same as the Mesynx AI project.
