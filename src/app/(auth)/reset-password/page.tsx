import { ResetPasswordForm } from "@/components/auth/reset-password-form";
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
    // Redirect to dashboard if already authenticated
    await redirectIfAuthenticated();

    const params = await searchParams;
    const token = firstParam(params.token);
    const error = firstParam(params.error);

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md">
                <ResetPasswordForm token={token} error={error} />
            </div>
        </div>
    );
}
