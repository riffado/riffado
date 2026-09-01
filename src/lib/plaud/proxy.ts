import { env } from "@/lib/env";
import { captureServerException } from "@/lib/posthog-server";

interface WebshareProxy {
    id: string;
    username: string;
    password: string;
    proxy_address: string;
    port: number;
    valid: boolean;
}

interface ProxyCache {
    proxies: WebshareProxy[];
    expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const WEBSHARE_LIST_URL =
    "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";

let cachedList: ProxyCache | null = null;
let badProxyIds = new Set<string>();

// A single paginated sync can call `getPlaudProxyUrl`/`fetchProxyList` many
// times in a few seconds; during a sustained Webshare outage that would
// otherwise fire one exception capture per call. Throttle per-reason so the
// first failure captures immediately (fast signal) and repeats within the
// window are logged (console.warn still fires every time) but not re-sent.
const CAPTURE_THROTTLE_MS = 60_000;
const lastCaptureAtByReason = new Map<string, number>();
function captureWebshareExceptionThrottled(
    error: unknown,
    reason: string,
    extra?: Record<string, unknown>,
): void {
    const now = Date.now();
    const last = lastCaptureAtByReason.get(reason);
    if (last !== undefined && now - last < CAPTURE_THROTTLE_MS) return;
    lastCaptureAtByReason.set(reason, now);
    captureServerException(error, { source: "webshare", reason, ...extra });
}

async function fetchProxyList(): Promise<WebshareProxy[]> {
    const apiKey = env.WEBSHARE_API_KEY;
    if (!apiKey) return [];

    try {
        const res = await fetch(WEBSHARE_LIST_URL, {
            headers: { Authorization: `Token ${apiKey}` },
        });
        if (!res.ok) {
            console.warn(
                `[plaud/proxy] Webshare list error: ${res.status} ${res.statusText}`,
            );
            captureWebshareExceptionThrottled(
                new Error(`Webshare proxy list failed (${res.status})`),
                "list_failed",
                { status: res.status },
            );
            return [];
        }
        const data = (await res.json()) as { results?: WebshareProxy[] };
        const proxies = (data.results ?? []).filter((p) => p.valid);
        cachedList = { proxies, expiresAt: Date.now() + CACHE_TTL_MS };
        badProxyIds = new Set();
        return proxies;
    } catch (err) {
        console.warn(
            "[plaud/proxy] Webshare list fetch failed:",
            err instanceof Error ? err.message : err,
        );
        captureWebshareExceptionThrottled(err, "list_fetch_failed");
        return [];
    }
}

const PLAUD_RESOURCE_HOSTS = new Set([
    "resource.plaud.ai",
    "resource.plaud.cn",
]);

/** Whether `url` should route through the Plaud proxy. */
export function shouldProxyPlaud(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return false;
        const h = u.hostname.toLowerCase();
        const isPlaud =
            h === "plaud.ai" ||
            h.endsWith(".plaud.ai") ||
            h === "plaud.cn" ||
            h.endsWith(".plaud.cn");
        if (!isPlaud) return false;
        if (
            env.PLAUD_PROXY_SCOPE === "api-only" &&
            PLAUD_RESOURCE_HOSTS.has(h)
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** A single proxy selection. `url` contains credentials and must not be logged. */
export interface SelectedProxy {
    id: string;
    url: string;
    label: string;
}

/** Pick a proxy from the cached list, or `null` when unconfigured/empty. */
export async function getPlaudProxyUrl(): Promise<SelectedProxy | null> {
    if (!env.WEBSHARE_API_KEY) return null;

    let proxies: WebshareProxy[];
    let justRefreshed = false;
    if (cachedList && cachedList.expiresAt > Date.now()) {
        proxies = cachedList.proxies;
    } else {
        proxies = await fetchProxyList();
        justRefreshed = true;
    }

    let available = proxies.filter((p) => !badProxyIds.has(p.id));
    if (available.length === 0 && !justRefreshed) {
        proxies = await fetchProxyList();
        available = proxies;
    }
    if (available.length === 0) {
        console.warn("[plaud/proxy] no valid Webshare proxies available");
        captureWebshareExceptionThrottled(
            new Error("Webshare proxy pool exhausted"),
            "pool_exhausted",
        );
        return null;
    }

    const proxy = available[Math.floor(Math.random() * available.length)];
    const url = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.proxy_address}:${proxy.port}`;
    const label = `${proxy.proxy_address}:${proxy.port}`;
    return { id: proxy.id, url, label };
}

/** Mark a proxy bad. Pass the exact `SelectedProxy` returned by `getPlaudProxyUrl` to avoid races. */
export function invalidatePlaudProxy(proxy: SelectedProxy): void {
    badProxyIds.add(proxy.id);
}

export function isPlaudProxyConfigured(): boolean {
    return Boolean(env.WEBSHARE_API_KEY);
}

/** Test-only. */
export function _resetPlaudProxyCacheForTest(): void {
    cachedList = null;
    badProxyIds = new Set();
    lastCaptureAtByReason.clear();
}
