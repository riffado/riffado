import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, plaudDevices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";
import { serverKeyFromApiBase } from "@/lib/plaud/servers";

export const GET = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const [connection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, session.user.id))
        .limit(1);

    if (!connection) {
        return NextResponse.json({ connected: false });
    }

    const server = serverKeyFromApiBase(connection.apiBase);

    return NextResponse.json({
        connected: true,
        server,
        plaudEmail: connection.plaudEmail ?? null,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        // Include the raw URL so the UI can populate the custom field
        ...(server === "custom" && { apiBase: connection.apiBase }),
    });
});

/**
 * DELETE /api/plaud/connection
 *
 * Disconnects the current Plaud account for this user by deleting the
 * stored connection and its associated device rows. Synced recordings are
 * preserved — they remain in the user's OpenPlaud library.
 */
export const DELETE = apiHandler(async (request: Request) => {
    const session = await auth.api.getSession({
        headers: request.headers,
    });

    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    await db
        .delete(plaudDevices)
        .where(eq(plaudDevices.userId, session.user.id));

    await db
        .delete(plaudConnections)
        .where(eq(plaudConnections.userId, session.user.id));

    return NextResponse.json({ success: true });
});
