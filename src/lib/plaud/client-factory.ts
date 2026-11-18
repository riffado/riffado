import type { plaudConnections } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { AppError, ErrorCode } from "@/lib/errors";
import { captureServerException } from "@/lib/posthog-server";
import { buildPlaudTokenSet, plaudRefreshUserToken } from "./auth";
import { PlaudClient } from "./client";
import {
    backfillPlaudTokenExpiries,
    persistRefreshedPlaudTokens,
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

async function refreshConnectionTokens(
    connection: PlaudConnectionCredentials,
    refreshToken: string,
): Promise<string> {
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

    const tokens = await plaudRefreshUserToken(
        refreshToken,
        connection.apiBase,
    );

    try {
        await persistRefreshedPlaudTokens({
            userId: connection.userId,
            connectionId: connection.id,
            tokens,
        });
    } catch (err) {
        console.error(
            "[plaud] failed to store refreshed tokens:",
            err instanceof Error ? err.message : err,
        );
        captureServerException(err, {
            source: "plaud",
            distinctId: connection.userId,
            reason: "refresh_persist_failed",
        });
    }

    return tokens.accessToken;
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
        console.warn(
            "[plaud] failed to backfill token expiries:",
            err instanceof Error ? err.message : err,
        );
    }
    return accessExpiresAt;
}

/**
 * Build a `PlaudClient` from a stored connection. When the connection has a
 * refresh token, refreshes the user token first if it expires within
 * `PLAUD_ACCESS_REFRESH_WINDOW_MS`, and lets the client refresh once more on
 * a 401. Refreshed tokens are stored encrypted, scoped by user and
 * connection id. Throws `PLAUD_INVALID_TOKEN` when Plaud rejects the refresh
 * token and the stored user token has already expired.
 */
export async function createPlaudClient(
    connection: PlaudConnectionCredentials,
): Promise<PlaudClient> {
    const accessToken = decrypt(connection.bearerToken);
    const refreshToken = connection.refreshToken
        ? decrypt(connection.refreshToken)
        : null;
    const accessExpiresAt = await backfillMissingExpiries(
        connection,
        accessToken,
        refreshToken,
    );

    if (!refreshToken) {
        return new PlaudClient(
            accessToken,
            connection.apiBase,
            connection.workspaceId,
        );
    }

    let refreshing: Promise<string> | undefined;
    const refreshOnce = (): Promise<string> => {
        refreshing ??= refreshConnectionTokens(connection, refreshToken);
        return refreshing;
    };

    let userToken = accessToken;
    if (shouldRefreshPlaudAccessToken(accessExpiresAt)) {
        try {
            userToken = await refreshOnce();
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
        },
    );
}
