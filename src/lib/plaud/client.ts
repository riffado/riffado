import { gunzipSync } from "node:zlib";
import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudApiError,
    PlaudDeviceListResponse,
    PlaudFileDetailResponse,
    PlaudRecording,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
    PlaudV4ContentUrlResponse,
    PlaudV4FileDetailResponse,
    PlaudV4FolderChildrenResponse,
    PlaudV4Node,
    PlaudV4RecordingsResponse,
    PlaudV4RenameResponse,
} from "@/types/plaud";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS, PLAUD_USER_AGENT } from "./servers";
import {
    applyPlaudV4Detail,
    isPlaudV4MigratedResponse,
    mapPlaudV4Item,
    PLAUD_V4_VERSION_CONFLICT_STATUS,
    plaudV4DetailToLegacy,
    recordingIdToPlaudV4FileId,
    selectPlaudV4Audio,
    sortPlaudRecordings,
} from "./v4";
import { resolveWorkspaceToken } from "./workspace";

const V4_PAGE_SIZE = 50;
const V4_MAX_PAGES = 400;

export interface PlaudUpdateFilenameResponse {
    status: number;
    msg: string;
    data_file?: unknown;
}

export const DEFAULT_PLAUD_API_BASE = PLAUD_SERVERS[DEFAULT_SERVER_KEY].apiBase;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function plaudHttpError(status: number, msg: string): AppError {
    if (status === 401) {
        return new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            "Plaud rejected the access token. Reconnect your Plaud account.",
            401,
            { plaudStatus: status, plaudMessage: msg },
        );
    }
    if (status >= 500) {
        return new AppError(
            ErrorCode.PLAUD_UPSTREAM_ERROR,
            "Plaud is temporarily unavailable. Please try again later.",
            502,
            { plaudStatus: status, plaudMessage: msg },
        );
    }
    return new AppError(ErrorCode.PLAUD_API_ERROR, msg, 400, {
        plaudStatus: status,
    });
}

export class PlaudClient {
    private readonly userToken: string;
    private readonly apiBase: string;
    private workspaceToken?: string;
    private resolvedWorkspaceId?: string;
    private workspaceFetchInFlight?: Promise<void>;
    private workspaceFallbackToUt = false;
    private v4Mode = false;
    private v4ListCache?: PlaudRecording[];
    private readonly v4DetailCache = new Map<
        string,
        NonNullable<PlaudV4FileDetailResponse["data"]>
    >();

    constructor(
        userToken: string,
        apiBase: string = DEFAULT_PLAUD_API_BASE,
        workspaceId?: string | null,
    ) {
        this.userToken = userToken;
        this.apiBase = apiBase;
        this.resolvedWorkspaceId = workspaceId ?? undefined;
    }

    get workspaceId(): string | undefined {
        return this.resolvedWorkspaceId;
    }

    get usingUserTokenFallback(): boolean {
        return this.workspaceFallbackToUt;
    }

    /** True once Plaud reported the account as migrated to 4.0. */
    get usingPlaudV4(): boolean {
        return this.v4Mode;
    }

    private async ensureWorkspaceToken(): Promise<void> {
        if (this.workspaceToken || this.workspaceFallbackToUt) return;
        if (!this.workspaceFetchInFlight) {
            this.workspaceFetchInFlight = this.fetchWorkspaceToken();
        }
        try {
            await this.workspaceFetchInFlight;
        } finally {
            this.workspaceFetchInFlight = undefined;
        }
    }

    private async fetchWorkspaceToken(): Promise<void> {
        try {
            const { workspaceToken, workspaceId } = await resolveWorkspaceToken(
                this.userToken,
                this.apiBase,
                this.resolvedWorkspaceId,
            );
            this.workspaceToken = workspaceToken;
            this.resolvedWorkspaceId = workspaceId;
        } catch (err) {
            console.warn(
                "[plaud] workspace token mint failed, falling back to user token:",
                err instanceof Error ? err.message : err,
            );
            this.workspaceFallbackToUt = true;
        }
    }

