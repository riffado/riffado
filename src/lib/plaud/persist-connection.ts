import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { acquirePlaudConnectLock } from "@/db/queries/plaud-locks";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import {
    captureServerEvent,
    captureServerException,
} from "@/lib/posthog-server";
import type { PlaudDeviceListResponse } from "@/types/plaud";
import type { PlaudTokenSet } from "./auth";
import { PlaudClient } from "./client";
import { listPlaudWorkspaces, pickPersonalWorkspaceId } from "./workspace";

export interface PersistPlaudConnectionInput {
    userId: string;
    /** User token plus optional refresh token and expiries. Tokens are encrypted before storage. */
    tokens: PlaudTokenSet;
    apiBase: string;
    plaudEmail: string | null;
    /** How this connection was established. Drives the `plaud_connected` event's `method` property. */
    method: "otp" | "paste" | "connector" | "unknown";
}

export interface PersistPlaudConnectionResult {
    devices: PlaudDeviceListResponse["data_devices"];
    workspaceId: string | null;
}

/** Validate a Plaud user token and persist the connection. Idempotent. */
export async function persistPlaudConnection({
    userId,
    tokens,
    apiBase,
    plaudEmail,
    method,
}: PersistPlaudConnectionInput): Promise<PersistPlaudConnectionResult> {
    const { accessToken } = tokens;
    let resolvedWorkspaceId: string | null = null;
    try {
        const list = await listPlaudWorkspaces(accessToken, apiBase);
        resolvedWorkspaceId = pickPersonalWorkspaceId(list);
    } catch (err) {
        console.warn(
            "[plaud/persist] workspace discovery failed:",
            err instanceof Error ? err.message : err,
        );
        captureServerException(err, {
            source: "plaud",
            distinctId: userId,
            reason: "workspace_discovery_failed",
        });
    }

    const client = new PlaudClient(accessToken, apiBase, resolvedWorkspaceId);
    let deviceList: PlaudDeviceListResponse;
    try {
        deviceList = await client.listDevices();
    } catch (err) {
        console.warn(
            "[plaud/persist] device list validation failed:",
            err instanceof Error ? err.message : err,
        );
        captureServerException(err, {
            source: "plaud",
            distinctId: userId,
            reason: "device_list_failed",
        });
        throw err;
    }

    const tokenColumns = {
        bearerToken: encrypt(accessToken),
        refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        accessExpiresAt: tokens.accessExpiresAt,
        sessionExpiresAt: tokens.sessionExpiresAt,
    };

    await db.transaction(async (tx) => {
        await acquirePlaudConnectLock(tx, userId);

        const [existingConnection] = await tx
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, userId))
            .limit(1);

        if (existingConnection) {
            await tx
                .update(plaudConnections)
                .set({
                    ...tokenColumns,
                    apiBase,
                    plaudEmail,
                    workspaceId: resolvedWorkspaceId,
                    // Reconnecting with a fresh token clears any prior
                    // "needs reconnect" state so the banner disappears.
                    invalidatedAt: null,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(plaudConnections.id, existingConnection.id),
                        eq(plaudConnections.userId, userId),
                    ),
                );
        } else {
            await tx.insert(plaudConnections).values({
                userId,
                ...tokenColumns,
                apiBase,
                plaudEmail,
                workspaceId: resolvedWorkspaceId,
            });
        }

        for (const device of deviceList.data_devices) {
            const [existingDevice] = await tx
                .select()
                .from(plaudDevices)
                .where(
                    and(
                        eq(plaudDevices.userId, userId),
                        eq(plaudDevices.serialNumber, device.sn),
                    ),
                )
                .limit(1);

            if (existingDevice) {
                await tx
                    .update(plaudDevices)
                    .set({
                        name: device.name,
                        model: device.model,
                        versionNumber: device.version_number,
                        updatedAt: new Date(),
                    })
                    .where(eq(plaudDevices.id, existingDevice.id));
            } else {
                await tx.insert(plaudDevices).values({
                    userId,
                    serialNumber: device.sn,
                    name: device.name,
                    model: device.model,
                    versionNumber: device.version_number,
                });
            }
        }
    });

    await captureServerEvent({
        distinctId: userId,
        event: "plaud_connected",
        properties: { method, device_count: deviceList.data_devices.length },
    });

    return {
        devices: deviceList.data_devices,
        workspaceId: resolvedWorkspaceId,
    };
}

