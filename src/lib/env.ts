import { z } from "zod";

export const envSchema = z.object({
    // Deployment mode. `true` means this instance is the OpenPlaud-operated
    // hosted product (marketing landing visible at `/`). Default `false`:
    // self-host instances skip the marketing surface and bounce logged-out
    // visitors at `/` straight to `/login`.
    IS_HOSTED: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    // Disable email/password sign-up. When `true`, the better-auth
    // sign-up endpoint is disabled server-side (security boundary), the
    // /register page renders a disabled-state panel, and the /login page
    // hides its register link. Operator-controlled, defaults to `false`
    // (registration open). Self-host only -- the OpenPlaud-operated hosted
    // instance leaves this unset.
    DISABLE_REGISTRATION: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    // Server-required values are optional at schema level so that `next build`
    // (phase-production-build) doesn't depend on server-only secrets.
    DATABASE_URL: z.string().optional(),

    BETTER_AUTH_SECRET: z.string().optional(),
    APP_URL: z.string().url("APP_URL must be a valid URL").optional(),

    // Encryption
    // Optional at env-schema level so that builds don't fail if it's missing;
    // encryption code is responsible for enforcing a strong key at runtime.
    ENCRYPTION_KEY: z.string().optional(),

    DEFAULT_STORAGE_TYPE: z.enum(["local", "s3"]).optional().default("local"),
    LOCAL_STORAGE_PATH: z.string().optional().default("./storage"),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined)),
    SMTP_SECURE: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    // Rybbit analytics (hosted mode only). Both must be set together for
    // the tracking script and proxy rewrites to activate. Self-host leaves
    // them unset; the analytics component returns null and no rewrites are
    // registered, so no requests go to Rybbit at all.
    RYBBIT_SITE_ID: z.string().optional(),
    RYBBIT_HOST: z.string().url("RYBBIT_HOST must be a valid URL").optional(),

    SMTP_FROM: z
        .string()
        .optional()
        .refine(
            (val) => {
                if (!val) return true;
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const nameEmailRegex = /^.+ <[^\s@]+@[^\s@]+\.[^\s@]+>$/;
                return emailRegex.test(val) || nameEmailRegex.test(val);
            },
            {
                message:
                    'SMTP_FROM must be an email address (e.g., "user@example.com") or formatted as "Name <user@example.com>"',
            },
        ),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
    if (typeof window !== "undefined") {
        throw new Error(
            "Environment variables cannot be accessed on the client side. " +
                "This module should only be imported in server-side code (API routes, server components, etc.).",
        );
    }

    try {
        const parsed = envSchema.parse({
            IS_HOSTED: process.env.IS_HOSTED,
            DISABLE_REGISTRATION: process.env.DISABLE_REGISTRATION,
            DATABASE_URL: process.env.DATABASE_URL,
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
            APP_URL: process.env.APP_URL,
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
            DEFAULT_STORAGE_TYPE: process.env.DEFAULT_STORAGE_TYPE,
            LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH,
            S3_ENDPOINT: process.env.S3_ENDPOINT,
            S3_BUCKET: process.env.S3_BUCKET,
            S3_REGION: process.env.S3_REGION,
            S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
            S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
            SMTP_HOST: process.env.SMTP_HOST,
            SMTP_PORT: process.env.SMTP_PORT,
            SMTP_SECURE: process.env.SMTP_SECURE,
            RYBBIT_SITE_ID: process.env.RYBBIT_SITE_ID,
            RYBBIT_HOST: process.env.RYBBIT_HOST,
            SMTP_USER: process.env.SMTP_USER,
            SMTP_PASSWORD: process.env.SMTP_PASSWORD,
            SMTP_FROM: process.env.SMTP_FROM,
        });

        // In runtime (dev/prod servers), we require a strong encryption key.
        // During `next build` (phase-production-build) we skip this so that
        // server-only config doesn't break the frontend build.
        const isProductionBuildPhase =
            process.env.NEXT_PHASE === "phase-production-build";

        if (!isProductionBuildPhase) {
            // Core server-side envs must be present when the server actually runs.
            if (!parsed.DATABASE_URL) {
                throw new Error(
                    "DATABASE_URL must be set in non-build runtime (dev/prod server)",
                );
            }

            if (!parsed.BETTER_AUTH_SECRET) {
                throw new Error(
                    "BETTER_AUTH_SECRET must be set in non-build runtime (dev/prod server)",
                );
            }
            if (parsed.BETTER_AUTH_SECRET.length < 32) {
                throw new Error(
                    "BETTER_AUTH_SECRET must be at least 32 characters",
                );
            }

            if (!parsed.APP_URL) {
                throw new Error(
                    "APP_URL must be set in non-build runtime (dev/prod server)",
                );
            }

            // Encryption key: required and strong at runtime, ignored during build.
            const key = parsed.ENCRYPTION_KEY;
            if (!key) {
                throw new Error(
                    "ENCRYPTION_KEY must be set in non-build runtime (dev/prod server)",
                );
            }
            const isValidHexKey = /^[0-9a-fA-F]{64}$/.test(key);
            if (!isValidHexKey) {
                throw new Error(
                    "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)",
                );
            }
        }

        return parsed;
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("\n");
            throw new Error(`Environment validation failed:\n${issues}`);
        }
        throw error;
    }
}

export const env = validateEnv();
