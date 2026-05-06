import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env";
import { sendPasswordResetEmail } from "./notifications/email";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        // Operator-controlled signup lockdown. When DISABLE_REGISTRATION=true,
        // better-auth's sign-up endpoint returns an error regardless of UI
        // state -- this is the actual security boundary. /register and /login
        // surface the same flag separately for UX. See issue #59.
        disableSignUp: env.DISABLE_REGISTRATION,
        // Password reset is gated by SMTP being configured. The /forgot-password
        // page hides the entry point when SMTP isn't set up; this callback is
        // the server-side delivery hook better-auth invokes when the user
        // submits a reset request. If SMTP is not configured the email send
        // returns false and the operator gets a console warning.
        sendResetPassword: async ({ user, url }) => {
            await sendPasswordResetEmail(user.email, url);
        },
        resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
        // If a user resets their password we assume the old credentials may
        // be compromised -- invalidate every existing session so other
        // devices have to re-auth.
        revokeSessionsOnPasswordReset: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
});

export type Session = typeof auth.$Infer.Session;
