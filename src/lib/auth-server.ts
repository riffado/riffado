import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { userSettings, users } from "@/db/schema";
import { auth } from "./auth";
import { AppError, ErrorCode } from "./errors";

export async function getSession() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return session;
}

/** Require an authenticated, non-suspended session. Redirects on failure. */
export async function requireAuth() {
    const session = await getSession();

    if (!session?.user) {
        redirect("/login");
    }

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
 * Redirects to `/dashboard` unless the session's account has finished
 * onboarding (`userSettings.onboardingCompleted`). Call after
 * `requireAuth()` from any authenticated content page other than
 * `/dashboard` itself, which owns the mandatory onboarding dialog and
 * must not redirect into itself.
 *
 * Deliberately separate from `requireAuth()` (rather than folded into
 * it) so it doesn't blanket-apply to every `requireAuth()` caller --
 * notably `/dev/demo-dashboard`, which renders fixtures, not a real
 * account, and must never be gated on this.
 */
export async function requireCompletedOnboarding(
    session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
) {
    const [row] = await db
        .select({ onboardingCompleted: userSettings.onboardingCompleted })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    if (!row?.onboardingCompleted) {
        redirect("/dashboard");
    }
}

export async function redirectIfAuthenticated() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
    }
}

/** API-route auth gate. Throws typed `AppError` on failure. */
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
