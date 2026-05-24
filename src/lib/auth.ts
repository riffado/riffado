import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { isEmailDomainAllowed } from "./email-domain";
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
    // Email-domain allowlist for sign-up. Fires before the user row is
    // written, regardless of which sign-up path triggered it (email/password
    // today, OAuth later) -- ALLOWED_EMAIL_DOMAINS is the security boundary,
    // any client hint on /register is UX only. Empty list = no restriction.
    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    if (env.ALLOWED_EMAIL_DOMAINS.length === 0) return;
                    const email =
                        typeof user.email === "string" ? user.email : "";
                    if (
                        !isEmailDomainAllowed(email, env.ALLOWED_EMAIL_DOMAINS)
                    ) {
                        throw new APIError("BAD_REQUEST", {
                            message: `Sign-up is restricted to: ${env.ALLOWED_EMAIL_DOMAINS.join(", ")}`,
                        });
                    }
                },
            },
        },
    },
});

export type Session = typeof auth.$Infer.Session;
