import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { apiHandler } from "@/lib/errors";
import { createPlaudClient } from "@/lib/plaud/client-factory";

/**
 * GET /api/plaud/health
 *
 * Lightweight liveness probe for the user's Plaud connection. Unlike
 * /api/plaud/connection (which only checks the DB row), this actually calls
 * the Plaud API and reports whether the stored token is still valid.
 *
 * Used by the client-side background health-check that runs every 10 minutes
 * while the user is on the dashboard. Fast path: if no connection row exists,
 * returns { healthy: false, reason: "no_connection" } without hitting Plaud.
 *
 * Response:
 *   { healthy: true }
 *   { healthy: false, reason: "no_connection" | "token_invalid" | "network_error" }
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const [connection] = await db
        .select()
        .from(plaudConnections)
        .where(eq(plaudConnections.userId, session.user.id))
        .limit(1);

    if (!connection) {
        return NextResponse.json({ healthy: false, reason: "no_connection" });
    }

    try {
        const client = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
            connection.workspaceId ?? undefined,
        );
        const ok = await client.testConnection();
        return NextResponse.json(
            ok
                ? { healthy: true }
                : { healthy: false, reason: "token_invalid" },
        );
    } catch {
        return NextResponse.json({
            healthy: false,
            reason: "network_error",
        });
    }
});
