// Capture README screenshots against the running dev server using a minted
// session cookie. Uses system Chrome (channel: "chrome"), dark theme.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const DIR = "C:/Users/r0073dl053r/Downloads/riffado/.screenshot-tmp";
const OUT = `${DIR}/out`;
const BASE = "http://localhost:61347";
const auth = JSON.parse(readFileSync(`${DIR}/auth.json`, "utf8"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
});

await context.addCookies([
    {
        name: auth.cookieName,
        value: auth.cookieValue,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
    },
]);

// Force dark theme (next-themes) before any script runs.
await context.addInitScript(() => {
    try {
        localStorage.setItem("theme", "dark");
        localStorage.setItem("settings-last-section", "providers");
    } catch {}
});

// Redact the logged-in email (only real PII on the demo route) + any IPv4.
async function redact(page, email) {
    await page.evaluate((em) => {
        const ipRe = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
        );
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const n of nodes) {
            const t = n.nodeValue;
            if (!t) continue;
            if (em && t.includes(em)) n.nodeValue = t.split(em).join("you@example.com");
            if (ipRe.test(t)) n.nodeValue = t.replace(ipRe, "100.x.x.x");
        }
    }, email);
}

const page = await context.newPage();
const results = {};

// ── 1. Dashboard ──────────────────────────────────────────────────────────
await page.goto(`${BASE}/dev/demo-dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await redact(page, auth.email);
await page.screenshot({ path: `${OUT}/dashboard-dark.png` });
results.dashboard = true;

// ── 2. Memory Map (select a recording with a summary, open full map) ───────
try {
    await page
        .getByText("Q4 board meeting", { exact: false })
        .first()
        .click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    const showFull = page.getByRole("button", { name: /show full map/i });
    await showFull.waitFor({ timeout: 10000 });
    await showFull.click();
    await page.waitForTimeout(1500); // modal open animation
    await redact(page, auth.email);
    await page.screenshot({ path: `${OUT}/memory-map.png` });
    results.memoryMap = true;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
} catch (e) {
    results.memoryMapError = String(e).slice(0, 300);
}

// ── 3. Providers (seed demo providers, capture, ids returned for cleanup) ──
const seed = [
    {
        provider: "openai",
        apiKey: "sk-demo-key-not-real-0000",
        nickname: "OpenAI",
        defaultModel: "gpt-4o",
        isDefaultEnhancement: true,
    },
    {
        provider: "groq",
        apiKey: "gsk-demo-key-not-real-0000",
        baseUrl: "https://api.groq.com/openai/v1",
        nickname: "Groq",
        defaultModel: "whisper-large-v3-turbo",
    },
    {
        provider: "openai",
        apiKey: "sk-placeholder",
        baseUrl: "http://whisper:8000/v1",
        nickname: "Home GPU · faster-whisper",
        defaultModel: "Systran/faster-whisper-large-v3",
        isDefaultTranscription: true,
    },
];
const createdIds = [];
for (const p of seed) {
    const res = await context.request.post(
        `${BASE}/api/settings/ai/providers`,
        { data: p, headers: { "Content-Type": "application/json" } },
    );
    if (res.ok()) {
        const j = await res.json();
        if (j?.provider?.id) createdIds.push(j.provider.id);
    } else {
        results.seedError = `${res.status()} ${(await res.text()).slice(0, 200)}`;
    }
}
writeFileSync(`${DIR}/created.json`, JSON.stringify(createdIds));
results.seededProviders = createdIds.length;

await page.goto(`${BASE}/settings#providers`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // providers self-fetch + render
await redact(page, auth.email);
try {
    const dialog = page.locator('[role="dialog"]').first();
    await dialog.screenshot({ path: `${OUT}/providers-list.png` });
    results.providers = true;
} catch (e) {
    // Fallback: full-viewport shot.
    await page.screenshot({ path: `${OUT}/providers-list.png` });
    results.providersFallback = String(e).slice(0, 200);
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
