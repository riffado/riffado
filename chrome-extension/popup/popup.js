/**
 * Mesynx AI Connector — popup UI script
 *
 * Shows Plaud session status and provides the "Connect to Mesynx AI" button
 * that actually delivers the token to the user's Mesynx AI instance.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const DEFAULT_URL = 'http://localhost:3000';
const STORAGE_KEY = 'mesynxInstanceUrl';

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved instance URL.
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const url = stored[STORAGE_KEY] || DEFAULT_URL;
  $('instance-url').value = url;

  // Save on change.
  $('instance-url').addEventListener('change', () => {
    const val = $('instance-url').value.trim() || DEFAULT_URL;
    $('instance-url').value = val;
    chrome.storage.local.set({ [STORAGE_KEY]: val });
  });

  await renderStatus();
});

// ─── Status render ────────────────────────────────────────────────────────────

async function renderStatus() {
  try {
    const status = await sendMessage({ type: 'GET_STATUS' });
    if (status.connected) {
      renderConnected(status);
    } else {
      renderNotConnected();
    }
  } catch (err) {
    renderError(err.message);
  }
}

function renderConnected(status) {
  setDot('green');
  $('status-label').textContent = 'Plaud session active';

  const detail = $('status-detail');
  detail.style.display = '';

  const rows = [];
  if (status.region) {
    rows.push({ key: 'Region', value: regionLabel(status.region) });
  }
  if (status.apiBase) {
    rows.push({ key: 'API', value: status.apiBase.replace('https://', '') });
  }
  if (status.expiresAt) {
    rows.push({ key: 'Token expires', value: status.expiresAt });
  }

  detail.innerHTML = rows
    .map(
      ({ key, value }) =>
        `<div class="detail-row">
           <span class="detail-key">${esc(key)}</span>
           <span class="detail-value">${esc(value)}</span>
         </div>`,
    )
    .join('');

  renderActions([
    { label: 'Connect to Mesynx AI', primary: true, action: 'connect' },
    { label: 'Sign in to a different Plaud account', action: 'reauth' },
  ]);
}

function renderNotConnected() {
  setDot('amber');
  $('status-label').textContent = 'No Plaud session found';

  renderActions([
    { label: 'Sign in to web.plaud.ai', href: 'https://web.plaud.ai', primary: true },
    { label: 'How to connect', href: 'https://mesynx.r0073dl053r.com/docs/guides/connect-plaud-account' },
  ]);
}

function renderError(msg) {
  setDot('grey');
  $('status-label').textContent = 'Extension error';
  $('status-detail').style.display = '';
  $('status-detail').innerHTML = `<p style="font-size:11px;color:#ef4444">${esc(msg)}</p>`;
}

function renderActions(buttons) {
  const container = $('actions');
  container.innerHTML = '';

  for (const { label, href, primary, action } of buttons) {
    if (href) {
      const a = document.createElement('a');
      a.className = `btn${primary ? ' btn-primary' : ''}`;
      a.href = href;
      a.target = '_blank';
      a.textContent = label;
      container.appendChild(a);
    } else {
      const btn = document.createElement('button');
      btn.className = `btn${primary ? ' btn-primary' : ''}`;
      btn.textContent = label;
      btn.addEventListener('click', () => handleAction(action, btn));
      container.appendChild(btn);
    }
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleAction(action, btn) {
  if (action === 'connect') {
    await doConnect(btn);
  } else if (action === 'reauth') {
    window.open('https://web.plaud.ai', '_blank');
  }
}

async function doConnect(btn) {
  const mesynxUrl = ($('instance-url').value || DEFAULT_URL).replace(/\/+$/, '');

  btn.disabled = true;
  btn.textContent = 'Connecting...';
  hideResult();

  try {
    const response = await sendMessage({
      type: 'CONNECT_TO_MESYNX',
      mesynxUrl,
    });

    if (response?.ok) {
      showResult('success', 'Plaud account connected to Mesynx AI. The page will reload.');
      btn.textContent = 'Connected!';
      // Re-enable after a moment in case they want to reconnect.
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Connect to Mesynx AI';
      }, 3000);
    } else {
      const msg = response?.error || 'Unknown error — try again.';
      showResult('error', msg);
      btn.disabled = false;
      btn.textContent = 'Connect to Mesynx AI';
    }
  } catch (err) {
    showResult('error', err.message);
    btn.disabled = false;
    btn.textContent = 'Connect to Mesynx AI';
  }
}

// ─── Result toast ─────────────────────────────────────────────────────────────

function showResult(type, msg) {
  const el = $('result');
  el.className = `result result-${type}`;
  el.textContent = msg;
}

function hideResult() {
  const el = $('result');
  el.className = 'result';
  el.textContent = '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setDot(color) {
  $('dot').className = `dot dot-${color}`;
}

function regionLabel(region) {
  if (region === 'euc1') return 'EU (Frankfurt)';
  if (region === 'apse1') return 'Asia Pacific (Singapore)';
  return 'Global';
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
