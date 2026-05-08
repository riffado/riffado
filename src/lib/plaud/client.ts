import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudApiError,
    PlaudDeviceListResponse,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
} from "@/types/plaud";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS } from "./servers";
import { resolveWorkspaceToken } from "./workspace";

export interface PlaudUpdateFilenameResponse {
    status: number;
    msg: string;
    data_file?: unknown;
}

export const DEFAULT_PLAUD_API_BASE = PLAUD_SERVERS[DEFAULT_SERVER_KEY].apiBase;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map a Plaud HTTP failure to a structured `AppError`.
 *
 *   - 401 → PLAUD_INVALID_TOKEN (token revoked/expired — reconnect path)
 *   - 4xx → PLAUD_API_ERROR (user-actionable, surfaced as 400)
 *   - 5xx → PLAUD_UPSTREAM_ERROR (Plaud's problem, surfaced as 502; we
 *           only end up here after MAX_RETRIES of exponential backoff)
 */
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

/**
 * Plaud API Client
 * Handles all communication with Plaud API.
 *
 * Plaud uses a two-tier token model:
 *   - **UT** (User Token, ~300 day lifetime): returned by /auth/otp-login,
 *     stored encrypted in plaud_connections.bearer_token. Authenticates
 *     /user/me and the workspace-token mint endpoints.
 *   - **WT** (Workspace Token, 24h lifetime): minted from a UT, required by
 *     recording endpoints (/file/simple/web, /device/list, /file/temp-url/*,
 *     /filetag/, ...). On regional servers (EU, APAC) a UT sent to those
 *     endpoints returns HTTP 200 with an empty list — i.e. it silently fails
 *     open. That's the bug behind issue #66.
 *
 * The client takes a UT in its constructor and lazily mints a WT the first
 * time an authenticated request is made. The WT is cached on the client
 * instance for its lifetime; sync runs are short and the WT is good for 24h
 * so no refresh logic is needed.
 *
 * If the WT mint fails entirely (e.g. global servers historically didn't
 * require it), the client falls back to using the UT directly. This preserves
 * pre-fix behavior for any server that still accepts the UT on recording
 * endpoints.
 */
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

    /**
     * The currently-known workspace ID for this connection. Populated either
     * by the constructor (cache hit) or after the first authenticated request
     * (cache empty / cache stale). Callers persist this back to the DB when
     * it differs from what they passed in.
     */
    get workspaceId(): string | undefined {
        return this.resolvedWorkspaceId;
    }

    /**
     * Whether this client fell back to using the UT directly because the WT
     * mint failed. Useful for diagnostics.
     */
    get usingUserTokenFallback(): boolean {
        return this.workspaceFallbackToUt;
    }

    /**
     * Lazily ensure a workspace token is available. Concurrent callers share
     * a single in-flight resolution so we don't mint multiple WTs per client.
     */
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
            // Last-resort fallback: use the UT directly. Preserves pre-fix
            // behavior for any server / legacy account where the UT still
            // works on recording endpoints. Logged so the dev info endpoint
            // can surface it.
            console.warn(
                "[plaud] workspace token mint failed, falling back to user token:",
                err instanceof Error ? err.message : err,
            );
            this.workspaceFallbackToUt = true;
        }
    }

    /**
     * Make authenticated request to Plaud API with retry logic
     */
    private async request<T>(
        endpoint: string,
        options?: RequestInit,
        retryCount = 0,
    ): Promise<T> {
        await this.ensureWorkspaceToken();

        const bearer = this.workspaceToken ?? this.userToken;
        const url = `${this.apiBase}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    Authorization: `Bearer ${bearer}`,
                    "Content-Type": "application/json",
                },
            });

            if (response.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const retryAfter = response.headers.get("Retry-After");
                    const delay = retryAfter
                        ? Number.parseInt(retryAfter, 10) * 1000
                        : INITIAL_RETRY_DELAY * 2 ** retryCount; // Exponential backoff
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

            return (await response.json()) as T;
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
            // Plain Error here means: fetch threw past our retry budget
            // (network blow-up, DNS failure, AbortError) or response.json()
            // failed parsing an unexpected body. Either way, this is an
            // upstream / infra problem — surface it as PLAUD_UPSTREAM_ERROR
            // (502) rather than letting apiHandler downgrade it to a generic
            // INTERNAL_ERROR (500), which would mislead clients.
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to communicate with Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * List all devices associated with the account
     */
    async listDevices(): Promise<PlaudDeviceListResponse> {
        return this.request<PlaudDeviceListResponse>("/device/list");
    }

    /**
     * Get all recordings
     * @param skip - Number of recordings to skip
     * @param limit - Maximum number of recordings to return
     * @param isTrash - Whether to get trashed recordings (0 = active, 1 = trash)
     * @param sortBy - Field to sort by (default: edit_time)
     * @param isDesc - Sort in descending order (default: true)
     */
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

    /**
     * Get temporary URL for downloading audio file
     * @param fileId - The recording file ID
     * @param isOpus - Whether to get OPUS format URL (default: true)
     */
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

    /**
     * Download audio file as buffer
     * @param fileId - The recording file ID
     * @param preferOpus - Whether to prefer OPUS format (smaller size)
     */
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

            const response = await fetch(downloadUrl);
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
            // Pass through structured AppErrors (from getTempUrl's request()
            // call, or our own throw above). Wrap anything else — typically
            // a network blow-up before fetch returns — as PLAUD_UPSTREAM_ERROR.
            if (error instanceof AppError) throw error;
            throw new AppError(
                ErrorCode.PLAUD_UPSTREAM_ERROR,
                "Failed to download recording from Plaud. Please try again later.",
                502,
            );
        }
    }

    /**
     * Test connection to Plaud API
     * Returns true if bearer token is valid
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.listDevices();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Update filename for a recording
     * @param fileId - The recording file ID
     * @param filename - New filename to set
     */
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

// Note: `createPlaudClient` (which decrypts a stored bearer token) lives in
// ./client-factory so importing the PlaudClient class (e.g. from tests)
// doesn't pull in the encryption / env validation chain. Production callers
// import it from "@/lib/plaud/client-factory" directly.
