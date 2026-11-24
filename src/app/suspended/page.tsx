import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth-server";

export const metadata: Metadata = {
    title: "Account suspended | Riffado",
    robots: { index: false, follow: false },
};

const SUPPORT_EMAIL = "support@riffado.com";

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
        <AuthShell width="wide">
            <AuthHeading title="Your account is suspended">
                Recordings, sync and transcription are paused while we review
                your account. If you think this is a mistake, email{" "}
                <span className="font-medium text-strong">{SUPPORT_EMAIL}</span>
            </AuthHeading>
            <div className="flex flex-wrap gap-2">
                <Button asChild variant="ink" size="control">
                    <a href={`mailto:${SUPPORT_EMAIL}`}>Email support</a>
                </Button>
                <SignOutButton />
            </div>
            {session.user.email ? (
                <p className="text-small text-muted-foreground">
                    Signed in as {session.user.email}
                </p>
            ) : null}
        </AuthShell>
    );
}
