/**
 * Minimal Docker Engine API client over the host's unix socket.
 *
 * Used only by the opt-in GPU provisioning routes (Settings -> AI Providers ->
 * GPU acceleration). Talks raw HTTP over the socket via `node:http`'s
 * `socketPath` option, which works under both the Bun production runtime
 * (`bun server.js`) and Node dev -- avoiding a `dockerode` dependency and any
 * Bun/native-module risk.
 *
 * SERVER ONLY. Never import from a client component. The provisioning routes
 * gate every call behind GPU_PROVISIONING_ENABLED + !IS_HOSTED + an auth
 * session + a socket reachability check (see those routes).
 *
 * The pure helpers (splitImageRef, parsePullLine, applyPullMessage,
 * snapshotProgress) are exported separately so they can be unit-tested without
 * a daemon.
 */

import http from "node:http";

const DEFAULT_SOCKET = "/var/run/docker.sock";

/**
 * Socket path, from DOCKER_SOCKET_PATH (validated/documented in `@/lib/env`)
 * or the conventional default. Read from `process.env` directly rather than
 * importing the validated `env` object so this module stays free of the env
 * schema's runtime guards and its pure helpers remain unit-testable.
 */
export function dockerSocketPath(): string {
    const fromEnv = process.env.DOCKER_SOCKET_PATH?.trim();
    return fromEnv || DEFAULT_SOCKET;
}

// --- low-level transport ----------------------------------------------------

interface DockerResponse {
    statusCode: number;
    data: string;
}

interface DockerRequestInit {
    method?: string;
    path: string;
    body?: unknown;
}

function buildRequestOptions(
    init: DockerRequestInit,
    payload: string | undefined,
): http.RequestOptions {
    return {
        socketPath: dockerSocketPath(),
        path: init.path,
        method: init.method ?? "GET",
        headers: {
            // Host is required by the HTTP spec; the daemon ignores its value.
            Host: "localhost",
            ...(payload !== undefined
                ? {
                      "Content-Type": "application/json",
                      "Content-Length": Buffer.byteLength(payload),
                  }
                : {}),
        },
    };
}

