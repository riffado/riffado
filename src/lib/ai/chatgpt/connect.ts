/**
 * Connect / disconnect flow for the ChatGPT plan-usage provider, plus
 * the single entry point enhancement code calls to run a completion.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/encryption";
import { AppError, ErrorCode } from "@/lib/errors";
import {
    applyTokenResponse,
    type ChatGptCredential,
    getChatGptAccessToken,
    parseCredential,
    serializeCredential,
} from "./credentials";
import { assertChatGptPlanUsageEnabled } from "./feature";
import {
    type ChatGptModel,
    createChatGptResponse,
    listChatGptModels,
} from "./inference";
import {
    assertPlanUsageGranted,
    buildAuthorizeUrl,
    ChatGptOAuthError,
    exchangeAuthorizationCode,
    generateHostId,
    generatePkce,
    parseCallbackUrl,
    randomToken,
    revokeRefreshToken,
    type TokenResponse,
    verifyIdToken,
} from "./oauth";
import { CHATGPT_BASE_URL, CHATGPT_PROVIDER_NAME } from "./shared";

/** How long a started sign-in stays valid. */
export const PENDING_SIGN_IN_TTL_MS = 10 * 60 * 1000;

/** Server-side state between "start" and "complete", sealed in a cookie. */
export interface PendingSignIn {
    userId: string;
    state: string;
    nonce: string;
    codeVerifier: string;
    hostId: string;
    /** Issued client id when re-authorizing an existing connection. */
    clientId: string | null;
    createdAt: number;
}

export function sealPendingSignIn(pending: PendingSignIn): string {
    return encrypt(JSON.stringify(pending));
}

export function unsealPendingSignIn(
    sealed: string | undefined | null,
    userId: string,
    now = Date.now(),
): PendingSignIn {
    const expired = new AppError(
        ErrorCode.INVALID_INPUT,
        "This ChatGPT sign-in has expired. Click “Sign in with ChatGPT” again.",
        400,
    );
    if (!sealed) throw expired;
    let pending: PendingSignIn;
    try {
        pending = JSON.parse(decrypt(sealed)) as PendingSignIn;
    } catch {
        throw expired;
    }
    if (
        pending.userId !== userId ||
        typeof pending.createdAt !== "number" ||
        now - pending.createdAt > PENDING_SIGN_IN_TTL_MS
    ) {
        throw expired;
    }
    return pending;
}

async function findChatGptRow(userId: string) {
    const [row] = await db
        .select()
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.provider, CHATGPT_PROVIDER_NAME),
            ),
        )
        .limit(1);
    return row;
}

function tryParse(encrypted: string): ChatGptCredential | null {
    try {
        return parseCredential(encrypted);
    } catch {
        return null;
    }
}

/**
 * Begin a sign-in. Re-uses the issued client id and host id of an
 * existing connection, as OpenAI asks, so reconnecting doesn't register
 * a new client every time.
 */
export async function startChatGptSignIn(userId: string): Promise<{
    authorizeUrl: string;
    pending: PendingSignIn;
}> {
    const existingRow = await findChatGptRow(userId);
    const existing = existingRow ? tryParse(existingRow.apiKey) : null;

    const { verifier, challenge } = generatePkce();
    const pending: PendingSignIn = {
        userId,
        state: randomToken(),
        nonce: randomToken(),
        codeVerifier: verifier,
        hostId: existing?.hostId ?? generateHostId(),
        clientId: existing?.clientId ?? null,
        createdAt: Date.now(),
    };

    const authorizeUrl = buildAuthorizeUrl({
        clientId: pending.clientId,
        hostId: pending.hostId,
        state: pending.state,
        nonce: pending.nonce,
        codeChallenge: challenge,
        idTokenHint: existing?.idToken ?? null,
        loginHint: existing?.email ?? null,
    });

    return { authorizeUrl, pending };
}

function toAppError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof ChatGptOAuthError) {
        return new AppError(
            ErrorCode.INVALID_INPUT,
            error.code === "insufficient_scope"
                ? error.message
                : error.code === "invalid_grant"
                  ? "That sign-in link was already used or has expired. Click “Sign in with ChatGPT” again."
                  : `ChatGPT sign-in failed: ${error.message}`,
            400,
            { provider: CHATGPT_PROVIDER_NAME, upstreamCode: error.code },
        );
    }
    return new AppError(
        ErrorCode.AI_PROVIDER_API_ERROR,
        "ChatGPT sign-in failed. Try again.",
        502,
        { provider: CHATGPT_PROVIDER_NAME },
    );
}

export interface ConnectResult {
    id: string;
    email: string | null;
    defaultModel: string | null;
    models: ChatGptModel[];
}

