/**
 * Plaud workspace token (WT) flow.
 *
 * Plaud issues two distinct JWTs:
 *  - **UT** (User Token, typ="UT"): returned by POST /auth/otp-login, lifetime
 *    ~300 days. Authenticates user-scoped endpoints (/user/me,
 *    /team-app/workspaces/list, the workspace-token mint endpoint itself).
 *  - **WT** (Workspace Token, typ="WT"): minted from a UT, lifetime 24h.
 *    Required by recording endpoints (/file/simple/web, /device/list,
 *    /file/temp-url/*, /filetag/, ...). On regional servers (EU, APAC) a UT
 *    sent to /file/simple/web returns a 200 with an empty list — the request
 *    silently fails open, which is the bug behind issue #66.
 *
 * We never persist the WT or its refresh_token; we mint a fresh WT from the
 * stored UT on every PlaudClient instance. The WT lasts 24h, far longer than
 * any sync run, so no in-flight refresh logic is needed.
 *
 * The workspaceId itself IS persisted in plaud_connections.workspace_id so we
 * can skip the /team-app/workspaces/list lookup on subsequent syncs.
 */

import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudWorkspaceListResponse,
    PlaudWorkspaceTokenResponse,
} from "@/types/plaud";

/**
 * SSRF barrier. `apiBase` is user-influenced (originally chosen at OTP-send
 * time via Plaud's regional -302 redirect, then round-tripped through the
 * client and persisted in the DB). The verify route validates it before
 * insert, but these helpers are also reachable from the sync path which
 * reads apiBase from the DB — revalidate at the boundary so a tampered DB
 * row can't coerce the server into requesting an arbitrary URL.
 *
 * Returns a freshly-constructed URL object whose hostname has been
 * whitelist-checked against plaud.ai. Inlining the URL parse + hostname
 * check (rather than delegating to a helper) is required for CodeQL's
 * SSRF analysis to recognize this as a sanitizer.
 */
function safePlaudUrl(apiBase: string, path: string): URL {
    const parsed = new URL(path, apiBase);
    if (
        parsed.protocol !== "https:" ||
        (parsed.hostname !== "plaud.ai" &&
            !parsed.hostname.endsWith(".plaud.ai"))
    ) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_API_BASE,
            "Invalid Plaud API base",
            400,
        );
    }
    return parsed;
}

/**
 * List all workspaces accessible to the user. Personal accounts always have
 * exactly one workspace with workspace_type="0" ("Personal"). Team accounts
 * may have additional workspaces; we always pick the personal one.
 *
 * Auth: requires a valid UT.
 */
export async function listPlaudWorkspaces(
    userToken: string,
    apiBase: string,
): Promise<PlaudWorkspaceListResponse> {
    const url = safePlaudUrl(
        apiBase,
        "/team-app/workspaces/list?need_personal_workspace=true",
    );
    const res = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
        },
    });

    if (!res.ok) {
        throw new AppError(
            res.status >= 500
                ? ErrorCode.PLAUD_UPSTREAM_ERROR
                : ErrorCode.PLAUD_API_ERROR,
            "Failed to list Plaud workspaces",
            res.status >= 500 ? 502 : 400,
            { plaudStatus: res.status },
        );
    }

    const body = (await res.json()) as PlaudWorkspaceListResponse;
    if (body.status !== 0 || !body.data?.workspaces) {
        throw new AppError(
            ErrorCode.PLAUD_API_ERROR,
            body.msg || "Failed to list Plaud workspaces",
            400,
            { plaudStatus: body.status },
        );
    }
    return body;
}

/**
 * Pick the personal workspace (workspace_type === "0") from a workspace list.
 * Falls back to the first workspace if no personal one is found, since some
 * accounts (e.g. team-only members) may not have one. Throws if the list is
 * empty.
 */
export function pickPersonalWorkspaceId(
    response: PlaudWorkspaceListResponse,
): string {
    const workspaces = response.data?.workspaces ?? [];
    if (workspaces.length === 0) {
        throw new AppError(
            ErrorCode.PLAUD_WORKSPACE_UNAVAILABLE,
            "Your Plaud account has no workspaces.",
            400,
        );
    }
    const personal = workspaces.find((w) => w.workspace_type === "0");
    return (personal ?? workspaces[0]).workspace_id;
}

/**
 * Mint a fresh workspace token (WT) for a given workspace.
 *
 * Auth: requires a valid UT. Body is `{}` — the workspace is identified by
 * the URL path.
 */
