import {
    HostedAuthChrome,
    SelfHostAuthChrome,
} from "@/components/auth/auth-chrome";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";
import { isSmtpConfigured } from "@/lib/smtp";

export default async function ForgotPasswordPage() {
    await redirectIfAuthenticated();

    const smtp = isSmtpConfigured();

    // The hosted instance always has SMTP configured, so the friendly
    // subtitle is fine. On self-host, SMTP may not be configured -- the
    // form body explains the operator help in that case; the subtitle
    // here stays neutral so it reads correctly either way.
    const title = "Reset password";
    const subtitle = smtp
        ? "We'll email you a link to set a new password."
        : "Password reset requires SMTP to be configured.";

    if (env.IS_HOSTED) {
        return (
            <HostedAuthChrome title={title} subtitle={subtitle}>
                <ForgotPasswordForm smtpConfigured={smtp} />
            </HostedAuthChrome>
        );
    }

    return (
        <SelfHostAuthChrome title={title} subtitle={subtitle}>
            <ForgotPasswordForm smtpConfigured={smtp} />
        </SelfHostAuthChrome>
    );
}
