/**
 * Local AI service discovery.
 *
 * Network-scans the host machine plus LAN / Tailscale peers for
 * OpenAI-compatible LLM and transcription servers (Ollama, LM Studio,
 * vLLM / llama.cpp / SGLang, faster-whisper, Open WebUI) and returns a
 * structured, de-duplicated list.
 *
 * This is the testable core, modelled on odysseus's `ModelDiscovery` (which
 * lives apart from its route for the same reason). It performs NO side effects
 * beyond the injected `fetchImpl`: host resolution, target construction,
 * probing, fingerprinting and dedupe are all pure / dependency-injected and
 * unit-tested. The route layer supplies the real `fetch`, the Tailscale peer
 * list (which it discovers + caches via a subprocess) and persists results.
 */

export type DiscoveredServiceType =
    | "Faster Whisper"
    | "WhisperX"
    | "Ollama"
    | "LM Studio"
    | "Open WebUI"
    | "Custom";

export interface DiscoveredService {
    type: DiscoveredServiceType;
    host: string;
    port: number;
    /** OpenAI-compatible base URL (…/v1) ready to hand to the OpenAI SDK. */
    baseUrl: string;
    /** Best default model for this endpoint; "" when none can be inferred. */
    defaultModel: string;
    /** Full model catalogue; empty when the backend exposes no list. */
    models: string[];
}

/** Subset of env vars that influence which hosts / ports we scan. */
export interface DiscoveryEnv {
    LLM_HOSTS?: string;
    OLLAMA_BASE_URL?: string;
    OLLAMA_URL?: string;
    LM_STUDIO_URL?: string;
}

type FetchImpl = typeof fetch;

// --- Well-known ports -------------------------------------------------------
export const OLLAMA_PORT = 11434;
export const LM_STUDIO_PORT = 1234;
/** Dedicated GPU faster-whisper container (Mesynx AI). */
export const WHISPER_PORT = 8397;
/** Dedicated GPU WhisperX container (Mesynx AI). */
export const WHISPERX_PORT = 8398;
/** Alternative port used by whisper-asr-webservice. */
export const ASR_WEBSERVICE_PORT = 9000;
// 8000–8020 is the vLLM / llama.cpp / SGLang / cookbook range.
const OPENAI_COMPAT_RANGE_START = 8000;
const OPENAI_COMPAT_RANGE_END = 8020;

/** Always-scanned local + common docker-network hostnames. */
export const DEFAULT_SCAN_HOSTS: readonly string[] = [
    "localhost",
    "127.0.0.1",
    "host.docker.internal",
    "whisper",
    "mesynx-whisper",
    // Legacy container names (pre-rename installs not yet recreated).
    "mesynx-ai-whisper",
    "whisperx",
    "mesynx-whisperx",
    "mesynx-ai-whisperx",
    "ollama",
    "open-webui",
    "openwebui",
];

const DEFAULT_PORTS: readonly number[] = [
    OLLAMA_PORT,
    LM_STUDIO_PORT,
    3000,
    8080,
    WHISPER_PORT,
    WHISPERX_PORT,
    ASR_WEBSERVICE_PORT,
];

const PROBE_TIMEOUT_MS = 1000;
const SCAN_CONCURRENCY = 50;

// --- Tailscale parsing (pure) ----------------------------------------------
interface TailscaleStatus {
    Self?: { TailscaleIPs?: unknown };
    Peer?: Record<
        string,
        {
            Online?: boolean;
            HostName?: string;
            OS?: string;
            TailscaleIPs?: unknown;
        }
    >;
}

/**
 * Parse `tailscale status --json` stdout into self + online peer IPv4s.
 * Skips offline peers, funnel ingress nodes and Android devices (none of which
 * run local model servers). Returns [] on malformed input.
 */
