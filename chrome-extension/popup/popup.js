/**
 * Mesynx AI Connector — popup UI script
 *
 * Renders the connection status and quick-action buttons.
 * Communicates with the background service worker via chrome.runtime.sendMessage.
 */
'use strict';

const $ = (id) => document.getElementById(id);

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
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
           <span class="detail-key">${key}</span>
           <span class="detail-value">${escHtml(value)}</span>
         </div>`,
    )
    .join('');

  // Actions: open app + docs
  renderActions([
    {
      label: 'Open Mesynx AI',
      href: 'http://localhost:3000',
      primary: true,
    },
    {
      label: 'View connection docs',
      href: 'https://mesynx.r0073dl053r.com/docs/guides/connect-plaud-account',
    },
  ]);
}

function renderNotConnected() {
  setDot('yellow');
  $('status-label').textContent = 'No Plaud session found';

  renderActions([
    {
      label: 'Sign in to web.plaud.ai',
      href: 'https://web.plaud.ai',
      primary: true,
    },
    {
      label: 'How to connect',
      href: 'https://mesynx.r0073dl053r.com/docs/guides/connect-plaud-account',
    },
  ]);
}

function renderError(msg) {
  setDot('grey');
  $('status-label').textContent = 'Extension error';
  $('status-detail').style.display = '';
  $('status-detail').innerHTML = `<p style="font-size:11px;color:#ef4444">${escHtml(msg)}</p>`;
}

function renderActions(buttons) {
  $('actions').innerHTML = buttons
    .map(({ label, href, primary, onClick }) => {
      if (href) {
        return `<a class="btn${primary ? ' btn-primary' : ''}" href="${escAttr(href)}" target="_blank">${escHtml(label)}</a>`;
      }
      return `<button class="btn${primary ? ' btn-primary' : ''}" data-action="${escAttr(onClick)}">${escHtml(label)}</button>`;
    })
    .join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setDot(color) {
  const dot = $('dot');
  dot.className = `dot dot-${color}`;
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str);
}
