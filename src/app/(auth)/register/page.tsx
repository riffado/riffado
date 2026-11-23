import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { emailVerificationRequired } from "@/lib/auth";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function RegisterPage() {
    await redirectIfAuthenticated();

    // Per product decision: when registration is disabled, redirect to
    // /login rather than rendering a "registration disabled" panel. The
    // sign-in page says sign-ups are off, which is a less confusing
    // landing than a dead-end card.
    if (env.DISABLE_REGISTRATION) {
        redirect("/login");
    }

    return (
        <AuthShell offset="tall">
            <RegisterForm
                requireEmailVerification={emailVerificationRequired}
                showTerms={env.IS_HOSTED}
            />
        </AuthShell>
    );
}
