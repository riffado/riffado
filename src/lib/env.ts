import { z } from "zod";
import { isValidCalendarDateString } from "./date-validation";

const optionalStrictBoolean = z
    .string()
    .optional()
    .transform((val, ctx) => {
        if (val === undefined || val === "") return undefined;
        if (val === "true") return true;
        if (val === "false") return false;

        ctx.addIssue({
            code: "custom",
            message: 'must be either "true" or "false"',
        });
        return z.NEVER;
    });

export const envSchema = z.object({
    /** True for the Riffado-operated hosted instance; default false (self-host). */
    IS_HOSTED: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    /** Disable email/password sign-up. */
    DISABLE_REGISTRATION: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    /** Disable the self-host update-available check. */
    DISABLE_UPDATE_CHECK: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    DATABASE_URL: z.string().optional(),

    BETTER_AUTH_SECRET: z.string().optional(),
    API_TOKEN_HASH_SECRET: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val))
        .refine((val) => val === undefined || val.length >= 32, {
            message: "API_TOKEN_HASH_SECRET must be at least 32 characters",
        }),
    APP_URL: z.string().url("APP_URL must be a valid URL").optional(),

    /** Require public HTTPS webhook targets. Defaults to IS_HOSTED. */
    WEBHOOKS_REQUIRE_PUBLIC_TARGETS: optionalStrictBoolean,

    /** Trust X-Forwarded-For for IP rate limiting; only enable behind a trusted proxy. */
    RATE_LIMIT_TRUST_PROXY_HEADERS: optionalStrictBoolean,

    ENCRYPTION_KEY: z.string().optional(),

    DEFAULT_STORAGE_TYPE: z.enum(["local", "s3"]).optional().default("local"),
    LOCAL_STORAGE_PATH: z.string().optional().default("./storage"),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    /**
     * Optional Webshare API key. When set, Plaud-bound outbound requests are
     * routed through a proxy from the configured Webshare account. Unset
     * (default) keeps every call on the direct egress path.
     */
    WEBSHARE_API_KEY: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /**
     * Which Plaud hosts route through the proxy. `all` (default) includes
     * `resource.plaud.ai` audio downloads; `api-only` skips them.
     * Inert when WEBSHARE_API_KEY is unset.
     */
    PLAUD_PROXY_SCOPE: z.enum(["all", "api-only"]).optional().default("all"),

    /** Per-user rate limit on POST /api/plaud/sync. Default 10, range 1..600. */
    PLAUD_SYNC_RATE_LIMIT_PER_MINUTE: z
        .string()
        .regex(
            /^\d+$/,
            "PLAUD_SYNC_RATE_LIMIT_PER_MINUTE must be a positive integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 10))
        .pipe(z.number().int().positive().max(600)),

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
    /** Rybbit analytics (hosted only). Inert unless both site id and host are set. */
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

    /**
     * Hosted-only admin dashboard config. Inert when IS_HOSTED is unset.
     * `ADMIN_EMAILS`: comma-separated allowlist of operator emails (source of
     * truth for admin identity, kept out of the DB).
     */
    ADMIN_EMAILS: z
        .string()
        .optional()
        .transform((val) =>
            (val ?? "").split(",").flatMap((s) => {
                const trimmed = s.trim().toLowerCase();
                return trimmed ? [trimmed] : [];
            }),
        ),

    /** Optional CIDR allowlist for /admin/*. Empty/unset disables the check. */
    ADMIN_IP_ALLOWLIST: z
        .string()
        .optional()
        .transform((val) =>
            (val ?? "").split(",").flatMap((s) => {
                const trimmed = s.trim();
                return trimmed ? [trimmed] : [];
            }),
        ),

    /** Admin reauth cookie TTL (minutes). Default 30, max 1440. */
    ADMIN_REAUTH_TTL_MINUTES: z
        .string()
        .regex(/^\d+$/, "ADMIN_REAUTH_TTL_MINUTES must be a positive integer")
        .optional()
        .transform((val) => (val ? Number(val) : 30))
        .pipe(
            z
                .number()
                .int()
                .positive()
                .max(24 * 60),
        ),
    /** Tighter TTL required for admin mutations (minutes). Default 10, max 60. */
    ADMIN_MUTATION_TTL_MINUTES: z
        .string()
        .regex(/^\d+$/, "ADMIN_MUTATION_TTL_MINUTES must be a positive integer")
        .optional()
        .transform((val) => (val ? Number(val) : 10))
        .pipe(z.number().int().positive().max(60)),

    ADMIN_HOSTNAME: z
        .string()
        .optional()
        .transform((val) => {
            const trimmed = val?.trim().toLowerCase();
            return trimmed ? trimmed : undefined;
        })
        .refine(
            (val) =>
                val === undefined ||
                /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
                    val,
                ),
            {
                message:
                    "ADMIN_HOSTNAME must be a bare hostname (e.g., admin.riffado.com) -- no scheme, port, or path",
            },
        ),

    REACHER_API_URL: z
        .string()
        .url("REACHER_API_URL must be a valid URL")
        .optional()
        .default("https://check-if-email-exists.stacked.rest/v0/check_email"),
    REACHER_API_KEY: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    SMTP_MARKETING_FROM: z
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
                    'SMTP_MARKETING_FROM must be an email address (e.g., "user@example.com") or formatted as "Name <user@example.com>"',
            },
        ),

    EMAIL_SEND_RATE_PER_SECOND: z
        .string()
        .regex(/^\d+$/, "EMAIL_SEND_RATE_PER_SECOND must be a positive integer")
        .optional()
        .transform((val) => (val ? Number(val) : 5))
        .pipe(z.number().int().positive().max(100)),

    STRIPE_SECRET_KEY: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val))
        .refine(
            (val) =>
                val === undefined ||
                val.startsWith("sk_test_") ||
                val.startsWith("sk_live_") ||
                val.startsWith("rk_test_") ||
                val.startsWith("rk_live_"),
            {
                message:
                    "STRIPE_SECRET_KEY must start with 'sk_'/'rk_' and 'test_'/'live_'",
            },
        ),

    /** Stripe webhook signing secret (whsec_...). Required iff BILLING_ENABLED. */
    STRIPE_WEBHOOK_SECRET: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /** Stripe Price id (price_...) for the USD Pro plan. */
    STRIPE_PRICE_ID_USD: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /** Stripe Price id (price_...) for the EUR Pro plan. */
    STRIPE_PRICE_ID_EUR: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /**
     * Stripe Tax Rate id (txr_...) applied to EUR (EU/EEA) subscriptions so
     * invoices show the VAT line. Should be an inclusive rate matching the
     * EUR Price's inclusive tax_behavior (e.g. Polish 23% under the home-
     * country / no-OSS model). Unset means no VAT line on invoices. Never
     * applied to USD sales (non-EU export, outside EU VAT scope).
     */
    STRIPE_TAX_RATE_ID_EUR: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /**
     * Stripe Customer Portal configuration id (bpc_...). Optional -- when
     * unset the portal falls back to the account's default configuration.
     * Set it to pin the exact features (update card, invoices, cancel at
     * period end) regardless of the dashboard default.
     */
    STRIPE_PORTAL_CONFIGURATION_ID: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /**
     * Request header carrying the buyer's ISO-3166-1 alpha-2 country, used
     * to pick checkout currency (EU/EEA -> EUR, else default). Set this to
     * whatever the hosted load balancer / CDN injects. Checked before the
     * built-in `x-vercel-ip-country` / `cf-ipcountry` fallbacks. Header name
     * is matched case-insensitively; unset just uses those fallbacks.
     */
    GEO_COUNTRY_HEADER: z
        .string()
        .optional()
        .transform((val) =>
            val && val.trim() !== "" ? val.trim().toLowerCase() : undefined,
        ),

    /**
     * Master gate for the hosted billing surface. When false (default),
     * billing routes 404, checkout UI hides, cycle-close worker no-ops.
     * Self-host always leaves this unset.
     */
    BILLING_ENABLED: optionalStrictBoolean,

    /** Mynah transcription proxy base URL. Default https://mynah.riffado.com. */
    MYNAH_BASE_URL: z
        .string()
        .optional()
        .transform((val) =>
            val ? val.replace(/\/+$/, "") : "https://mynah.riffado.com",
        ),

    /** Shared service token for Mynah. Required iff BILLING_ENABLED. */
    MYNAH_SERVICE_TOKEN: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    /** Mynah-seconds budget per cycle for hosted_pro. Default 54000 (15hr). */
    BILLING_PRO_INCLUDED_SECONDS: z
        .string()
        .regex(
            /^\d+$/,
            "BILLING_PRO_INCLUDED_SECONDS must be a non-negative integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 54_000))
        .pipe(z.number().int().nonnegative()),

    /** Mynah-seconds budget per cycle for hosted_free. Default 0; set to 1800 for the OD-1 free 30min allotment. */
    BILLING_FREE_INCLUDED_SECONDS: z
        .string()
        .regex(
            /^\d+$/,
            "BILLING_FREE_INCLUDED_SECONDS must be a non-negative integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 1800))
        .pipe(z.number().int().nonnegative()),

    /** Founding-member window after launch (days). Default 180 (6 months). */
    BILLING_FOUNDING_MEMBER_WINDOW_DAYS: z
        .string()
        .regex(
            /^\d+$/,
            "BILLING_FOUNDING_MEMBER_WINDOW_DAYS must be a positive integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 180))
        .pipe(z.number().int().positive().max(3650)),

    /** Display price for the USD Pro plan (decimal string). Keep in sync with the Stripe Price. */
    BILLING_PRICE_USD: z
        .string()
        .regex(
            /^\d+\.\d{2}$/,
            "BILLING_PRICE_USD must be a decimal string with two digits after the point (e.g. '5.00')",
        )
        .optional()
        .default("5.00"),

    /** Display price for the EUR Pro plan (decimal string). Keep in sync with the Stripe Price. */
    BILLING_PRICE_EUR: z
        .string()
        .regex(
            /^\d+\.\d{2}$/,
            "BILLING_PRICE_EUR must be a decimal string with two digits after the point (e.g. '5.00')",
        )
        .optional()
        .default("5.00"),

    /** Fallback currency when geo is unknown (worker emails, no-geo checkout). */
    BILLING_DEFAULT_CURRENCY: z.enum(["usd", "eur"]).optional().default("usd"),

    /** Display billing interval for the Pro plan (e.g. '1 month'). The Stripe Price is authoritative. */
    BILLING_PRO_INTERVAL: z
        .string()
        .regex(
            /^\d+\s+(day|week|month|year)s?$/i,
            "BILLING_PRO_INTERVAL must look like 'N day|week|month|year(s)'",
        )
        .optional()
        .default("1 month"),

    /** Local display description for the Pro plan. */
    BILLING_PRO_DESCRIPTION: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .default("Riffado Hosted Pro"),

    /**
     * Trial length in days for new hosted sign-ups. All hosted accounts
     * start as Pro for this window. After it, accounts with a
     * card-on-file get charged automatically; accounts without one drop
     * into the trial-grace state.
     */
    BILLING_TRIAL_DAYS: z
        .string()
        .regex(/^\d+$/, "BILLING_TRIAL_DAYS must be a non-negative integer")
        .optional()
        .transform((val) => (val ? Number(val) : 14)),

    /**
     * Grace period in days for accounts that never converted from trial
     * to paid. After this window, the account is hard-deleted.
     */
    BILLING_TRIAL_GRACE_DAYS: z
        .string()
        .regex(
            /^\d+$/,
            "BILLING_TRIAL_GRACE_DAYS must be a non-negative integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 7)),

    /**
     * Grace period in days for accounts that were paying customers and
     * later lapsed (canceled / payment-failed-out). Strictly larger
     * window than the trial grace since these users built a real
     * relationship and may want to come back.
     */
    BILLING_PAID_GRACE_DAYS: z
        .string()
        .regex(
            /^\d+$/,
            "BILLING_PAID_GRACE_DAYS must be a non-negative integer",
        )
        .optional()
        .transform((val) => (val ? Number(val) : 30)),

    /**
     * Hosted billing launch date (ISO `YYYY-MM-DD`). Users whose
     * `createdAt` predates this are grandfathered as Path B (paid)
     * grace policy regardless of payment history. Also used to gate
     * the founding-member window.
     */
    BILLING_LAUNCH_DATE: z
        .string()
        .regex(
            /^\d{4}-\d{2}-\d{2}$/,
            "BILLING_LAUNCH_DATE must be an ISO date (YYYY-MM-DD)",
        )
        .refine(isValidCalendarDateString, {
            message:
                "BILLING_LAUNCH_DATE must be a real calendar date (YYYY-MM-DD)",
        })
        .optional(),
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
            DISABLE_UPDATE_CHECK: process.env.DISABLE_UPDATE_CHECK,
            DATABASE_URL: process.env.DATABASE_URL,
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
            API_TOKEN_HASH_SECRET: process.env.API_TOKEN_HASH_SECRET,
            APP_URL: process.env.APP_URL,
            WEBHOOKS_REQUIRE_PUBLIC_TARGETS:
                process.env.WEBHOOKS_REQUIRE_PUBLIC_TARGETS,
            RATE_LIMIT_TRUST_PROXY_HEADERS:
                process.env.RATE_LIMIT_TRUST_PROXY_HEADERS,
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
            DEFAULT_STORAGE_TYPE: process.env.DEFAULT_STORAGE_TYPE,
            LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH,
            S3_ENDPOINT: process.env.S3_ENDPOINT,
            S3_BUCKET: process.env.S3_BUCKET,
            S3_REGION: process.env.S3_REGION,
            S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
            S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
            WEBSHARE_API_KEY: process.env.WEBSHARE_API_KEY,
            PLAUD_PROXY_SCOPE: process.env.PLAUD_PROXY_SCOPE,
            PLAUD_SYNC_RATE_LIMIT_PER_MINUTE:
                process.env.PLAUD_SYNC_RATE_LIMIT_PER_MINUTE,
            SMTP_HOST: process.env.SMTP_HOST,
            SMTP_PORT: process.env.SMTP_PORT,
            SMTP_SECURE: process.env.SMTP_SECURE,
            RYBBIT_SITE_ID: process.env.RYBBIT_SITE_ID,
            RYBBIT_HOST: process.env.RYBBIT_HOST,
            SMTP_USER: process.env.SMTP_USER,
            SMTP_PASSWORD: process.env.SMTP_PASSWORD,
            SMTP_FROM: process.env.SMTP_FROM,
            ADMIN_EMAILS: process.env.ADMIN_EMAILS,
            ADMIN_IP_ALLOWLIST: process.env.ADMIN_IP_ALLOWLIST,
            ADMIN_REAUTH_TTL_MINUTES: process.env.ADMIN_REAUTH_TTL_MINUTES,
            ADMIN_MUTATION_TTL_MINUTES: process.env.ADMIN_MUTATION_TTL_MINUTES,
            ADMIN_HOSTNAME: process.env.ADMIN_HOSTNAME,
            REACHER_API_URL: process.env.REACHER_API_URL,
            REACHER_API_KEY: process.env.REACHER_API_KEY,
            SMTP_MARKETING_FROM: process.env.SMTP_MARKETING_FROM,
            EMAIL_SEND_RATE_PER_SECOND: process.env.EMAIL_SEND_RATE_PER_SECOND,
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
            STRIPE_PRICE_ID_USD: process.env.STRIPE_PRICE_ID_USD,
            STRIPE_PRICE_ID_EUR: process.env.STRIPE_PRICE_ID_EUR,
            STRIPE_PORTAL_CONFIGURATION_ID:
                process.env.STRIPE_PORTAL_CONFIGURATION_ID,
            BILLING_ENABLED: process.env.BILLING_ENABLED,
            MYNAH_BASE_URL: process.env.MYNAH_BASE_URL,
            MYNAH_SERVICE_TOKEN: process.env.MYNAH_SERVICE_TOKEN,
            BILLING_PRO_INCLUDED_SECONDS:
                process.env.BILLING_PRO_INCLUDED_SECONDS,
            BILLING_FREE_INCLUDED_SECONDS:
                process.env.BILLING_FREE_INCLUDED_SECONDS,
            BILLING_FOUNDING_MEMBER_WINDOW_DAYS:
                process.env.BILLING_FOUNDING_MEMBER_WINDOW_DAYS,
            BILLING_PRICE_USD: process.env.BILLING_PRICE_USD,
            BILLING_PRICE_EUR: process.env.BILLING_PRICE_EUR,
            BILLING_DEFAULT_CURRENCY: process.env.BILLING_DEFAULT_CURRENCY,
            BILLING_PRO_INTERVAL: process.env.BILLING_PRO_INTERVAL,
            BILLING_PRO_DESCRIPTION: process.env.BILLING_PRO_DESCRIPTION,
            BILLING_TRIAL_DAYS: process.env.BILLING_TRIAL_DAYS,
            BILLING_TRIAL_GRACE_DAYS: process.env.BILLING_TRIAL_GRACE_DAYS,
            BILLING_PAID_GRACE_DAYS: process.env.BILLING_PAID_GRACE_DAYS,
            BILLING_LAUNCH_DATE: process.env.BILLING_LAUNCH_DATE,
        });

        const isProductionBuildPhase =
            process.env.NEXT_PHASE === "phase-production-build";

        if (!isProductionBuildPhase) {
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

            if (parsed.BILLING_ENABLED && !parsed.IS_HOSTED) {
                throw new Error(
                    "BILLING_ENABLED=true requires IS_HOSTED=true; billing is a hosted-only surface",
                );
            }
            if (parsed.BILLING_ENABLED && !parsed.STRIPE_SECRET_KEY) {
                throw new Error(
                    "BILLING_ENABLED=true requires STRIPE_SECRET_KEY to be set",
                );
            }
            if (parsed.BILLING_ENABLED && !parsed.STRIPE_WEBHOOK_SECRET) {
                throw new Error(
                    "BILLING_ENABLED=true requires STRIPE_WEBHOOK_SECRET to be set",
                );
            }
            if (
                parsed.BILLING_ENABLED &&
                !parsed.STRIPE_PRICE_ID_USD &&
                !parsed.STRIPE_PRICE_ID_EUR
            ) {
                throw new Error(
                    "BILLING_ENABLED=true requires at least one of STRIPE_PRICE_ID_USD / STRIPE_PRICE_ID_EUR",
                );
            }
            if (parsed.BILLING_ENABLED && !parsed.MYNAH_SERVICE_TOKEN) {
                throw new Error(
                    "BILLING_ENABLED=true requires MYNAH_SERVICE_TOKEN to be set",
                );
            }

            if (
                parsed.IS_HOSTED &&
                parsed.RATE_LIMIT_TRUST_PROXY_HEADERS !== true
            ) {
                throw new Error(
                    "RATE_LIMIT_TRUST_PROXY_HEADERS=true must be set when IS_HOSTED=true so /api/v1/* rate limits use a per-client IP bucket",
                );
            }

            if (parsed.ADMIN_HOSTNAME && parsed.APP_URL) {
                let appHost: string;
                try {
                    appHost = new URL(parsed.APP_URL).hostname.toLowerCase();
                } catch {
                    throw new Error(
                        "APP_URL must be a valid URL when ADMIN_HOSTNAME is set",
                    );
                }
                if (appHost === parsed.ADMIN_HOSTNAME) {
                    throw new Error(
                        `ADMIN_HOSTNAME (${parsed.ADMIN_HOSTNAME}) must differ from APP_URL host (${appHost}). Configure a dedicated subdomain such as admin.${appHost}.`,
                    );
                }
            }

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
