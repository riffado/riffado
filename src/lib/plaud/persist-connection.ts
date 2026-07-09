import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { acquirePlaudConnectLock } from "@/db/queries/plaud-locks";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import type { PlaudDeviceListResponse } from "@/types/plaud";
import { PlaudClient } from "./client";
import { listPlaudWorkspaces, pickPersonalWorkspaceId } from "./workspace";

export interface PersistPlaudConnectionInput {
    userId: string;
    accessToken: string;
    apiBase: string;
    plaudEmail: string | null;
}

export interface PersistPlaudConnectionResult {
    devices: PlaudDeviceListResponse["data_devices"];
    workspaceId: string | null;
}

/** Validate a Plaud user token and persist the connection. Idempotent. */
export async function persistPlaudConnection({
    userId,
    accessToken,
    apiBase,
    plaudEmail,
}: PersistPlaudConnectionInput): Promise<PersistPlaudConnectionResult> {
    let resolvedWorkspaceId: string | null = null;
    try {
        const list = await listPlaudWorkspaces(accessToken, apiBase);
        resolvedWorkspaceId = pickPersonalWorkspaceId(list);
    } catch (err) {
        console.warn(
            "[plaud/persist] workspace discovery failed:",
            err instanceof Error ? err.message : err,
        );
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
        throw err;
    }

    const encryptedAccessToken = encrypt(accessToken);

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
                    bearerToken: encryptedAccessToken,
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
                bearerToken: encryptedAccessToken,
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

    return {
        devices: deviceList.data_devices,
        workspaceId: resolvedWorkspaceId,
    };
}
