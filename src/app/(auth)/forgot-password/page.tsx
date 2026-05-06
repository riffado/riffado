import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { isSmtpConfigured } from "@/lib/notifications/email";

export default async function ForgotPasswordPage() {
    // Redirect to dashboard if already authenticated
    await redirectIfAuthenticated();

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md">
                <ForgotPasswordForm smtpConfigured={isSmtpConfigured()} />
            </div>
        </div>
    );
}