/** Buffered request: resolves with the full response body as text. */
function dockerRequest(init: DockerRequestInit): Promise<DockerResponse> {
    const payload =
        init.body !== undefined ? JSON.stringify(init.body) : undefined;
    return new Promise<DockerResponse>((resolve, reject) => {
        const req = http.request(buildRequestOptions(init, payload), (res) => {
            res.setEncoding("utf8");
            let data = "";
            res.on("data", (chunk: string) => {
                data += chunk;
            });
            res.on("end", () =>
                resolve({ statusCode: res.statusCode ?? 0, data }),
            );
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

/** Streaming request: invokes `onLine` for each newline-delimited body chunk. */
function dockerStream(
    init: DockerRequestInit,
    onLine: (line: string) => void,
): Promise<number> {
    const payload =
        init.body !== undefined ? JSON.stringify(init.body) : undefined;
    return new Promise<number>((resolve, reject) => {
        const req = http.request(buildRequestOptions(init, payload), (res) => {
            res.setEncoding("utf8");
            let buf = "";
            res.on("data", (chunk: string) => {
                buf += chunk;
                let idx = buf.indexOf("\n");
                while (idx >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (line) onLine(line);
                    idx = buf.indexOf("\n");
                }
            });
            res.on("end", () => {
                const rest = buf.trim();
                if (rest) onLine(rest);
                resolve(res.statusCode ?? 0);
            });
        });
        req.on("error", reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

// --- pure helpers (unit-tested) --------------------------------------------

/**
 * Split an image reference into repo + tag for the Engine `images/create` API.
 * The tag is the segment after the LAST colon ONLY when that colon comes after
 * the last slash (otherwise the colon is a registry port, e.g. `host:5000/img`).
 */
export function splitImageRef(ref: string): { repo: string; tag: string } {
    const lastColon = ref.lastIndexOf(":");
    const lastSlash = ref.lastIndexOf("/");
    if (lastColon > lastSlash) {
        return { repo: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
    }
    return { repo: ref, tag: "latest" };
}

export interface DockerPullMessage {
    status?: string;
    id?: string;
    progressDetail?: { current?: number; total?: number };
    error?: string;
    errorDetail?: { message?: string };
}

/** Parse one NDJSON line from `images/create`; null when not valid JSON. */
export function parsePullLine(line: string): DockerPullMessage | null {
    try {
        const obj: unknown = JSON.parse(line);
        if (obj && typeof obj === "object") return obj as DockerPullMessage;
        return null;
    } catch {
        return null;
    }
}

export interface LayerProgress {
    current: number;
    total: number;
}

/**
 * Fold a pull message into the per-layer download map. We track DOWNLOAD bytes
 * only (not "Extracting") so the aggregate bar is meaningful and monotonic:
 * "Download complete" pins a layer to 100% even though Docker stops emitting
 * progressDetail for it.
 */
export function applyPullMessage(
    layers: Map<string, LayerProgress>,
    msg: DockerPullMessage,
): void {
    if (!msg.id) return;
    const d = msg.progressDetail;
    if (
        msg.status === "Downloading" &&
        d &&
        typeof d.total === "number" &&
        d.total > 0
    ) {
        layers.set(msg.id, { current: d.current ?? 0, total: d.total });
    } else if (msg.status === "Download complete") {
        const existing = layers.get(msg.id);
        if (existing) {
            layers.set(msg.id, {
                current: existing.total,
                total: existing.total,
            });
        }
    }
}

export interface ProgressSnapshot {
    currentBytes: number;
    totalBytes: number;
    /** 0..100 over the layers with known totals; 0 until totals are known. */
    percent: number;
}

export function snapshotProgress(
    layers: Map<string, LayerProgress>,
): ProgressSnapshot {
    let currentBytes = 0;
    let totalBytes = 0;
    for (const layer of layers.values()) {
        currentBytes += layer.current;
        totalBytes += layer.total;
    }
    const percent =
        totalBytes > 0
            ? Math.min(100, Math.round((currentBytes / totalBytes) * 100))
            : 0;
    return { currentBytes, totalBytes, percent };
}

// --- daemon operations ------------------------------------------------------

/** True when the daemon answers `/_ping` (socket present + reachable). */
export async function ping(): Promise<boolean> {
    try {
        const { statusCode } = await dockerRequest({ path: "/_ping" });
        return statusCode === 200;
    } catch {
        return false;
    }
}

interface DockerInfo {
    Runtimes?: Record<string, unknown>;
}

/**
 * Best-effort GPU detection: a registered `nvidia` runtime in `/info`. Newer
 * CDI-based setups may run GPUs without a named runtime, so a `false` here is a
 * hint (the UI warns) rather than a hard block.
 */
export async function hasNvidiaRuntime(): Promise<boolean> {
    try {
        const { statusCode, data } = await dockerRequest({ path: "/info" });
        if (statusCode !== 200) return false;
        const info = JSON.parse(data) as DockerInfo;
        const runtimes = info.Runtimes ?? {};
        return Object.keys(runtimes).some((r) =>
            r.toLowerCase().includes("nvidia"),
        );
    } catch {
        return false;
    }
}

export interface ContainerState {
    exists: boolean;
    running: boolean;
    image: string | null;
}

export async function inspectContainer(name: string): Promise<ContainerState> {
    const miss: ContainerState = { exists: false, running: false, image: null };
    try {
        const { statusCode, data } = await dockerRequest({
            path: `/containers/${encodeURIComponent(name)}/json`,
        });
        if (statusCode !== 200) return miss;
        const obj = JSON.parse(data) as {
            State?: { Running?: boolean };
            Config?: { Image?: string };
        };
        return {
            exists: true,
            running: Boolean(obj?.State?.Running),
            image:
                typeof obj?.Config?.Image === "string"
                    ? obj.Config.Image
                    : null,
        };
    } catch {
        return miss;
    }
}

/**
 * Resolve the compose network to attach new containers to by inspecting the
 * first reachable candidate container (the app itself, or an existing whisper
 * container) and reading its first attached network.
 */
export async function resolveNetworkName(
    candidates: string[],
): Promise<string | null> {
    for (const name of candidates) {
        if (!name) continue;
        try {
            const { statusCode, data } = await dockerRequest({
                path: `/containers/${encodeURIComponent(name)}/json`,
            });
            if (statusCode !== 200) continue;
            const obj = JSON.parse(data) as {
                NetworkSettings?: { Networks?: Record<string, unknown> };
            };
            const networks = obj?.NetworkSettings?.Networks;
            if (networks && typeof networks === "object") {
                const keys = Object.keys(networks);
                if (keys.length > 0) return keys[0];
            }
        } catch {
            // try the next candidate
        }
    }
    return null;
}

/**
 * Pull an image, streaming aggregate progress to `onProgress`. Resolves once
 * the daemon finishes; rejects on any error line or non-2xx status.
 */
export async function pullImage(
    image: string,
    onProgress: (snap: ProgressSnapshot & { status: string }) => void,
): Promise<void> {
    const { repo, tag } = splitImageRef(image);
    const layers = new Map<string, LayerProgress>();
    let lastStatus = "Preparing";
    let pullError: string | null = null;

    const statusCode = await dockerStream(
        {
            method: "POST",
            path: `/images/create?fromImage=${encodeURIComponent(
                repo,
            )}&tag=${encodeURIComponent(tag)}`,
        },
        (line) => {
            const msg = parsePullLine(line);
            if (!msg) return;
            if (msg.error || msg.errorDetail?.message) {
                pullError = msg.errorDetail?.message || msg.error || null;
                return;
            }
            if (msg.status) lastStatus = msg.status;
            applyPullMessage(layers, msg);
            onProgress({ ...snapshotProgress(layers), status: lastStatus });
        },
    );

    if (pullError) throw new Error(pullError);
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`Docker image pull failed (HTTP ${statusCode})`);
    }
}

export async function createContainer(
    name: string,
    spec: unknown,
): Promise<string> {
    const { statusCode, data } = await dockerRequest({
        method: "POST",
        path: `/containers/create?name=${encodeURIComponent(name)}`,
        body: spec,
    });
    if (statusCode === 201) {
        const obj = JSON.parse(data) as { Id?: string };
        if (obj.Id) return obj.Id;
    }
    throw new Error(
        `Failed to create container ${name} (HTTP ${statusCode}): ${data}`,
    );
}

export async function startContainer(idOrName: string): Promise<void> {
    const { statusCode, data } = await dockerRequest({
        method: "POST",
        path: `/containers/${encodeURIComponent(idOrName)}/start`,
    });
    // 204 = started, 304 = already running.
    if (statusCode !== 204 && statusCode !== 304) {
        throw new Error(
            `Failed to start container ${idOrName} (HTTP ${statusCode}): ${data}`,
        );
    }
}

export async function stopContainer(name: string): Promise<void> {
    const { statusCode } = await dockerRequest({
        method: "POST",
        path: `/containers/${encodeURIComponent(name)}/stop?t=10`,
    });
    // 204 = stopped, 304 = already stopped, 404 = absent -> all fine.
    if (![204, 304, 404].includes(statusCode)) {
        throw new Error(
            `Failed to stop container ${name} (HTTP ${statusCode})`,
        );
    }
}

export async function removeContainer(name: string): Promise<void> {
    const { statusCode } = await dockerRequest({
        method: "DELETE",
        path: `/containers/${encodeURIComponent(name)}?force=true`,
    });
    if (![204, 404].includes(statusCode)) {
        throw new Error(
            `Failed to remove container ${name} (HTTP ${statusCode})`,
        );
    }
}
