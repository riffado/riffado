import { redirect } from "next/navigation";
import {
    HostedAuthChrome,
    SelfHostAuthChrome,
} from "@/components/auth/auth-chrome";
import { RegisterForm } from "@/components/auth/register-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

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
                title="Create your account"
                subtitle="Free to start. Upgrade only when you outgrow it."
            >
                <RegisterForm />
            </HostedAuthChrome>
        );
    }

    return (
        <SelfHostAuthChrome
            title="Create your account"
            subtitle="The first account on a new Riffado instance becomes the admin."
        >
            <RegisterForm />
        </SelfHostAuthChrome>
    );
}
