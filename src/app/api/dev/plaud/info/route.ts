import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import type { PlaudClient } from "@/lib/plaud/client";
import { createPlaudClient } from "@/lib/plaud/client-factory";
import { isPlaudProxyConfigured } from "@/lib/plaud/proxy";
import { serverKeyFromApiBase } from "@/lib/plaud/servers";

/**
 * Dev-only introspection endpoint.
 * Returns stored Plaud connection metadata plus live counts from the Plaud API.
 * Disabled in production builds.
 */
export const GET = apiHandler(async (request: Request) => {
    if (process.env.NODE_ENV === "production") {
        throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
    }

    const session = await requireApiSession(request);

    const [connection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, session.user.id))
        .limit(1);

    if (!connection) {
        return NextResponse.json({ connected: false });
    }

    const startedAt = Date.now();
    let client: PlaudClient | null = null;
    let reachable = false;
    let deviceCount: number | null = null;
    let activeRecordingCount: number | null = null;
    let trashedRecordingCount: number | null = null;
    let errorMessage: string | null = null;

    try {
        client = await createPlaudClient(connection);
        const [devices, active, trash] = await Promise.all([
            client.listDevices(),
            client.getRecordings(0, 1, 0),
            client.getRecordings(0, 1, 1),
        ]);
        reachable = true;
        deviceCount = devices.data_devices?.length ?? 0;
        activeRecordingCount =
            active.data_file_total ?? active.data_file_list?.length ?? 0;
        trashedRecordingCount = client.usingPlaudV4
            ? null
            : (trash.data_file_total ?? trash.data_file_list?.length ?? 0);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = Date.now() - startedAt;
    const resolvedWorkspaceId = client?.workspaceId;

    return NextResponse.json({
        connected: true,
        reachable,
        latencyMs,
        error: errorMessage,
        usingPlaudProxy: isPlaudProxyConfigured(),
        connection: {
            id: connection.id,
            apiBase: connection.apiBase,
            server: serverKeyFromApiBase(connection.apiBase),
            plaudEmail: connection.plaudEmail,
            workspaceId: resolvedWorkspaceId ?? connection.workspaceId,
            workspaceIdSource:
                resolvedWorkspaceId &&
                resolvedWorkspaceId !== connection.workspaceId
                    ? "resolved"
                    : connection.workspaceId
                      ? "cache"
                      : resolvedWorkspaceId
                        ? "resolved"
                        : "unresolved",
            workspaceTokenFallback: client?.usingUserTokenFallback ?? false,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
        },
        stats: {
            deviceCount,
            activeRecordingCount,
            trashedRecordingCount,
        },
    });
});
