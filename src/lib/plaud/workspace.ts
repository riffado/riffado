import { AppError, ErrorCode } from "@/lib/errors";
import type {
    PlaudWorkspaceListResponse,
    PlaudWorkspaceTokenResponse,
} from "@/types/plaud";
import { plaudFetch } from "./fetch";
import { safeParseJson } from "./parse";
import { PLAUD_USER_AGENT } from "./servers";

// SSRF sanitiser. Inlined (not delegated) so CodeQL recognises it.
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

/** List workspaces accessible to the user. Auth: UT. */
export async function listPlaudWorkspaces(
    userToken: string,
    apiBase: string,
): Promise<PlaudWorkspaceListResponse> {
    const url = safePlaudUrl(
        apiBase,
        "/team-app/workspaces/list?need_personal_workspace=true",
    );
    const res = await plaudFetch(url.toString(), {
        method: "GET",
        headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "User-Agent": PLAUD_USER_AGENT,
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

    const body = await safeParseJson<PlaudWorkspaceListResponse>(res);
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

/** Personal workspace id, falling back to first for team-only accounts. */
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

/** Mint a workspace token. Auth: UT. */
export async function mintPlaudWorkspaceToken(
    userToken: string,
    workspaceId: string,
    apiBase: string,
): Promise<string> {
    const url = safePlaudUrl(
        apiBase,
        `/user-app/auth/workspace/token/${encodeURIComponent(workspaceId)}`,
    );
    const res = await plaudFetch(url.toString(), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "User-Agent": PLAUD_USER_AGENT,
        },
        body: "{}",
    });

    if (!res.ok) {
        const status = res.status;
        const stale = status >= 400 && status < 500;
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
        throw new WorkspaceTokenError(message, {
            httpStatus: status,
            stale: status === 401 ? false : stale,
            code,
            statusCode,
        });
    }

    const body = await safeParseJson<PlaudWorkspaceTokenResponse>(res);
    if (body.status !== 0 || !body.data?.workspace_token) {
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

/** Resolve a WT; relist + retry on stale cache. */
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
