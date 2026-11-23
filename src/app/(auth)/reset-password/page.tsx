import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { resetPasswordMode } from "@/lib/auth/reset-password-mode";
import { redirectIfAuthenticated } from "@/lib/auth-server";

interface ResetPasswordPageProps {
    // Next.js delivers query params as `string | string[] | undefined` --
    // a key can be repeated (`?token=a&token=b`). Type accordingly and
    // normalize to a single string before handing to the client form.
    searchParams: Promise<{
        token?: string | string[];
        error?: string | string[];
    }>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

export default async function ResetPasswordPage({
    searchParams,
}: ResetPasswordPageProps) {
    await redirectIfAuthenticated();

    const params = await searchParams;
    const token = firstParam(params.token);
    const error = firstParam(params.error);

    return (
        <AuthShell>
            <ResetPasswordForm
                mode={resetPasswordMode(token, error)}
                token={token}
                error={error}
            />
        </AuthShell>
    );
}
