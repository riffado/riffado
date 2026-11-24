import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function LoginPage() {
    await redirectIfAuthenticated();

    return (
        <AuthShell>
            <LoginForm
                registrationEnabled={!env.DISABLE_REGISTRATION}
                showTerms={env.IS_HOSTED}
            />
        </AuthShell>
    );
}
