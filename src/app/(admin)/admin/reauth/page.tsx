import { headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/guard";
import {
    clientIpFromHeaders,
    ipMatchesAllowlist,
} from "@/lib/admin/ip-allowlist";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { ReauthForm } from "./reauth-form";

// force-dynamic: admin config is read at runtime, not build time.
export const dynamic = "force-dynamic";

function sanitizeNext(raw: unknown): string {
    if (typeof raw !== "string") return "/admin";
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/admin";
    if (raw.includes("\\")) return "/admin";
    let normalized: string;
    try {
        normalized = new URL(raw, "https://placeholder.invalid").pathname;
    } catch {
        return "/admin";
    }
    if (normalized === "/admin") return normalized;
    if (normalized.startsWith("/admin/")) return normalized;
    return "/admin";
}

export default async function AdminReauthPage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string | string[] }>;
}) {
    if (!env.IS_HOSTED) notFound();
    if (env.ADMIN_EMAILS.length === 0) notFound();

    const hdrs = await nextHeaders();
    if (env.ADMIN_IP_ALLOWLIST.length > 0) {
        const ip = clientIpFromHeaders(hdrs);
        if (!ipMatchesAllowlist(ip, env.ADMIN_IP_ALLOWLIST)) notFound();
    }

    const session = await auth.api.getSession({ headers: hdrs });
    if (!session?.user) redirect("/login");
    if (!isAdminEmail(session.user.email)) notFound();

    const sp = await searchParams;
    const rawNext = Array.isArray(sp.next) ? sp.next[0] : sp.next;
    const next = sanitizeNext(rawNext);

    return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
            <div className="w-full max-w-sm border rounded-xl p-6 bg-card shadow-sm">
                <h1 className="text-lg font-semibold mb-1">Admin reauth</h1>
                <p className="text-sm text-muted-foreground mb-4">
                    Enter your password to continue. The elevated session is
                    valid for {env.ADMIN_REAUTH_TTL_MINUTES} minutes.
                </p>
                <ReauthForm email={session.user.email} next={next} />
            </div>
        </div>
    );
}
