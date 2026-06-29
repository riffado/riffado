import { gunzipSync } from "node:zlib";
import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudApiError,
    PlaudDeviceListResponse,
    PlaudFileDetailResponse,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
} from "@/types/plaud";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS, PLAUD_USER_AGENT } from "./servers";
import { resolveWorkspaceToken } from "./workspace";

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

    async listDevices(): Promise<PlaudDeviceListResponse> {
        return this.request<PlaudDeviceListResponse>("/device/list");
    }

    async getRecordings(
        skip: number = 0,
        limit: number = 99999,
        isTrash: number = 0,
        sortBy: string = "edit_time",
        isDesc: boolean = true,
    ): Promise<PlaudRecordingsResponse> {
        const params = new URLSearchParams({
            skip: skip.toString(),
            limit: limit.toString(),
            is_trash: isTrash.toString(),
            sort_by: sortBy,
            is_desc: isDesc.toString(),
        });

        return this.request<PlaudRecordingsResponse>(
            `/file/simple/web?${params.toString()}`,
        );
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
            const tempUrlResponse = await this.getTempUrl(fileId, preferOpus);
            const downloadUrl =
                preferOpus && tempUrlResponse.temp_url_opus
                    ? tempUrlResponse.temp_url_opus
                    : tempUrlResponse.temp_url;

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
     */
    async getFileDetail(fileId: string): Promise<PlaudFileDetailResponse> {
        return this.request<PlaudFileDetailResponse>(`/file/detail/${fileId}`);
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
        return this.request<PlaudUpdateFilenameResponse>(`/file/${fileId}`, {
            method: "PATCH",
            body: JSON.stringify({ filename }),
        });
    }
}

export * from "./types";
