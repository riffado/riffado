import type { plaudConnections } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { AppError, ErrorCode } from "@/lib/errors";
import { captureServerException } from "@/lib/posthog-server";
import { buildPlaudTokenSet, plaudRefreshUserToken } from "./auth";
import { isPlaudTokenRejection, PlaudClient } from "./client";
import {
    backfillPlaudTokenExpiries,
    persistRefreshedPlaudTokens,
    type StoredPlaudTokenCiphertexts,
} from "./persist-connection";

/** Refresh the user token when it expires within this window. */
export const PLAUD_ACCESS_REFRESH_WINDOW_MS = 60 * 60 * 1000;

/** Stored connection fields needed to build an authenticated client. */
export type PlaudConnectionCredentials = Pick<
    typeof plaudConnections.$inferSelect,
    | "id"
    | "userId"
    | "bearerToken"
    | "refreshToken"
    | "accessExpiresAt"
    | "sessionExpiresAt"
    | "apiBase"
    | "workspaceId"
>;

/** True when a token expiring at `accessExpiresAt` should be refreshed before use. */
export function shouldRefreshPlaudAccessToken(
    accessExpiresAt: Date | null,
    now: Date = new Date(),
): boolean {
    if (!accessExpiresAt) return false;
    return (
        accessExpiresAt.getTime() - now.getTime() <=
        PLAUD_ACCESS_REFRESH_WINDOW_MS
    );
}

function dbErrorSummary(err: unknown): {
    errorName: string;
    causeCode: string | null;
} {
    const errorName = err instanceof Error ? err.name : typeof err;
    const cause = err instanceof Error ? err.cause : undefined;
    const causeCode =
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        typeof cause.code === "string"
            ? cause.code
            : null;
    return { errorName, causeCode };
}

interface RefreshedConnectionTokens {
    accessToken: string;
    refreshToken: string;
    stored: StoredPlaudTokenCiphertexts | null;
}

async function refreshConnectionTokens(
    connection: PlaudConnectionCredentials,
    storedRefreshToken: string,
    refreshToken: string,
): Promise<RefreshedConnectionTokens> {
    if (
        connection.sessionExpiresAt &&
        connection.sessionExpiresAt.getTime() <= Date.now()
    ) {
        throw new AppError(
            ErrorCode.PLAUD_INVALID_TOKEN,
            "Your Plaud sign-in has ended. Reconnect your Plaud account.",
            401,
            { reason: "session_expired" },
        );
    }

    const refreshed = await plaudRefreshUserToken(
        refreshToken,
        connection.apiBase,
    );
    const tokens = {
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? refreshToken,
    };

    let stored: StoredPlaudTokenCiphertexts | null = null;
    try {
        stored = await persistRefreshedPlaudTokens({
            userId: connection.userId,
            connectionId: connection.id,
            storedRefreshToken,
            tokens,
        });
        if (!stored) {
            console.info(
                "[plaud] refreshed tokens not stored: the connection changed since it was read",
            );
        }
    } catch (err) {
        const { errorName, causeCode } = dbErrorSummary(err);
        console.error(
            `[plaud] failed to store refreshed tokens (error=${errorName}, cause=${causeCode ?? "none"})`,
        );
        captureServerException(new Error("plaud_refresh_persist_failed"), {
            source: "plaud",
            distinctId: connection.userId,
            reason: "refresh_persist_failed",
            errorName,
            causeCode,
        });
    }

    return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        stored,
    };
}

