import { env } from "@/lib/env";

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
        return [];
    }
}

/** Whether `url` should route through the Plaud proxy. */
export function shouldProxyPlaud(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return false;
        const h = u.hostname.toLowerCase();
        const isPlaud = h === "plaud.ai" || h.endsWith(".plaud.ai");
        if (!isPlaud) return false;
        if (env.PLAUD_PROXY_SCOPE === "api-only" && h === "resource.plaud.ai") {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export interface SelectedProxy {
    id: string;
    /** Contains credentials; do not log. */
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
}
