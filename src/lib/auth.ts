import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env";
import {
    sendEmailChangeConfirm,
    sendPasswordResetEmail,
    sendVerifyEmail,
} from "./notifications/email";
import { isSmtpConfigured } from "./smtp";

const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Email verification is gated on SMTP being configured. Self-host
 * instances without SMTP keep the historical "no verification" path
 * (they have no delivery channel for the link anyway); SMTP-configured
 * instances and the hosted instance both require verification.
 *
 * Existing users created before this flip should be grandfathered by
 * `scripts/billing-backfill.ts` (sets `emailVerified=true` for every
 * pre-launch row) so no one gets locked out.
 */
const verificationActive = isSmtpConfigured();

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: verificationActive,
        disableSignUp: env.DISABLE_REGISTRATION,
        sendResetPassword: async ({ user, url }) => {
            await sendPasswordResetEmail(user.email, url);
        },
        resetPasswordTokenExpiresIn: 60 * 60,
        revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
        sendVerificationEmail: async ({ user, url }) => {
            if (!verificationActive) return;
            await sendVerifyEmail({
                email: user.email,
                verificationUrl: url,
                expiresInSeconds: EMAIL_VERIFICATION_TTL_SECONDS,
            });
        },
        sendOnSignUp: verificationActive,
        autoSignInAfterVerification: true,
        expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
    },
    user: {
        changeEmail: {
            enabled: true,
            sendChangeEmailVerification: async ({ user, newEmail, url }) => {
                if (!verificationActive) return;
                await sendEmailChangeConfirm({
                    sendTo: user.email,
                    newEmail,
                    confirmUrl: url,
                    expiresInSeconds: EMAIL_VERIFICATION_TTL_SECONDS,
                });
            },
        },
    },
    /**
     * On hosted instances with billing enabled, every new user starts on
     * a 14-day Pro trial (`plan='hosted_pro'`, `planTransitionUntil = now
     * + BILLING_TRIAL_DAYS`). After the trial elapses without payment,
     * the billing worker demotes them and starts the deletion grace
     * countdown.
     *
     * Self-host (`!IS_HOSTED`) leaves `plan` NULL. The hosted-billing
     * code paths are gated on a non-null plan everywhere.
     */
    databaseHooks: {
        user: {
            create: {
                after: async (user) => {
                    if (!env.IS_HOSTED || !env.BILLING_ENABLED) return;
                    const trialMs =
                        env.BILLING_TRIAL_DAYS * 24 * 60 * 60 * 1000;
                    await db
                        .update(schema.users)
                        .set({
                            plan: "hosted_pro",
                            planTransitionUntil: new Date(Date.now() + trialMs),
                            updatedAt: new Date(),
                        })
                        .where(eq(schema.users.id, user.id));
                },
            },
        },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
});

export type Session = typeof auth.$Infer.Session;
