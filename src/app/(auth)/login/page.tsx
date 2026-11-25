import {
    HostedAuthChrome,
    SelfHostAuthChrome,
} from "@/components/auth/auth-chrome";
import { LoginForm } from "@/components/auth/login-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { isSmtpConfigured } from "@/lib/smtp";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export default async function LoginPage() {
    await redirectIfAuthenticated();

    const formProps = {
        registrationEnabled: !env.DISABLE_REGISTRATION,
        smtpConfigured: isSmtpConfigured(),
        turnstileSiteKey: getTurnstileSiteKey(),
    };

    if (env.IS_HOSTED) {
        return (
            <HostedAuthChrome
                title="Sign in"
                subtitle="Welcome back to Riffado."
            >
                <LoginForm {...formProps} />
            </HostedAuthChrome>
        );
    }

    return (
        <SelfHostAuthChrome
            title="Sign in"
            subtitle="Sign in to your Riffado instance."
        >
            <LoginForm {...formProps} />
        </SelfHostAuthChrome>
    );
}
