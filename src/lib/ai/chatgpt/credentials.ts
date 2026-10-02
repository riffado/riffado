/**
 * Storage and refresh for "Sign in with ChatGPT" credentials.
 *
 * A ChatGPT connection is an ordinary `api_credentials` row with
 * `provider = "ChatGPT"`. Instead of an API key, the encrypted `api_key`
 * column holds a JSON document with the issued OAuth client id, the
 * stable host id, the validated identity and the token set. Reusing the
 * row (and its AES-256-GCM envelope) keeps provider selection, defaults
 * and deletion working unchanged, and needs no schema migration.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/encryption";
import { AppError, ErrorCode } from "@/lib/errors";
import {
    isReauthRequiredError,
    refreshAccessToken,
    type TokenResponse,
} from "./oauth";
import { CHATGPT_PROVIDER_NAME, reconnectError } from "./shared";

export interface ChatGptCredential {
    v: 1;
    /** Issued `oaiapp_...` client id, reused for every later sign-in. */
    clientId: string;
    /** Stable `ext_agent_host_id` for this Riffado instance + user. */
    hostId: string;
    /** Validated ID token subject. */
    subject: string;
    email: string | null;
    /** Kept for `id_token_hint` on re-authorization. */
    idToken: string | null;
    accessToken: string;
    refreshToken: string | null;
    /** Access token expiry, epoch ms. */
    expiresAt: number;
    /** Don't refresh before this (epoch ms) unless the token expired. */
    earliestRefreshAt: number | null;
    scopes: string[];
}

export function serializeCredential(credential: ChatGptCredential): string {
    return encrypt(JSON.stringify(credential));
}

export function parseCredential(encrypted: string): ChatGptCredential {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decrypt(encrypted));
    } catch {
        throw reconnectError();
    }
    const c = parsed as Partial<ChatGptCredential> | null;
    if (
        !c ||
        c.v !== 1 ||
        typeof c.clientId !== "string" ||
        typeof c.hostId !== "string" ||
        typeof c.accessToken !== "string" ||
        typeof c.expiresAt !== "number"
    ) {
        throw reconnectError();
    }
    return c as ChatGptCredential;
}

/** `earliest_refresh_at` unit isn't documented; accept seconds or ms. */
function toEpochMs(value: number | undefined): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
}

/** Merge a token endpoint response into a stored credential. */
export function applyTokenResponse(
    base: Omit<
        ChatGptCredential,
        | "accessToken"
        | "refreshToken"
        | "expiresAt"
        | "earliestRefreshAt"
        | "scopes"
    > &
        Partial<Pick<ChatGptCredential, "refreshToken" | "scopes">>,
    tokens: TokenResponse,
    now = Date.now(),
): ChatGptCredential {
    const expiresIn =
        typeof tokens.expires_in === "number" && tokens.expires_in > 0
            ? tokens.expires_in
            : 3600;
    return {
        ...base,
        v: 1,
        idToken: tokens.id_token ?? base.idToken,
        accessToken: tokens.access_token,
        // Refresh tokens rotate; keep the old one only if none came back.
        refreshToken: tokens.refresh_token ?? base.refreshToken ?? null,
        expiresAt: now + expiresIn * 1000,
        earliestRefreshAt: toEpochMs(tokens.earliest_refresh_at),
        scopes: tokens.scope
            ? tokens.scope.split(/\s+/).filter(Boolean)
            : (base.scopes ?? []),
    };
}

/** Refresh when less than this much lifetime is left. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export function needsRefresh(
    credential: ChatGptCredential,
    now = Date.now(),
): boolean {
    if (credential.expiresAt - now > REFRESH_MARGIN_MS) return false;
    const expired = credential.expiresAt <= now;
    if (
        !expired &&
        credential.earliestRefreshAt !== null &&
        now < credential.earliestRefreshAt
    ) {
        return false;
    }
    return true;
}

/**
 * Refresh tokens rotate and OpenAI rejects a reused refresh token
 * (`refresh_token_reused`), so two callers must never refresh the same
 * row at once. Within one process, concurrent callers (auto-title and
 * auto-summary right after a transcription) share one in-flight refresh.
 * Across processes, and against a reconnect landing mid-refresh, the
 * read-refresh-write runs in a transaction holding a row lock
 * (`SELECT ... FOR UPDATE`): a second refresher waits and then sees the
 * already-rotated tokens, and a reconnect's write lands after ours
 * instead of being overwritten by it.
 */
const inflightRefresh = new Map<string, Promise<ChatGptCredential>>();

async function refreshAndPersist(row: {
    id: string;
    userId: string;
}): Promise<ChatGptCredential> {
    return db.transaction(async (tx) => {
        const [stored] = await tx
            .select({ apiKey: apiCredentials.apiKey })
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, row.id),
                    eq(apiCredentials.userId, row.userId),
                ),
            )
            .limit(1)
            .for("update");
        if (!stored) throw reconnectError();

        // Re-read under the lock: another request or replica may have
        // refreshed (or the user reconnected) since the caller loaded
        // its row.
        const credential = parseCredential(stored.apiKey);
        if (!needsRefresh(credential)) return credential;
        if (!credential.refreshToken) throw reconnectError();

        let tokens: TokenResponse;
        try {
            tokens = await refreshAccessToken({
                clientId: credential.clientId,
                refreshToken: credential.refreshToken,
            });
        } catch (error) {
            if (isReauthRequiredError(error)) throw reconnectError();
            throw new AppError(
                ErrorCode.AI_PROVIDER_API_ERROR,
                "Couldn't refresh the ChatGPT sign-in. Try again in a moment.",
                502,
                { provider: CHATGPT_PROVIDER_NAME },
            );
        }

        const next = applyTokenResponse(credential, tokens);
        await tx
            .update(apiCredentials)
            .set({ apiKey: serializeCredential(next), updatedAt: new Date() })
            .where(
                and(
                    eq(apiCredentials.id, row.id),
                    eq(apiCredentials.userId, row.userId),
                ),
            );
        return next;
    });
}

/**
 * Return a usable access token for a ChatGPT credential row, refreshing
 * (and persisting the rotated tokens) when it's close to expiry.
 */
export async function getChatGptAccessToken(row: {
    id: string;
    userId: string;
    apiKey: string;
}): Promise<string> {
    const credential = parseCredential(row.apiKey);
    if (!needsRefresh(credential)) return credential.accessToken;

    let pending = inflightRefresh.get(row.id);
    if (!pending) {
        pending = refreshAndPersist(row).finally(() => {
            inflightRefresh.delete(row.id);
        });
        inflightRefresh.set(row.id, pending);
    }
    const refreshed = await pending;
    return refreshed.accessToken;
}