async function backfillMissingExpiries(
    connection: PlaudConnectionCredentials,
    accessToken: string,
    refreshToken: string | null,
): Promise<Date | null> {
    if (connection.accessExpiresAt) return connection.accessExpiresAt;
    const { accessExpiresAt, sessionExpiresAt } = buildPlaudTokenSet({
        accessToken,
        refreshToken,
    });
    if (!accessExpiresAt) return null;
    try {
        await backfillPlaudTokenExpiries({
            userId: connection.userId,
            connectionId: connection.id,
            accessExpiresAt,
            sessionExpiresAt,
        });
    } catch (err) {
        const { errorName, causeCode } = dbErrorSummary(err);
        console.warn(
            `[plaud] failed to backfill token expiries (error=${errorName}, cause=${causeCode ?? "none"})`,
        );
    }
    return accessExpiresAt;
}

/** Options for `createPlaudClient`. */
export interface CreatePlaudClientOptions {
    /**
     * Called with the encrypted user token each time a refresh is stored, so
     * callers can match later writes against the row this client now owns.
     */
    onTokensStored?: (bearerToken: string) => void;
}

/**
 * Build a `PlaudClient` from a stored connection. When the connection has a
 * refresh token, refreshes the user token first if it expires within
 * `PLAUD_ACCESS_REFRESH_WINDOW_MS`, and lets the client refresh again on a
 * 401, including a 401 on the workspace-token mint. At most one refresh is
 * in flight; once one succeeds, or fails for a
 * transient reason (rate limit, upstream or network error), a later 401 may
 * refresh again. A rejected refresh is not retried. Refreshed tokens are
 * stored encrypted, scoped by user and connection id. Throws
 * `PLAUD_INVALID_TOKEN` when Plaud rejects the refresh token and the stored
 * user token has already expired, or the transient error when the refresh
 * fails and the user token has expired.
 */
export async function createPlaudClient(
    connection: PlaudConnectionCredentials,
    options: CreatePlaudClientOptions = {},
): Promise<PlaudClient> {
    const accessToken = decrypt(connection.bearerToken);
    const storedRefreshToken = connection.refreshToken;
    const refreshToken = storedRefreshToken
        ? decrypt(storedRefreshToken)
        : null;
    const accessExpiresAt = await backfillMissingExpiries(
        connection,
        accessToken,
        refreshToken,
    );

    if (!storedRefreshToken || !refreshToken) {
        return new PlaudClient(
            accessToken,
            connection.apiBase,
            connection.workspaceId,
            { connectionId: connection.id },
        );
    }

    let currentStoredRefreshToken = storedRefreshToken;
    let currentRefreshToken = refreshToken;
    let refreshing: Promise<string> | undefined;
    const refreshOnce = (): Promise<string> => {
        if (!refreshing) {
            const attempt = refreshConnectionTokens(
                connection,
                currentStoredRefreshToken,
                currentRefreshToken,
            ).then((refreshed) => {
                currentRefreshToken = refreshed.refreshToken;
                if (refreshed.stored) {
                    currentStoredRefreshToken = refreshed.stored.refreshToken;
                    options.onTokensStored?.(refreshed.stored.bearerToken);
                }
                return refreshed.accessToken;
            });
            refreshing = attempt;
            attempt.then(
                () => {
                    if (refreshing === attempt) refreshing = undefined;
                },
                (err: unknown) => {
                    if (!isPlaudTokenRejection(err) && refreshing === attempt) {
                        refreshing = undefined;
                    }
                },
            );
        }
        return refreshing;
    };

    let userToken = accessToken;
    let userTokenFresh = false;
    if (shouldRefreshPlaudAccessToken(accessExpiresAt)) {
        try {
            userToken = await refreshOnce();
            userTokenFresh = true;
        } catch (err) {
            const stillValid =
                accessExpiresAt !== null &&
                accessExpiresAt.getTime() > Date.now();
            if (!stillValid) throw err;
            console.warn(
                "[plaud] token refresh failed, using the current token until it expires:",
                err instanceof Error ? err.message : err,
            );
        }
    }

    return new PlaudClient(
        userToken,
        connection.apiBase,
        connection.workspaceId,
        {
            refreshUserToken: refreshOnce,
            connectionId: connection.id,
            userTokenFresh,
        },
    );
}
