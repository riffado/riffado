import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { headers as nextHeaders } from "next/headers";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
    ADMIN_ELEVATED_COOKIE,
    signElevatedCookie,
} from "@/lib/hosted/admin/elevated-cookie";
import {
    clientIpFromHeaders,
    ipMatchesAllowlist,
} from "@/lib/hosted/admin/ip-allowlist";

/**
 * Admin password reprompt. Verifies the current user's password (via
 * better-auth's signIn endpoint) and, on success, sets a signed
 * `riffado_admin_elev` cookie that gates the rest of /admin/*.
 *
 * Failure modes all return 404 to avoid leaking the existence of the route
 * to non-admins.
 */
export async function POST(request: Request) {
    if (!env.IS_HOSTED) notFound();
    if (env.ADMIN_EMAILS.length === 0) notFound();

    const hdrs = await nextHeaders();
    if (env.ADMIN_IP_ALLOWLIST.length > 0) {
        const ip = clientIpFromHeaders(hdrs);
        if (!ipMatchesAllowlist(ip, env.ADMIN_IP_ALLOWLIST)) notFound();
    }

    const session = await auth.api.getSession({ headers: hdrs });
    if (!session?.user) notFound();
    const email = session.user.email?.trim().toLowerCase();
    if (!email || !env.ADMIN_EMAILS.includes(email)) notFound();

    let body: { password?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const password = body.password;
    if (typeof password !== "string" || password.length === 0) {
        return NextResponse.json(
            { error: "password_required" },
            { status: 400 },
        );
    }

    // Primitive password verification against the credentials-provider row
    // in the accounts table. We deliberately DO NOT call signInEmail here
    // because it has side effects we don't want for reauth:
    //   - creates a new session row (would accumulate one row per reauth)
    //   - may rotate the user's session cookie via Set-Cookie that we'd
    //     then need to forward, complicating this route's contract
    //   - returns ambiguous shapes on failure depending on better-auth
    //     version (throw vs { error })
    //
    // Going straight at verifyPassword + the existing accounts row is the
    // narrow operation we actually need: "is this the right password?".
    const [credAccount] = await db
        .select({ password: accounts.password })
        .from(accounts)
        .where(
            and(
                eq(accounts.userId, session.user.id),
                eq(accounts.providerId, "credential"),
            ),
        )
        .limit(1);

    if (!credAccount?.password) {
        // No credentials row (e.g. user only has OAuth). Admin reauth via
        // password is not available for them. 401 -- the caller's UI shows
        // "incorrect password".
        return NextResponse.json(
            { error: "invalid_password" },
            { status: 401 },
        );
    }

    const ok = await verifyPassword({
        hash: credAccount.password,
        password,
    });
    if (!ok) {
        return NextResponse.json(
            { error: "invalid_password" },
            { status: 401 },
        );
    }

    const cookie = signElevatedCookie(session.user.id);
    const ttlSec = env.ADMIN_REAUTH_TTL_MINUTES * 60;
    const res = NextResponse.json({ ok: true });
    // Path '/' so both /admin and /api/admin receive it. The HMAC over
    // BETTER_AUTH_SECRET is the actual security boundary; HttpOnly +
    // Secure + SameSite=Strict harden cookie handling. Setting path to
    // /admin would not cover /api/admin (sibling, not nested).
    // Secure tied to IS_HOSTED rather than NODE_ENV so a preview/staging
    // hosted instance with NODE_ENV=development still gets the Secure flag.
    // Local self-host dev (IS_HOSTED unset) never reaches this route at all
    // (gate trips above), so we don't need a non-Secure dev fallback.
    res.cookies.set({
        name: ADMIN_ELEVATED_COOKIE,
        value: cookie,
        httpOnly: true,
        secure: env.IS_HOSTED || process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: ttlSec,
    });
    return res;
}
