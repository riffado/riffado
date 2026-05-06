import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";

interface ResetPasswordPageProps {
    searchParams: Promise<{ token?: string; error?: string }>;
}

export default async function ResetPasswordPage({
    searchParams,
}: ResetPasswordPageProps) {
    // Redirect to dashboard if already authenticated
    await redirectIfAuthenticated();

    const { token, error } = await searchParams;

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md">
                <ResetPasswordForm token={token} error={error} />
            </div>
        </div>
    );
}