export function parseTailscaleHosts(stdout: string): string[] {
    let data: TailscaleStatus;
    try {
        data = JSON.parse(stdout) as TailscaleStatus;
    } catch {
        return [];
    }

    const hosts: string[] = [];
    const pushFirstIpv4 = (ips: unknown) => {
        if (!Array.isArray(ips)) return;
        for (const ip of ips) {
            if (typeof ip === "string" && ip.includes(".")) {
                hosts.push(ip);
                return;
            }
        }
    };

    pushFirstIpv4(data?.Self?.TailscaleIPs);
    for (const peer of Object.values(data?.Peer ?? {})) {
        if (!peer?.Online) continue;
        if (peer.HostName === "funnel-ingress-node") continue;
        if (peer.OS === "android") continue;
        pushFirstIpv4(peer.TailscaleIPs);
    }
    return hosts;
}

// --- Scan plan (pure) -------------------------------------------------------
export interface ScanPlan {
    hosts: string[];
    ports: number[];
}

/**
 * Resolve the full (hosts, ports) scan plan. Host priority mirrors odysseus:
 *  1. `LLM_HOSTS` explicit override — when set, Tailscale peers are ignored
 *     (the route passes [] in that case).
 *  2. Otherwise the supplied Tailscale peer IPs.
 *  3. Always-on local + docker fallbacks (appended in every case).
 * Provider env URLs contribute both their hostname and any custom port.
 */
export function resolveScanPlan(
    env: DiscoveryEnv,
    tailscaleHosts: string[],
): ScanPlan {
    const hosts: string[] = [];
    const add = (h: string | null | undefined) => {
        const trimmed = (h ?? "").trim();
        if (trimmed && !hosts.includes(trimmed)) hosts.push(trimmed);
    };

    const llmHosts = (env.LLM_HOSTS ?? "").trim();
    if (llmHosts) {
        for (const h of llmHosts.split(",")) add(h);
    } else {
        for (const h of tailscaleHosts) add(h);
    }

    const extraPorts = new Set<number>();
    for (const raw of [
        env.OLLAMA_BASE_URL,
        env.OLLAMA_URL,
        env.LM_STUDIO_URL,
    ]) {
        if (!raw) continue;
        try {
            const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
            add(url.hostname);
            if (url.port) {
                const port = Number.parseInt(url.port, 10);
                if (Number.isFinite(port)) extraPorts.add(port);
            }
        } catch {
            // Ignore unparseable provider URLs.
        }
    }

    for (const h of DEFAULT_SCAN_HOSTS) add(h);

    const ports = new Set<number>(DEFAULT_PORTS);
    for (let p = OPENAI_COMPAT_RANGE_START; p <= OPENAI_COMPAT_RANGE_END; p++) {
        ports.add(p);
    }
    for (const p of extraPorts) ports.add(p);

    return { hosts, ports: [...ports] };
}

// --- Classification (pure) --------------------------------------------------
/** Prefer a whisper-named model when one is wanted; else the first model. */
export function pickDefaultModel(
    models: string[],
    preferWhisper: boolean,
): string {
    if (preferWhisper) {
        const whisper = models.find((m) => m.toLowerCase().includes("whisper"));
        if (whisper) return whisper;
    }
    return models[0] ?? "";
}

/**
 * Classify an endpoint that already answered `/v1/models`, given its model
 * list plus the LM Studio / Ollama native-API signals. Pure, so the rules are
 * unit-testable in isolation.
 */
