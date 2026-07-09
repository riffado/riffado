import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env";
import { closeCycleForUser } from "./hosted/billing/cycle-close";
import {
    sendEmailChangeConfirm,
    sendPasswordResetEmail,
    sendVerifyEmail,
} from "./notifications/email";
import { isSmtpConfigured } from "./smtp";

const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Email verification is enforced only on the hosted instance (and only
 * when SMTP is actually configured there -- no delivery channel for the
 * link otherwise). Self-host instances never enforce verification, even
 * when they configure SMTP for notification emails: `IS_HOSTED` is the
 * rollout boundary from `scripts/billing-backfill.ts`, which grandfathers
 * every pre-launch row to `emailVerified=true` -- that's a one-shot ops
 * script run once against the hosted DB at launch, not something
 * self-host operators ever run. Gating on `isSmtpConfigured()` alone
 * would flip verification on for any self-host deployment that has SMTP
 * configured and immediately lock out its existing unverified accounts.
 */
const verificationActive = env.IS_HOSTED && isSmtpConfigured();

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
                    // Grant the Pro Mynah budget synchronously instead of
                    // waiting for the billing worker's next tick (up to
                    // TICK_MS after signup) -- otherwise a user who tries
                    // hosted transcription immediately after signing up hits
                    // the schema default of 0 remaining seconds.
                    await closeCycleForUser(user.id);
                },
            },
        },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
});

export type Session = typeof auth.$Infer.Session;
