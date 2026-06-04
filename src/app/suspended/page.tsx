import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth-server";

export const metadata: Metadata = {
    title: "Account suspended — Mesynx AI",
    robots: { index: false, follow: false },
};

/**
 * Page shown to suspended users. We deliberately tell them their account is
 * suspended (rather than serve a generic maintenance page) -- silently
 * pretending the app is broken is dishonest and creates a worse support
 * experience. The reason text from `users.suspendedReason` is NOT displayed
 * because admins write it for internal audit, not for the user.
 */
export default async function SuspendedPage() {
    const session = await getSession();
    if (!session?.user) redirect("/login");

    const [u] = await db
        .select({ suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

    // If they're not actually suspended (admin unsuspended them mid-session),
    // bounce back to the dashboard so they're not stuck.
    if (!u?.suspendedAt) redirect("/dashboard");

    return (
        <div className="min-h-screen flex items-center justify-center p-6">
            <div className="max-w-md border rounded-xl p-6 bg-card shadow-sm">
                <h1 className="text-lg font-semibold mb-2">
                    Your account is suspended
                </h1>
                <p className="text-sm text-muted-foreground mb-4">
                    Access to recordings, sync, and transcription is paused
                    while we review your account.
                </p>
                <p className="text-sm text-muted-foreground">
                    Reach out at{" "}
                    <a
                        href="mailto:support@mesynx.r0073dl053r.com"
                        className="underline"
                    >
                        support@mesynx.r0073dl053r.com
                    </a>{" "}
                    if you think this is a mistake.
                </p>
                <form
                    action="/api/auth/sign-out"
                    method="post"
                    className="mt-6"
                >
                    <button
                        type="submit"
                        className="text-sm border rounded px-3 py-2 hover:bg-muted"
                    >
                        Sign out
                    </button>
                </form>
            </div>
        </div>
    );
}
