import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { isSmtpConfigured } from "@/lib/smtp";

export default async function ForgotPasswordPage() {
    await redirectIfAuthenticated();

    return (
        <AuthShell>
            <ForgotPasswordForm smtpConfigured={isSmtpConfigured()} />
        </AuthShell>
    );
}