    private async request<T>(
        endpoint: string,
        options?: RequestInit,
        retryCount = 0,
    ): Promise<T> {
        await this.ensureWorkspaceToken();

        const bearer = this.workspaceToken ?? this.userToken;
        const url = `${this.apiBase}${endpoint}`;

        try {
            const response = await plaudFetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    Authorization: `Bearer ${bearer}`,
                    "Content-Type": "application/json",
                    "User-Agent": PLAUD_USER_AGENT,
                },
            });

            if (response.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = response.headers.get("Retry-After");
                    const delay = retryAfter
                        ? Number.parseInt(retryAfter, 10) * 1000
                        : INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }
                const retryAfter = response.headers.get("Retry-After");
                throw new AppError(
                    ErrorCode.PLAUD_RATE_LIMITED,
                    "Too many requests to Plaud. Please try again later.",
                    429,
                    retryAfter
                        ? { retryAfter: Number.parseInt(retryAfter, 10) }
                        : undefined,
                );
            }

            if (!response.ok) {
                const error = (await response
                    .json()
                    .catch(() => ({}) as PlaudApiError)) as PlaudApiError;
                const upstreamMsg = error.msg || response.statusText;

                if (
                    response.status >= 500 &&
                    response.status < 600 &&
                    retryCount < MAX_RETRIES
                ) {
                    const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }

                throw plaudHttpError(response.status, upstreamMsg);
            }

            return await safeParseJson<T>(response);
        } catch (error) {
            if (
                error instanceof TypeError &&
                error.message.includes("fetch") &&
                retryCount < MAX_RETRIES
            ) {
                const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (error instanceof AppError) throw error;
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to communicate with Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * Fetch the device list. Validates the response shape before returning:
     * a 200 with a non-zero `status` (or missing/malformed `data_devices`) is
     * a business-level Plaud error, not a schema `PlaudDeviceListResponse`
     * guarantees -- callers that iterate `data_devices` without this check
     * crash on an undefined array (issue #231). Surfaces as a typed,
     * actionable `PLAUD_API_ERROR` instead.
     */
    async listDevices(): Promise<PlaudDeviceListResponse> {
        const body =
            await this.request<PlaudDeviceListResponse>("/device/list");
        if (body?.status !== 0 || !Array.isArray(body.data_devices)) {
            throw new AppError(
                ErrorCode.PLAUD_API_ERROR,
                body?.msg ||
                    "Plaud returned an invalid device list response. Reconnect your Plaud account and try again.",
                400,
                { plaudStatus: body?.status },
            );
        }
        return body;
    }

    async getRecordings(
        skip: number = 0,
        limit: number = 99999,
        isTrash: number = 0,
        sortBy: string = "edit_time",
        isDesc: boolean = true,
    ): Promise<PlaudRecordingsResponse> {
        if (!this.v4Mode) {
            const params = new URLSearchParams({
                skip: skip.toString(),
                limit: limit.toString(),
                is_trash: isTrash.toString(),
                sort_by: sortBy,
                is_desc: isDesc.toString(),
            });

            const body = await this.request<PlaudRecordingsResponse>(
                `/file/simple/web?${params.toString()}`,
            );
            if (Array.isArray(body?.data_file_list)) return body;
            if (!isPlaudV4MigratedResponse(body)) {
                throw new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    body?.msg ||
                        "Plaud returned an invalid recordings list response.",
                    400,
                    { plaudStatus: body?.status },
                );
            }
            this.v4Mode = true;
        }

        if (isTrash !== 0) {
            return {
                status: 0,
                msg: "success",
                data_file_total: 0,
                data_file_list: [],
            };
        }
        const all = sortPlaudRecordings(
            await this.listAllRecordingsV4(),
            sortBy,
            isDesc,
        );
        return {
            status: 0,
            msg: "success",
            data_file_total: all.length,
            data_file_list: all.slice(skip, skip + limit),
        };
    }

    /** All recordings via `/file-app/v4/recordings/all`, newest first. */
    private async listAllRecordingsV4(): Promise<PlaudRecording[]> {
        if (this.v4ListCache) return this.v4ListCache;

        const out: PlaudRecording[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < V4_MAX_PAGES; page++) {
            const params = new URLSearchParams({
                sort_by: "created",
                sort_order: "desc",
                page_size: V4_PAGE_SIZE.toString(),
            });
            if (cursor) params.set("cursor", cursor);

            const body = await this.request<PlaudV4RecordingsResponse>(
                `/file-app/v4/recordings/all?${params.toString()}`,
            );
            if (body?.status !== 0 || !Array.isArray(body.data?.items)) {
                throw new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    body?.msg ||
                        "Plaud returned an invalid v4 recordings response.",
                    400,
                    { plaudStatus: body?.status },
                );
            }
            for (const item of body.data.items) {
                if (item?.file_id) out.push(mapPlaudV4Item(item));
            }
            const next = body.data.next_cursor;
            if (!next || body.data.items.length === 0) break;
            cursor = next;
        }

        this.v4ListCache = out;
        return out;
    }

    private async getFileDetailV4(
        recordingId: string,
        { fresh = false }: { fresh?: boolean } = {},
    ): Promise<NonNullable<PlaudV4FileDetailResponse["data"]>> {
        const fileId = recordingIdToPlaudV4FileId(recordingId);
        const cached = this.v4DetailCache.get(fileId);
        if (cached && !fresh) return cached;

        const body = await this.request<PlaudV4FileDetailResponse>(
            `/file-app/v4/files/detail/${encodeURIComponent(fileId)}`,
        );
        if (body?.status !== 0 || !body.data) {
            throw new AppError(
                ErrorCode.PLAUD_API_ERROR,
                body?.msg || "Plaud returned an invalid v4 file detail.",
                400,
                { plaudStatus: body?.status },
            );
        }
        this.v4DetailCache.set(fileId, body.data);
        return body.data;
    }

    /**
     * Complete a recording listed through the v4 API (device serial, size,
     * timezone) from its v4 detail. No-op for legacy listings, so callers
     * can invoke it unconditionally before downloading.
     */
    async hydrateRecording(recording: PlaudRecording): Promise<PlaudRecording> {
        if (recording.source !== "v4") return recording;
        const detail = await this.getFileDetailV4(recording.id);
        return applyPlaudV4Detail(recording, detail);
    }

    /** Presigned audio URL of a v4 file (transcoded first, then the upload). */
    private async getAudioUrlV4(recordingId: string): Promise<string> {
        const detail = await this.getFileDetailV4(recordingId);
        const audio = selectPlaudV4Audio(detail);
        if (audio?.content_url) return audio.content_url;

        if (audio?.content_id) {
            const urls = await this.resolveContentUrlsV4([audio.content_id]);
            const url = urls[audio.content_id];
            if (url) return url;
        }

        throw new AppError(
            ErrorCode.PLAUD_API_ERROR,
            "Plaud has no downloadable audio for this recording yet.",
            400,
        );
    }

    /** Presigned URLs for v4 content ids (`/file-app/v4/files/content/url`). */
    private async resolveContentUrlsV4(
        contentIds: string[],
    ): Promise<Record<string, string>> {
        if (contentIds.length === 0) return {};
        const body = await this.request<PlaudV4ContentUrlResponse>(
            "/file-app/v4/files/content/url",
            {
                method: "POST",
                body: JSON.stringify({ content_ids: contentIds }),
            },
        );
        return body?.status === 0 ? (body.data?.url_map ?? {}) : {};
    }

    /** Fill missing transcript / summary URLs of a v4 detail. */
    private async withContentUrlsV4(
        detail: NonNullable<PlaudV4FileDetailResponse["data"]>,
    ): Promise<NonNullable<PlaudV4FileDetailResponse["data"]>> {
        const objects = detail.objects ?? [];
        const missing = objects
            .filter(
                (o) =>
                    (o.object_type === "TRANSCRIPT" ||
                        o.object_type === "SUMMARY") &&
                    !o.content_url &&
                    o.content_id,
            )
            .map((o) => o.content_id as string);
        if (missing.length === 0) return detail;
        const urls = await this.resolveContentUrlsV4(missing);
        return {
            ...detail,
            objects: objects.map((o) =>
                !o.content_url && o.content_id && urls[o.content_id]
                    ? { ...o, content_url: urls[o.content_id] }
                    : o,
            ),
        };
    }

    async getTempUrl(
        fileId: string,
        isOpus: boolean = true,
    ): Promise<PlaudTempUrlResponse> {
        const params = new URLSearchParams({
            is_opus: isOpus ? "1" : "0",
        });

        return this.request<PlaudTempUrlResponse>(
            `/file/temp-url/${fileId}?${params.toString()}`,
        );
    }

    async downloadRecording(
        fileId: string,
        preferOpus: boolean = true,
    ): Promise<Buffer> {
        try {
            let downloadUrl: string | undefined;
            if (!this.v4Mode) {
                const tempUrlResponse = await this.getTempUrl(
                    fileId,
                    preferOpus,
                );
                if (isPlaudV4MigratedResponse(tempUrlResponse)) {
                    this.v4Mode = true;
                } else {
                    downloadUrl =
                        preferOpus && tempUrlResponse.temp_url_opus
                            ? tempUrlResponse.temp_url_opus
                            : tempUrlResponse.temp_url;
                }
            }
            if (this.v4Mode) {
                downloadUrl = await this.getAudioUrlV4(fileId);
            }
            if (!downloadUrl) {
                throw new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    "Plaud did not return a download URL for this recording.",
                    400,
                );
            }

            const response = await plaudFetch(downloadUrl);
            if (!response.ok) {
                throw new AppError(
                    ErrorCode.PLAUD_UPSTREAM_ERROR,
                    "Failed to download recording from Plaud. Please try again later.",
                    502,
                    { plaudStatus: response.status },
                );
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to download recording from Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * Fetch a recording's content manifest (`/file/detail/{id}`) — lists the
     * transcript / summary / note items Plaud has processed and the presigned
     * links to their bodies. Goes through `request`, so it inherits
     * workspace-token auth, retry/backoff, and 401 → PLAUD_INVALID_TOKEN.
     * NOTE: the response shape is unverified (see #204 / Phase 0).
     * On Plaud 4.0 accounts the v4 detail is mapped onto the same shape.
     */
    async getFileDetail(fileId: string): Promise<PlaudFileDetailResponse> {
        if (!this.v4Mode) {
            const body = await this.request<PlaudFileDetailResponse>(
                `/file/detail/${fileId}`,
            );
            if (!isPlaudV4MigratedResponse(body)) return body;
            this.v4Mode = true;
        }
        return plaudV4DetailToLegacy(
            await this.withContentUrlsV4(await this.getFileDetailV4(fileId)),
        );
    }

    /**
     * Fetch a presigned content link (transcript / summary JSON) from S3.
     * Unlike Plaud API calls this carries no auth header and is gzip-aware:
     * undici inflates transparently when `Content-Encoding: gzip` is present,
     * otherwise we detect the gzip magic bytes and inflate manually. Returns
     * parsed JSON, or the raw string when the body isn't JSON (parsers
     * tolerate both). A 403 here means an expired presign (skip this item) —
     * distinct from a dead Plaud token (401 from `getFileDetail`).
     */
    async fetchContentLink(url: string): Promise<unknown> {
        const response = await plaudFetch(url);
        if (!response.ok) {
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to fetch Plaud content link.",
                502,
                { plaudStatus: response.status },
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        let buf = Buffer.from(arrayBuffer);
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            buf = gunzipSync(buf);
        }

        const text = buf.toString("utf-8");
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.listDevices();
            return true;
        } catch {
            return false;
        }
    }

    async updateFilename(
        fileId: string,
        filename: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        if (!this.v4Mode) {
            const body = await this.request<PlaudUpdateFilenameResponse>(
                `/file/${fileId}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ filename }),
                },
            );
            if (!isPlaudV4MigratedResponse(body)) return body;
            this.v4Mode = true;
        }
        return this.renameV4(fileId, filename);
    }

    /**
     * Plaud 4.0 title sync. Renames the recording's file node and, when the
     * per-recording folder (what the Plaud library lists) still carries the
     * same auto-generated name, that folder too.
     */
    private async renameV4(
        recordingId: string,
        name: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        let fileNode = undefined as PlaudV4Node | undefined;
        const renamed = await this.renameNodeV4(name, async () => {
            const detail = await this.getFileDetailV4(recordingId, {
                fresh: true,
            });
            fileNode = detail.node ?? undefined;
            return { nodeId: fileNode?.node_id, version: fileNode?.version_ms };
        });

        const folder = fileNode?.folder;
        const previousName = fileNode?.name;
        if (
            folder?.folder_id &&
            folder.name &&
            folder.name === previousName &&
            folder.name !== name
        ) {
            const folderId = folder.folder_id;
            const parentId = fileNode?.breadcrumbs?.[0]?.node_id;
            let fromResponse = renamed?.data?.parent_items?.find(
                (p) => p.node_id === folderId && p.name !== undefined,
            );
            try {
                await this.renameNodeV4(name, async () => {
                    const current =
                        fromResponse ??
                        (parentId
                            ? await this.findChildV4(parentId, folderId)
                            : undefined);
                    fromResponse = undefined;
                    if (!current || current.name !== previousName) {
                        return { skip: true };
                    }
                    return { nodeId: folderId, version: current.version_ms };
                });
            } catch (err) {
                console.warn(
                    "[plaud] v4 folder rename failed:",
                    err instanceof Error ? err.message : err,
                );
            }
        }

        return { status: 0, msg: "success", data_file: renamed?.data };
    }

    /**
     * `PATCH /file-app/v4/nodes/rename/{node_id}` with the node's current
     * version as `origin_version` (optimistic locking). A stale version
     * answers `-1800313`: refetch and retry once, as the Plaud web app does.
     * The resolver runs before each attempt and can return `skip` to stop
     * without writing.
     */
    private async renameNodeV4(
        name: string,
        resolve: () => Promise<{
            nodeId?: string;
            version?: number;
            skip?: boolean;
        }>,
    ): Promise<PlaudV4RenameResponse | undefined> {
        let lastStatus: number | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            const { nodeId, version, skip } = await resolve();
            if (skip) return undefined;
            if (!nodeId || version === undefined) {
                throw new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    "Plaud returned no node version to rename.",
                    400,
                );
            }
            const body = await this.request<PlaudV4RenameResponse>(
                `/file-app/v4/nodes/rename/${encodeURIComponent(nodeId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ name, origin_version: version }),
                },
            );
            if (body?.status === 0) return body;
            lastStatus = body?.status;
            if (body?.status !== PLAUD_V4_VERSION_CONFLICT_STATUS) {
                throw new AppError(
                    ErrorCode.PLAUD_API_ERROR,
                    body?.msg || "Plaud rejected the rename.",
                    400,
                    { plaudStatus: body?.status },
                );
            }
        }
        throw new AppError(
            ErrorCode.PLAUD_API_ERROR,
            "Plaud rename failed: node version conflict.",
            400,
            { plaudStatus: lastStatus },
        );
    }

    /** Current state of a folder child (scans a few pages). */
    private async findChildV4(
        parentId: string,
        childId: string,
    ): Promise<PlaudV4Node | undefined> {
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({
                node_id: parentId,
                page_size: V4_PAGE_SIZE.toString(),
            });
            if (cursor) params.set("cursor", cursor);
            const body = await this.request<PlaudV4FolderChildrenResponse>(
                `/file-app/v4/folders/children?${params.toString()}`,
            );
            const items = body?.data?.items ?? [];
            const hit = items.find((i) => i.node_id === childId);
            if (hit) return hit;
            const next = body?.data?.next_cursor;
            if (!next || items.length === 0) return undefined;
            cursor = next;
        }
        return undefined;
    }
}

export * from "./types";