export interface PersistRefreshedPlaudTokensInput {
    userId: string;
    connectionId: string;
    /** Encrypted refresh token exactly as read from the row before refreshing. */
    storedRefreshToken: string;
    /** Refreshed tokens. The refresh token is re-encrypted on every write. */
    tokens: PlaudTokenSet & { refreshToken: string };
}

/** Encrypted tokens as written to `plaud_connections` by a refresh. */
export interface StoredPlaudTokenCiphertexts {
    bearerToken: string;
    refreshToken: string;
}

/**
 * Store the tokens returned by a refresh, scoped by user and connection id.
 * Compare-and-swap on `storedRefreshToken`: encryption uses a random IV, so
 * a reconnect or another refresh changes the stored ciphertext and turns
 * this write into a no-op. A known `sessionExpiresAt` is never replaced with
 * null. Returns the ciphertexts written, or null when the row was not
 * updated.
 */
export async function persistRefreshedPlaudTokens({
    userId,
    connectionId,
    storedRefreshToken,
    tokens,
}: PersistRefreshedPlaudTokensInput): Promise<StoredPlaudTokenCiphertexts | null> {
    const stored: StoredPlaudTokenCiphertexts = {
        bearerToken: encrypt(tokens.accessToken),
        refreshToken: encrypt(tokens.refreshToken),
    };
    const updated = await db
        .update(plaudConnections)
        .set({
            ...stored,
            accessExpiresAt: tokens.accessExpiresAt,
            ...(tokens.sessionExpiresAt
                ? { sessionExpiresAt: tokens.sessionExpiresAt }
                : {}),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(plaudConnections.id, connectionId),
                eq(plaudConnections.userId, userId),
                eq(plaudConnections.refreshToken, storedRefreshToken),
            ),
        )
        .returning({ id: plaudConnections.id });

    return updated.length > 0 ? stored : null;
}

export interface MarkPlaudConnectionInvalidatedInput {
    userId: string;
    connectionId: string;
    /** Encrypted user token the failing client was built from or last stored. */
    bearerToken: string;
}

/**
 * Flag the connection as needing a reconnect, scoped by user and connection
 * id. Compare-and-swap on `bearerToken`, so a failure from a stale read
 * never flags a connection that a reconnect or another refresh has since
 * replaced. Returns true when the row was updated.
 */
export async function markPlaudConnectionInvalidated({
    userId,
    connectionId,
    bearerToken,
}: MarkPlaudConnectionInvalidatedInput): Promise<boolean> {
    const updated = await db
        .update(plaudConnections)
        .set({ invalidatedAt: new Date() })
        .where(
            and(
                eq(plaudConnections.id, connectionId),
                eq(plaudConnections.userId, userId),
                eq(plaudConnections.bearerToken, bearerToken),
            ),
        )
        .returning({ id: plaudConnections.id });

    return updated.length > 0;
}

export interface BackfillPlaudTokenExpiriesInput {
    userId: string;
    connectionId: string;
    accessExpiresAt: Date;
    sessionExpiresAt: Date | null;
}

/**
 * Record expiries for a connection stored before they were tracked. Only
 * writes while `accessExpiresAt` is still null, so it never overwrites a
 * value set by a connect or refresh.
 */
export async function backfillPlaudTokenExpiries({
    userId,
    connectionId,
    accessExpiresAt,
    sessionExpiresAt,
}: BackfillPlaudTokenExpiriesInput): Promise<void> {
    await db
        .update(plaudConnections)
        .set({ accessExpiresAt, sessionExpiresAt })
        .where(
            and(
                eq(plaudConnections.id, connectionId),
                eq(plaudConnections.userId, userId),
                isNull(plaudConnections.accessExpiresAt),
            ),
        );
}