/**
 * Finish a sign-in from the loopback URL the user pasted back: verify
 * state, exchange the code, validate the ID token and granted scopes,
 * then create or update the user's ChatGPT provider row.
 */
export async function completeChatGptSignIn(args: {
    userId: string;
    pending: PendingSignIn;
    callbackUrl: string;
}): Promise<ConnectResult> {
    const { userId, pending } = args;

    const parsed = parseCallbackUrl(args.callbackUrl);
    if (!parsed.ok) {
        throw new AppError(ErrorCode.INVALID_INPUT, parsed.message, 400, {
            field: "callbackUrl",
        });
    }
    if (parsed.state !== pending.state) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "That URL belongs to a different sign-in attempt. Click “Sign in with ChatGPT” again and paste the new URL.",
            400,
            { field: "callbackUrl" },
        );
    }

    // A new registration returns the issued client id on the callback.
    const clientId = parsed.clientId ?? pending.clientId;
    if (!clientId) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "The URL is missing the client_id OpenAI issued. Copy the full address, including everything after the ?.",
            400,
            { field: "callbackUrl" },
        );
    }

    let tokens: TokenResponse;
    try {
        tokens = await exchangeAuthorizationCode({
            clientId,
            code: parsed.code,
            codeVerifier: pending.codeVerifier,
        });
    } catch (error) {
        throw toAppError(error);
    }

    // From here on OpenAI has issued a refresh token. Any failure before
    // it's stored must revoke it, or it stays live with no copy left in
    // Riffado to revoke later.
    const revokeIssued = () =>
        tokens.refresh_token
            ? revokeRefreshToken({
                  clientId,
                  refreshToken: tokens.refresh_token,
              })
            : Promise.resolve(false);

    let credential: ChatGptCredential;
    try {
        assertPlanUsageGranted(tokens.scope);
        if (!tokens.id_token) {
            throw new ChatGptOAuthError(
                "No ID token was returned",
                "invalid_id_token",
                400,
            );
        }
        const claims = await verifyIdToken(tokens.id_token, {
            clientId,
            nonce: pending.nonce,
        });
        credential = applyTokenResponse(
            {
                v: 1,
                clientId,
                hostId: pending.hostId,
                subject: claims.sub,
                email: claims.email,
                idToken: tokens.id_token,
            },
            tokens,
        );
    } catch (error) {
        await revokeIssued();
        throw toAppError(error);
    }

    // The model list is a convenience, not a requirement: a temporary
    // models outage must not throw away a valid, already-spent sign-in.
    let models: ChatGptModel[] = [];
    try {
        models = await listChatGptModels(credential.accessToken);
    } catch (error) {
        console.warn(
            "[chatgpt] listing plan models after sign-in failed",
            error,
        );
    }

    const sealed = serializeCredential(credential);

    let saved: { id: string; defaultModel: string | null };
    try {
        saved = await db.transaction(async (tx) => {
            // Serialize connects per user so two sign-ins finishing at once
            // (double click, two tabs) can't each insert a ChatGPT row.
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`chatgpt-connect:${userId}`}, 0))`,
            );

            const [existing] = await tx
                .select({
                    id: apiCredentials.id,
                    defaultModel: apiCredentials.defaultModel,
                })
                .from(apiCredentials)
                .where(
                    and(
                        eq(apiCredentials.userId, userId),
                        eq(apiCredentials.provider, CHATGPT_PROVIDER_NAME),
                    ),
                )
                .limit(1)
                .for("update");

            // Keep the user's model on reconnect if the plan still offers it
            // (or if the list couldn't be loaded; it's re-checked per request).
            const keepExisting =
                existing?.defaultModel &&
                (models.length === 0 ||
                    models.some((m) => m.slug === existing.defaultModel));
            const model = keepExisting
                ? existing.defaultModel
                : (models[0]?.slug ?? null);

            if (existing) {
                await tx
                    .update(apiCredentials)
                    .set({
                        apiKey: sealed,
                        baseUrl: CHATGPT_BASE_URL,
                        defaultModel: model,
                        isDefaultTranscription: false,
                        updatedAt: new Date(),
                    })
                    .where(
                        and(
                            eq(apiCredentials.id, existing.id),
                            eq(apiCredentials.userId, userId),
                        ),
                    );
                return { id: existing.id, defaultModel: model };
            }

            // First connection: become the enhancement default unless the
            // user already picked one.
            const [currentDefault] = await tx
                .select({ id: apiCredentials.id })
                .from(apiCredentials)
                .where(
                    and(
                        eq(apiCredentials.userId, userId),
                        eq(apiCredentials.isDefaultEnhancement, true),
                    ),
                )
                .limit(1);

            const [inserted] = await tx
                .insert(apiCredentials)
                .values({
                    userId,
                    provider: CHATGPT_PROVIDER_NAME,
                    apiKey: sealed,
                    baseUrl: CHATGPT_BASE_URL,
                    defaultModel: model,
                    isDefaultTranscription: false,
                    isDefaultEnhancement: !currentDefault,
                })
                .returning({ id: apiCredentials.id });
            return { id: inserted.id, defaultModel: model };
        });
    } catch (error) {
        await revokeIssued();
        throw error;
    }
    const { id, defaultModel } = saved;

    if (models.length > 0) {
        setCachedModels(id, models);
    }
    return { id, email: credential.email, defaultModel, models };
}

/**
 * Revoke the stored refresh token before a ChatGPT row is deleted.
 * Returns false when OpenAI didn't confirm, so the caller can warn the
 * user to revoke Riffado in ChatGPT's settings.
 */
export async function revokeChatGptCredential(
    encrypted: string,
): Promise<boolean> {
    const credential = tryParse(encrypted);
    // Unreadable: we can't confirm anything, so let the caller warn.
    if (!credential) return false;
    // Nothing long-lived to revoke.
    if (!credential.refreshToken) return true;
    return revokeRefreshToken({
        clientId: credential.clientId,
        refreshToken: credential.refreshToken,
    });
}

/** Signed-in account email for display; null if unreadable. */
export function chatGptAccountEmail(encrypted: string): string | null {
    return tryParse(encrypted)?.email ?? null;
}

/**
 * Plan model lists change rarely; cache per credential so every summary
 * can validate its model without an extra round trip.
 */
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const modelCache = new Map<
    string,
    { models: ChatGptModel[]; fetchedAt: number }
>();

/** Test hook. */
export function resetChatGptModelCache(): void {
    modelCache.clear();
}

function setCachedModels(credentialId: string, models: ChatGptModel[]): void {
    // Sweep expired entries on write so deleted or abandoned credentials
    // don't accumulate (one entry per ChatGPT connection, at most).
    const now = Date.now();
    for (const [key, entry] of modelCache) {
        if (now - entry.fetchedAt >= MODEL_CACHE_TTL_MS) modelCache.delete(key);
    }
    modelCache.set(credentialId, { models, fetchedAt: now });
}

/** Drop cached models for a credential (called when it's deleted). */
export function forgetChatGptModels(credentialId: string): void {
    modelCache.delete(credentialId);
}

async function getPlanModels(
    credentialId: string,
    accessToken: string,
): Promise<ChatGptModel[]> {
    const cached = modelCache.get(credentialId);
    if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
        return cached.models;
    }
    const models = await listChatGptModels(accessToken);
    setCachedModels(credentialId, models);
    return models;
}

export async function listModelsForCredential(row: {
    id: string;
    userId: string;
    apiKey: string;
}): Promise<ChatGptModel[]> {
    const accessToken = await getChatGptAccessToken(row);
    const models = await listChatGptModels(accessToken);
    setCachedModels(row.id, models);
    return models;
}

/**
 * Pick the model to run: the requested/default slug if the plan still
 * offers it, otherwise the plan's first model. A stale saved slug (the
 * plan changed, or OpenAI retired a model) shouldn't break every
 * summary. If the model list can't be loaded, fall back to the saved
 * slug rather than failing before the real request.
 */
export async function resolveChatGptModel(
    credentialId: string,
    accessToken: string,
    preferred: string | null,
): Promise<string | null> {
    let models: ChatGptModel[];
    try {
        models = await getPlanModels(credentialId, accessToken);
    } catch (error) {
        if (preferred) return preferred;
        throw error;
    }
    if (preferred && models.some((m) => m.slug === preferred)) {
        return preferred;
    }
    return models[0]?.slug ?? preferred;
}

/**
 * Run a summary/title completion on the user's ChatGPT plan. Used by
 * the enhancement call sites in place of `chat.completions.create`.
 */
export async function runChatGptCompletion(
    row: {
        id: string;
        userId: string;
        apiKey: string;
        defaultModel: string | null;
    },
    args: { model?: string | null; instructions: string; input: string },
): Promise<{ text: string; model: string }> {
    // A connection made while the flag was on stops being used the moment
    // an operator turns it off.
    assertChatGptPlanUsageEnabled();
    const accessToken = await getChatGptAccessToken(row);
    const model = await resolveChatGptModel(
        row.id,
        accessToken,
        args.model || row.defaultModel || null,
    );
    if (!model) {
        throw new AppError(
            ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
            "No ChatGPT models are available for this account.",
            400,
            { provider: CHATGPT_PROVIDER_NAME },
        );
    }
    const text = await createChatGptResponse({
        accessToken,
        model,
        instructions: args.instructions,
        input: args.input,
    });
    return { text, model };
}
