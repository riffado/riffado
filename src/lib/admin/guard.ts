import { cookies, headers as nextHeaders } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError, ErrorCode } from "@/lib/errors";
import {
    ADMIN_ELEVATED_COOKIE,
    isWithinMutationTtl,
    isWithinReauthTtl,
    verifyElevatedCookie,
} from "./elevated-cookie";
import {
    clientIpFromHeaders,
    ipMatchesAllowlist,
    warnIfIpAllowlistTrustsXff,
} from "./ip-allowlist";

if (env.IS_HOSTED && env.ADMIN_IP_ALLOWLIST.length > 0) {
    warnIfIpAllowlistTrustsXff(env.ADMIN_IP_ALLOWLIST);
}

export type AdminGuardOk = {
    mode: "ok";
    user: { id: string; email: string };
    elevatedIssuedAt: number;
};

export type AdminGuardReauth = {
    mode: "reauth";
    user: { id: string; email: string };
    returnTo: string;
};

export type AdminGuardResult = AdminGuardOk | AdminGuardReauth;

interface AssertOptions {
    mutation?: boolean;
    route: string;
    method: string;
    returnTo?: string;
}

async function evaluateAdminGate(
    opts: AssertOptions,
): Promise<AdminGuardResult | null> {
    if (!env.IS_HOSTED) return null;
    if (env.ADMIN_EMAILS.length === 0) return null;

    const hdrs = await nextHeaders();

    if (env.ADMIN_IP_ALLOWLIST.length > 0) {
        const ip = clientIpFromHeaders(hdrs);
        if (!ipMatchesAllowlist(ip, env.ADMIN_IP_ALLOWLIST)) return null;
    }

    const session = await auth.api.getSession({ headers: hdrs });
    if (!session?.user) return null;

    const email = session.user.email?.trim().toLowerCase();
    if (!email || !env.ADMIN_EMAILS.includes(email)) return null;

    const cookieStore = await cookies();
    const raw = cookieStore.get(ADMIN_ELEVATED_COOKIE)?.value;
    const payload = verifyElevatedCookie(raw);

    if (!payload || payload.userId !== session.user.id) {
        if (opts.mutation) return null;
        return {
            mode: "reauth",
            user: { id: session.user.id, email },
            returnTo: opts.returnTo ?? "/admin",
        };
    }

    if (!isWithinReauthTtl(payload)) {
        if (opts.mutation) return null;
        return {
            mode: "reauth",
            user: { id: session.user.id, email },
            returnTo: opts.returnTo ?? "/admin",
        };
    }

    if (opts.mutation && !isWithinMutationTtl(payload)) return null;

    try {
        await db.insert(adminAuditLog).values({
            adminUserId: session.user.id,
            adminUserEmail: email,
            route: opts.route,
            method: opts.method,
            ip: clientIpFromHeaders(hdrs),
            userAgent: hdrs.get("user-agent"),
        });
    } catch (err) {
        console.error("[admin] audit log insert failed", err);
    }

    return {
        mode: "ok",
        user: { id: session.user.id, email },
        elevatedIssuedAt: payload.issuedAt,
    };
}

/** Server-component admin gate. Hard failures 404; soft failures return `'reauth'`. */
export async function requireAdminPage(
    opts: Omit<AssertOptions, "mutation">,
): Promise<AdminGuardResult> {
    const res = await evaluateAdminGate({ ...opts, mutation: false });
    if (!res) notFound();
    return res;
}

export async function requireAdminApi(
    opts: Omit<AssertOptions, "mutation">,
): Promise<AdminGuardOk> {
    const res = await evaluateAdminGate({ ...opts, mutation: false });
    if (!res || res.mode !== "ok") {
        throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
    }
    return res;
}

export async function requireAdminMutation(
    opts: Omit<AssertOptions, "mutation">,
): Promise<AdminGuardOk> {
    const res = await evaluateAdminGate({ ...opts, mutation: true });
    if (!res || res.mode !== "ok") {
        throw new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
    }
    return res;
}

/** Nav-render predicate; does NOT verify the elevated cookie. Never use to authorise. */
export function isAdminEmail(email: string | null | undefined): boolean {
    if (!env.IS_HOSTED) return false;
    if (env.ADMIN_EMAILS.length === 0) return false;
    if (!email) return false;
    return env.ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
