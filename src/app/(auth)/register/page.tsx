import { redirect } from "next/navigation";
import {
    HostedAuthChrome,
    SelfHostAuthChrome,
} from "@/components/auth/auth-chrome";
import { RegisterForm } from "@/components/auth/register-form";
import { emailVerificationRequired } from "@/lib/auth";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { uiText } from "@/lib/i18n";

export default async function RegisterPage() {
    await redirectIfAuthenticated();

    // Per product decision: when registration is disabled, redirect to
    // /login rather than rendering a "registration disabled" panel. The
    // dangling deep-link is the only meaningful entry point, and a
    // redirect is a less confusing landing than a dead-end card.
    if (env.DISABLE_REGISTRATION) {
        redirect("/login");
    }

    if (env.IS_HOSTED) {
        return (
            <HostedAuthChrome
                title={uiText("Create your account")}
                subtitle={uiText(
                    "Free to start. Upgrade only when you outgrow it.",
                )}
            >
                <RegisterForm
                    requireEmailVerification={emailVerificationRequired}
                />
            </HostedAuthChrome>
        );
    }

    return (
        <SelfHostAuthChrome
            title={uiText("Create your account")}
            subtitle={uiText(
                "The first account on a new Riffado instance becomes the admin.",
            )}
        >
            <RegisterForm
                requireEmailVerification={emailVerificationRequired}
            />
        </SelfHostAuthChrome>
    );
}