export async function mintPlaudWorkspaceToken(
    userToken: string,
    workspaceId: string,
    apiBase: string,
): Promise<string> {
    const url = safePlaudUrl(
        apiBase,
        `/user-app/auth/workspace/token/${encodeURIComponent(workspaceId)}`,
    );
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
        },
        body: "{}",
    });

    if (!res.ok) {
        const status = res.status;
        // 5xx is treated as transient (don't relist on a server hiccup);
        // 4xx is treated as cache-stale (workspace gone, role revoked, ...).
        const stale = status >= 400 && status < 500;
        // 401 has a distinct contract: the stored token itself is no
        // longer accepted by Plaud, so the UI must route the user to the
        // reconnect flow. Collapsing it into PLAUD_WORKSPACE_UNAVAILABLE
        // (400) would break that signal. Keep stale=true so callers still
        // try a relist + remint before giving up; if the relist also 401s,
        // the auth-typed error from listPlaudWorkspaces propagates.
        let code: ErrorCode;
        let statusCode: number;
        let message = "Failed to mint Plaud workspace token";
        if (status === 401) {
            code = ErrorCode.PLAUD_INVALID_TOKEN;
            statusCode = 401;
            message =
                "Plaud rejected the access token. Reconnect your Plaud account.";
        } else if (status >= 500) {
            code = ErrorCode.PLAUD_UPSTREAM_ERROR;
            statusCode = 502;
        } else {
            code = ErrorCode.PLAUD_WORKSPACE_UNAVAILABLE;
            statusCode = 400;
        }
        // 401 must NOT be marked stale: a stale error gets swallowed by
        // resolveWorkspaceToken (which falls through to relist + remint),
        // and even though the relist usually 401s too, depending on that
        // collision is fragile. Surface the invalid-token signal directly
        // so the route layer hits PLAUD_INVALID_TOKEN (401) without a
        // round-trip through workspace discovery.
        throw new WorkspaceTokenError(message, {
            httpStatus: status,
            stale: status === 401 ? false : stale,
            code,
            statusCode,
        });
    }

    const body = (await res.json()) as PlaudWorkspaceTokenResponse;
    if (body.status !== 0 || !body.data?.workspace_token) {
        // 2xx response with a business-level error (status != 0) most
        // commonly means the workspace is no longer valid for this user
        // (deleted, membership revoked, etc.). Mark as stale so the caller
        // re-discovers via /team-app/workspaces/list rather than falling
        // straight back to the UT and silently regressing the fix.
        throw new WorkspaceTokenError(
            body.msg || "Failed to mint Plaud workspace token",
            {
                stale: true,
                code: ErrorCode.PLAUD_WORKSPACE_UNAVAILABLE,
                statusCode: 400,
            },
        );
    }
    return body.data.workspace_token;
}

/**
 * Thrown when the workspace-token mint fails.
 *
 * `stale` indicates whether the failure looks like a cache-staleness issue
 * (workspace gone, role revoked, ...) versus a transient server problem.
 * `resolveWorkspaceToken` uses it to decide whether to relist+remint
 * (stale) or propagate the error (transient).
 *
 * `httpStatus` carries the HTTP status when the failure was at the HTTP
 * level rather than in a 2xx response body.
 */
export interface WorkspaceTokenErrorOptions {
    httpStatus?: number;
    stale?: boolean;
    code?: ErrorCode;
    statusCode?: number;
}

export class WorkspaceTokenError extends AppError {
    public readonly httpStatus?: number;
    public readonly stale: boolean;

    constructor(message: string, opts: WorkspaceTokenErrorOptions = {}) {
        super(
            opts.code ?? ErrorCode.PLAUD_WORKSPACE_UNAVAILABLE,
            message,
            opts.statusCode ?? 400,
            opts.httpStatus !== undefined
                ? { plaudStatus: opts.httpStatus }
                : undefined,
        );
        this.name = "WorkspaceTokenError";
        this.httpStatus = opts.httpStatus;
        this.stale = opts.stale ?? false;
    }
}

/**
 * Resolve a usable WT given a UT. If a cached workspaceId is provided we try
 * it first; on 4xx we invalidate and re-discover via /team-app/workspaces/list.
 *
 * Returns both the minted WT and the workspaceId that was actually used, so
 * callers can persist the (possibly newly-discovered) workspaceId.
 */
export async function resolveWorkspaceToken(
    userToken: string,
    apiBase: string,
    cachedWorkspaceId: string | null | undefined,
): Promise<{ workspaceToken: string; workspaceId: string }> {
    if (cachedWorkspaceId) {
        try {
            const workspaceToken = await mintPlaudWorkspaceToken(
                userToken,
                cachedWorkspaceId,
                apiBase,
            );
            return { workspaceToken, workspaceId: cachedWorkspaceId };
        } catch (err) {
            // Stale cache (workspace deleted/moved/role revoked, including
            // 2xx-with-status != 0 business errors) → fall through to relist.
            // Transient failures (5xx, network) → propagate so the client
            // falls back to the UT rather than burning an extra list call.
            const stale =
                err instanceof WorkspaceTokenError ? err.stale : false;
            if (!stale) throw err;
        }
    }

    const list = await listPlaudWorkspaces(userToken, apiBase);
    const workspaceId = pickPersonalWorkspaceId(list);
    const workspaceToken = await mintPlaudWorkspaceToken(
        userToken,
        workspaceId,
        apiBase,
    );
    return { workspaceToken, workspaceId };
}
