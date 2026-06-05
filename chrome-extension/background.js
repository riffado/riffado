/**
 * Mesynx AI Connector — background service worker
 *
 * Responsibilities:
 *  1. Answer `PING` messages so the popup can show the extension is alive.
 *  2. Handle `START_AUTH`:
 *       a. Check whether a Plaud session cookie already exists.
 *       b. If yes  → return it immediately (no popup needed).
 *       c. If no   → open web.plaud.ai in a Chrome popup window and wait
 *                    for chrome.cookies.onChanged to fire with a JWT cookie.
 *       d. Once the token is found, close the popup and resolve the caller.
 *  3. Handle `GET_STATUS` so the extension popup can show connection state.
 *  4. Handle `CONNECT_TO_MESYNX` — the main action. Gets the Plaud token,
 *     opens/finds the Mesynx AI tab, and delivers the token to the content
 *     script which POSTs it to the connect-token API.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAUD_DOMAIN = 'plaud.ai';
const DEFAULT_MESYNX_URL = 'http://localhost:3000';

// Cookie names to try, most-likely-first.
const TOKEN_COOKIE_NAMES = ['pld_ut', 'pld_at', 'access_token', 'pld_token'];

const AUTH_TIMEOUT_MS = 120_000; // 2 minutes

// ─── State ────────────────────────────────────────────────────────────────────

let pendingAuth = null;
let authPopupTabId = null;
let authTimeoutId = null;

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'PING': {
      sendResponse({ ok: true, version: 1 });
      return false;
    }

    case 'START_AUTH': {
      handleStartAuth(sendResponse);
      return true;
    }

    case 'GET_STATUS': {
      getStatus().then(sendResponse);
      return true;
    }

    case 'CONNECT_TO_MESYNX': {
      handleConnectToMesynx(message.mesynxUrl, sendResponse);
      return true;
    }

    default:
      return false;
  }
});

// ─── Connect to Mesynx AI ─────────────────────────────────────────────────────

async function handleConnectToMesynx(mesynxUrl, sendResponse) {
  const baseUrl = mesynxUrl || DEFAULT_MESYNX_URL;

  // 1. Get the Plaud token from cookies.
  const token = await findPlaudToken();
  if (!token) {
    sendResponse({ ok: false, error: 'No Plaud session found. Sign in to web.plaud.ai first.' });
    return;
  }

  // 2. Find an existing Mesynx AI tab or open a new one.
  let tab;
  try {
    const matchPatterns = [
      `${baseUrl}/*`,
    ];
    // Also match common variants (with/without trailing slash).
    const tabs = await chrome.tabs.query({});
    tab = tabs.find((t) => t.url && t.url.startsWith(baseUrl));

    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      tab = await chrome.tabs.create({ url: baseUrl, active: true });
    }
  } catch (err) {
    sendResponse({ ok: false, error: `Could not open Mesynx AI: ${err.message}` });
    return;
  }

  // 3. Wait for the tab to finish loading so the content script is injected.
  const tabId = tab.id;
  try {
    await waitForTabComplete(tabId);
  } catch {
    sendResponse({ ok: false, error: 'Mesynx AI tab took too long to load.' });
    return;
  }

  // 4. Small delay for the content script to initialise after page load.
  await sleep(600);

  // 5. Send the token to the content script on that tab.
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'DELIVER_TOKEN',
      payload: token,
    });
    sendResponse(result || { ok: true });
  } catch (err) {
    // Content script might not be ready — retry once after a longer delay.
    await sleep(1500);
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'DELIVER_TOKEN',
        payload: token,
      });
      sendResponse(result || { ok: true });
    } catch {
      sendResponse({
        ok: false,
        error: 'Could not deliver the token. Make sure Mesynx AI is fully loaded and try again.',
      });
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('timeout'));
    }, 15_000);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Already complete?
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError) return;
      if (t && t.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Auth flow (used by the bridge when starting from the Mesynx AI page) ────

async function handleStartAuth(sendResponse) {
  if (pendingAuth) {
    pendingAuth({ error: 'Superseded by a new auth request.' });
    cleanupAuth();
  }

  const existing = await findPlaudToken();
  if (existing) {
    sendResponse({ payload: existing });
    return;
  }

  pendingAuth = sendResponse;

  try {
    const win = await chrome.windows.create({
      url: 'https://web.plaud.ai',
      type: 'popup',
      width: 480,
      height: 700,
      focused: true,
    });
    authPopupTabId = win.tabs[0].id;
  } catch (err) {
    cleanupAuth();
    sendResponse({ error: `Could not open the Plaud sign-in window: ${err.message}` });
    return;
  }

  authTimeoutId = setTimeout(() => {
    if (!pendingAuth) return;
    const respond = pendingAuth;
    cleanupAuth();
    respond({ error: 'Authentication timed out after 2 minutes. Please try again.' });
  }, AUTH_TIMEOUT_MS);
}

function cleanupAuth() {
  if (authTimeoutId) {
    clearTimeout(authTimeoutId);
    authTimeoutId = null;
  }
  if (authPopupTabId !== null) {
    chrome.tabs.remove(authPopupTabId).catch(() => {});
    authPopupTabId = null;
  }
  pendingAuth = null;
}

// ─── Cookie watchers ──────────────────────────────────────────────────────────

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!pendingAuth) return;
  if (changeInfo.removed) return;

  const { cookie } = changeInfo;
  if (!cookie.domain.includes(PLAUD_DOMAIN)) return;
  if (!looksLikeJWT(cookie.value)) return;

  const payload = buildPayload(cookie.value, cookie.domain);
  const respond = pendingAuth;
  cleanupAuth();
  respond({ payload });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== authPopupTabId || !pendingAuth) return;
  const respond = pendingAuth;
  cleanupAuth();
  respond({ error: 'The sign-in window was closed before completing. Please try again.' });
});

// ─── Token helpers ────────────────────────────────────────────────────────────

async function findPlaudToken() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: PLAUD_DOMAIN });
    return extractBestToken(cookies);
  } catch {
    return null;
  }
}

function extractBestToken(cookies) {
  for (const name of TOKEN_COOKIE_NAMES) {
    const c = cookies.find((c) => c.name === name && looksLikeJWT(c.value));
    if (c) return buildPayload(c.value, c.domain);
  }
  const c = cookies.find((c) => looksLikeJWT(c.value));
  return c ? buildPayload(c.value, c.domain) : null;
}

function buildPayload(token, cookieDomain) {
  const region = detectRegion(token, cookieDomain);
  return {
    accessToken: token,
    apiBase: regionToApiBase(region),
    region,
    capturedAt: Date.now(),
  };
}

function detectRegion(token, domain) {
  if (typeof domain === 'string') {
    if (domain.includes('euc1')) return 'euc1';
    if (domain.includes('apse1')) return 'apse1';
  }
  try {
    const payload = decodeJWTPayload(token);
    if (payload?.region) return normalizeRegion(payload.region);
    if (typeof payload?.iss === 'string') {
      if (payload.iss.includes('euc1')) return 'euc1';
      if (payload.iss.includes('apse1')) return 'apse1';
    }
  } catch {
    // ignore
  }
  return 'global';
}

function normalizeRegion(raw) {
  const r = String(raw).toLowerCase();
  if (r === 'euc1' || r === 'eu') return 'euc1';
  if (r === 'apse1' || r === 'ap' || r === 'sg') return 'apse1';
  return 'global';
}

function regionToApiBase(region) {
  if (region === 'euc1') return 'https://api-euc1.plaud.ai';
  if (region === 'apse1') return 'https://api-apse1.plaud.ai';
  return 'https://api.plaud.ai';
}

function looksLikeJWT(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = decodeBase64JSON(parts[0]);
    return typeof header?.alg === 'string';
  } catch {
    return false;
  }
}

function decodeJWTPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  return decodeBase64JSON(parts[1]);
}

function decodeBase64JSON(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
}

// ─── Popup status helper ──────────────────────────────────────────────────────

async function getStatus() {
  const token = await findPlaudToken();
  if (!token) return { connected: false };

  try {
    const payload = decodeJWTPayload(token.accessToken);
    const exp = payload?.exp ? new Date(payload.exp * 1000) : null;
    return {
      connected: true,
      region: token.region,
      apiBase: token.apiBase,
      expiresAt: exp ? exp.toLocaleDateString() : null,
    };
  } catch {
    return { connected: true, region: token.region, apiBase: token.apiBase, expiresAt: null };
  }
}
