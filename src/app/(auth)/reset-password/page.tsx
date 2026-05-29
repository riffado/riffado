import {
    HostedAuthChrome,
    SelfHostAuthChrome,
} from "@/components/auth/auth-chrome";
import {
    ResetPasswordForm,
    resetPasswordMode,
} from "@/components/auth/reset-password-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

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

    const mode = resetPasswordMode(token, error);
    const title =
        mode === "invalid" ? "Invalid reset link" : "Set a new password";
    const subtitle =
        mode === "invalid"
            ? "This link is missing or has expired."
            : "Choose a password you don't use anywhere else.";

    if (env.IS_HOSTED) {
        return (
            <HostedAuthChrome title={title} subtitle={subtitle}>
                <ResetPasswordForm token={token} error={error} />
            </HostedAuthChrome>
        );
    }

    return (
        <SelfHostAuthChrome title={title} subtitle={subtitle}>
            <ResetPasswordForm token={token} error={error} />
        </SelfHostAuthChrome>
    );
}
