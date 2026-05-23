import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { Logo } from "@/components/icons/logo";
import { Panel } from "@/components/panel";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function RegisterPage() {
    // Redirect to dashboard if already authenticated
    await redirectIfAuthenticated();

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md">
                {env.DISABLE_REGISTRATION ? (
                    <RegistrationDisabled />
                ) : (
                    <RegisterForm
                        allowedEmailDomains={env.ALLOWED_EMAIL_DOMAINS}
                    />
                )}
            </div>
        </div>
    );
}

function RegistrationDisabled() {
    return (
        <Panel className="w-full max-w-md space-y-6">
            <div className="flex items-center gap-3">
                <Logo className="size-10 shrink-0" />
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Registration Disabled
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        New sign-ups are turned off on this instance
                    </p>
                </div>
            </div>

            <p className="text-sm text-muted-foreground">
                The administrator of this OpenPlaud instance has disabled
                self-service registration. If you need an account, contact the
                administrator directly.
            </p>

            <div className="text-center text-sm">
                <span className="text-muted-foreground">
                    Already have an account?{" "}
                </span>
                <Link
                    href="/login"
                    className="text-accent-cyan hover:underline"
                >
                    Sign in
                </Link>
            </div>
        </Panel>
    );
}