export function classifyOpenAiCompat(args: {
    host: string;
    port: number;
    models: string[];
    isLmStudio: boolean;
    isOllama: boolean;
}): DiscoveredService {
    const { host, port, models, isLmStudio, isOllama } = args;
    const baseUrl = `http://${host}:${port}/v1`;
    const firstModel = models[0] ?? "";

    if (isLmStudio) {
        return {
            type: "LM Studio",
            host,
            port,
            baseUrl,
            defaultModel: firstModel,
            models,
        };
    }
    if (isOllama) {
        return {
            type: "Ollama",
            host,
            port,
            baseUrl,
            defaultModel: firstModel,
            models,
        };
    }

    // WhisperX: detected by port 8398 or 9000, or a model list containing diarization models.
    const hasWhisperModel = models.some((m) =>
        m.toLowerCase().includes("whisper"),
    );
    const hasDiarizeModel = models.some((m) =>
        m.toLowerCase().includes("diarize"),
    );
    if (
        port === WHISPERX_PORT ||
        port === ASR_WEBSERVICE_PORT ||
        hasDiarizeModel
    ) {
        const defaultModel =
            models.find((m) => m.toLowerCase().includes("diarize")) ||
            pickDefaultModel(models, true);
        return {
            type: "WhisperX",
            host,
            port,
            baseUrl,
            defaultModel,
            models,
        };
    }

    // Faster Whisper: detected by a whisper-named model OR the dedicated
    // whisper port (8397) ONLY — never the generic 8000, which is the
    // vLLM / llama.cpp / SGLang range. Treating 8000 as Whisper would mislabel
    // a chat server and auto-wire it as the default transcription provider,
    // routing audio to a model that can't transcribe.
    if (port === WHISPER_PORT || hasWhisperModel) {
        return {
            type: "Faster Whisper",
            host,
            port,
            baseUrl,
            defaultModel: pickDefaultModel(models, true),
            models,
        };
    }

    return {
        type: "Custom",
        host,
        port,
        baseUrl,
        defaultModel: firstModel,
        models,
    };
}

// --- Probing (dependency-injected I/O) -------------------------------------
async function tryFetch(
    fetchImpl: FetchImpl,
    url: string,
    timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { signal: controller.signal });
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function readJson(res: Response | null): Promise<unknown> {
    if (!res?.ok) return null;
    try {
        return await res.json();
    } catch {
        return null;
    }
}

/** LM Studio's native `/api/v1/models` returns objects with key+architecture. */
function isLmStudioPayload(json: unknown): boolean {
    if (!json || typeof json !== "object") return false;
    const models = (json as { models?: unknown }).models;
    if (!Array.isArray(models) || models.length === 0) return false;
    const first = models[0] as Record<string, unknown> | undefined;
    return !!first && "key" in first && "architecture" in first;
}

/**
 * Does `/api/config` genuinely look like Open WebUI, rather than any random
 * web server that happens to answer 200? Open WebUI's config payload (rendered
 * publicly by its login page) carries these stable, distinctive keys. Requiring
 * the signature kills the false positives the old "any 200/401/403" check
 * produced.
 */
function looksLikeOpenWebUi(json: unknown): boolean {
    if (!json || typeof json !== "object") return false;
    const cfg = json as Record<string, unknown>;
    return (
        typeof cfg.name === "string" ||
        typeof cfg.version === "string" ||
        (typeof cfg.features === "object" && cfg.features !== null)
    );
}

function extractOpenAiModelIds(json: unknown): string[] {
    const data = (json as { data?: unknown })?.data;
    if (!Array.isArray(data)) return [];
    return data
        .map((m) =>
            typeof (m as { id?: unknown })?.id === "string"
                ? (m as { id: string }).id
                : "",
        )
        .filter(Boolean);
}

function extractOllamaModelNames(json: unknown): string[] {
    const models = (json as { models?: unknown })?.models;
    if (!Array.isArray(models)) return [];
    return models
        .map((m) =>
            typeof (m as { name?: unknown })?.name === "string"
                ? (m as { name: string }).name
                : "",
        )
        .filter(Boolean);
}

