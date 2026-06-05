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
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAUD_DOMAIN = 'plaud.ai';

// Cookie names to try, most-likely-first.
// The visible name in the Network tab was `pld_ut`; the others are fallbacks.
const TOKEN_COOKIE_NAMES = ['pld_ut', 'pld_at', 'access_token', 'pld_token'];

const AUTH_TIMEOUT_MS = 120_000; // 2 minutes

// ─── State ────────────────────────────────────────────────────────────────────

/** The pending sendResponse callback, or null when idle. */
let pendingAuth = null;
/** Tab ID of the web.plaud.ai popup we opened, or null. */
let authPopupTabId = null;
/** Timeout handle. */
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
      // Return true to keep the message channel open for the async response.
      return true;
    }

    case 'GET_STATUS': {
      getStatus().then(sendResponse);
      return true;
    }

    default:
      return false;
  }
});

// ─── Auth flow ────────────────────────────────────────────────────────────────

async function handleStartAuth(sendResponse) {
  // Cancel any in-progress auth before starting a new one.
  if (pendingAuth) {
    pendingAuth({ error: 'Superseded by a new auth request.' });
    cleanupAuth();
  }

  // Fast path: user is already signed in to web.plaud.ai.
  const existing = await findPlaudToken();
  if (existing) {
    sendResponse({ payload: existing });
    return;
  }

  // Slow path: open the Plaud web app and wait for the user to sign in.
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

  // Fail-safe: reject after AUTH_TIMEOUT_MS regardless.
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

/**
 * Fires whenever any cookie in any domain changes.
 * We only care about JWT-shaped cookies on *.plaud.ai while an auth is pending.
 */
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

/**
 * If the user closes the popup window before signing in, surface a clear error.
 */
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
  // Try known names first.
  for (const name of TOKEN_COOKIE_NAMES) {
    const c = cookies.find((c) => c.name === name && looksLikeJWT(c.value));
    if (c) return buildPayload(c.value, c.domain);
  }
  // Fallback: any JWT-shaped cookie on the plaud.ai domain.
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
  // 1. Infer from the cookie's domain (most reliable for EU/APAC subdomains).
  if (typeof domain === 'string') {
    if (domain.includes('euc1')) return 'euc1';
    if (domain.includes('apse1')) return 'apse1';
  }
  // 2. Inspect the JWT payload for an `iss` or `region` claim.
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
  // Convert URL-safe base64 → standard base64, then decode.
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
