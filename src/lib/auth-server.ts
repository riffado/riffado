import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "./auth";
import { AppError, ErrorCode } from "./errors";

/**
 * Get the current session on the server
 * Requires server component or API route
 */
export async function getSession() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return session;
}

/**
 * Require authentication - redirects to login if not authenticated, or to
 * /suspended if the user has been suspended by an admin (hosted mode only).
 * Use in server components.
 */
export async function requireAuth() {
    const session = await getSession();

    if (!session?.user) {
        redirect("/login");
    }

    // Hosted-mode suspension check. Cheap (PK lookup, indexed). Self-host
    // never sets suspendedAt because the admin gate is locked behind
    // IS_HOSTED, so this resolves to a no-op fast path there.
    const [u] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);
    if (u?.suspendedAt) {
        redirect("/suspended");
    }

    return session;
}

/**
 * Redirect to dashboard if already authenticated
 * Use in login/register pages
 */
export async function redirectIfAuthenticated() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
    }
}

/**
 * API-route variant of requireAuth. Use in /api/* route handlers that
 * operate on user-owned data. Throws an AppError on failure so the
 * surrounding `apiHandler` wrapper produces the unified error envelope.
 *
 *     export const GET = apiHandler(async (request) => {
 *         const session = await requireApiSession(request);
 *         // ...use session.user.id
 *     });
 *
 * Failure modes:
 *   - No session             -> AppError(AUTH_SESSION_MISSING, 401)
 *   - User row vanished      -> treated as authenticated; the next
 *                                 query that touches user-owned data
 *                                 will 404 naturally.
 *   - users.suspendedAt set  -> AppError(ACCOUNT_SUSPENDED, 403)
 *
 * The suspension check costs one indexed PK lookup. On self-host the
 * column is always null because the admin gate that sets it is locked
 * behind IS_HOSTED, so this is a no-op fast path there.
 */
export async function requireApiSession(
    request: Request,
): Promise<NonNullable<Awaited<ReturnType<typeof getSession>>>> {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
        throw new AppError(ErrorCode.AUTH_SESSION_MISSING, "Unauthorized", 401);
    }

    const [u] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

    if (u?.suspendedAt) {
        throw new AppError(
            ErrorCode.ACCOUNT_SUSPENDED,
            "Account suspended",
            403,
        );
    }

    return session;
}