/** Probe a single host:port. Returns null when nothing recognizable answers. */
export async function probeTarget(
    fetchImpl: FetchImpl,
    host: string,
    port: number,
): Promise<DiscoveredService | null> {
    const root = `http://${host}:${port}`;

    // 1. OpenAI-compatible /v1/models — the primary signal.
    const modelsJson = await readJson(
        await tryFetch(fetchImpl, `${root}/v1/models`),
    );
    const modelIds = extractOpenAiModelIds(modelsJson);
    if (modelIds.length > 0) {
        // Native-API fingerprints, fetched together.
        const [lmJson, tagsRes] = await Promise.all([
            readJson(await tryFetch(fetchImpl, `${root}/api/v1/models`)),
            tryFetch(fetchImpl, `${root}/api/tags`),
        ]);
        return classifyOpenAiCompat({
            host,
            port,
            models: modelIds,
            isLmStudio: isLmStudioPayload(lmJson),
            isOllama: !!tagsRes?.ok,
        });
    }

    // 2. Native Ollama /api/tags (server that doesn't expose /v1/models).
    const tagsJson = await readJson(
        await tryFetch(fetchImpl, `${root}/api/tags`),
    );
    const ollamaNames = extractOllamaModelNames(tagsJson);
    if (ollamaNames.length > 0) {
        return {
            type: "Ollama",
            host,
            port,
            baseUrl: `${root}/v1`,
            defaultModel: ollamaNames[0],
            models: ollamaNames,
        };
    }

    // 3. Open WebUI — require a real signature at /api/config, not just a 200
    //    from any web server. The old bare-root /config probe (which matched
    //    almost any app) is deliberately gone.
    const cfgJson = await readJson(
        await tryFetch(fetchImpl, `${root}/api/config`),
    );
    if (looksLikeOpenWebUi(cfgJson)) {
        return {
            type: "Open WebUI",
            host,
            port,
            // Open WebUI's OpenAI-compatible API lives under /api. NOTE: it
            // still needs a real API key from the user's Open WebUI settings —
            // the auto-provisioned bypass key won't authenticate, so the user
            // must edit the credential before it works.
            baseUrl: `${root}/api`,
            defaultModel: "",
            models: [],
        };
    }

    return null;
}

// --- Dedupe (pure) ----------------------------------------------------------
/**
 * Collapse endpoints that are the same service reached via multiple routes
 * (e.g. local IP + Tailscale IP), keyed on (port, type, sorted models) —
 * odysseus's (port, models) fingerprint, refined with type. This intentionally
 * also merges two genuinely distinct machines that serve an identical model set
 * (the accepted odysseus trade-off). Endpoints with no model list (Open WebUI)
 * can't be fingerprinted that way, so they fall back to (port, type, host) to
 * avoid merging different boxes into one.
 */
export function dedupeServices(
    services: DiscoveredService[],
): DiscoveredService[] {
    const seen = new Set<string>();
    const out: DiscoveredService[] = [];
    for (const svc of services) {
        const fingerprint = svc.models.length
            ? [...svc.models].sort().join(",")
            : svc.host;
        const key = `${svc.port}:${svc.type}:${fingerprint}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(svc);
        }
    }
    return out;
}

// --- Concurrency ------------------------------------------------------------
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor++;
            try {
                results[index] = await fn(items[index]);
            } catch {
                results[index] = null as R;
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, worker),
    );
    return results;
}

// --- Orchestrator -----------------------------------------------------------
export interface DiscoveryResult {
    hosts: string[];
    services: DiscoveredService[];
}

export async function discoverLocalAiServices(opts: {
    env: DiscoveryEnv;
    tailscaleHosts: string[];
    fetchImpl?: FetchImpl;
    concurrency?: number;
}): Promise<DiscoveryResult> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const { hosts, ports } = resolveScanPlan(opts.env, opts.tailscaleHosts);
    const targets = hosts.flatMap((host) =>
        ports.map((port) => ({ host, port })),
    );

    const probed = await mapWithConcurrency(
        targets,
        opts.concurrency ?? SCAN_CONCURRENCY,
        ({ host, port }) => probeTarget(fetchImpl, host, port),
    );

    const found = probed.filter((s): s is DiscoveredService => s != null);
    const services = dedupeServices(found).sort(
        (a, b) => a.host.localeCompare(b.host) || a.port - b.port,
    );
    return { hosts, services };
}
