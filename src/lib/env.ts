import { z } from "zod";

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

    // Restrict sign-up to specific email domains. Comma-separated, exact
    // match (subdomains are NOT auto-allowed). Lower-cased and trimmed at
    // parse time. Empty/unset means no restriction. Enforced server-side
    // via the better-auth user-create hook (see src/lib/auth.ts); the
    // /register form also surfaces the list as a hint. Inert when
    // DISABLE_REGISTRATION=true (the lockdown trips first).
    ALLOWED_EMAIL_DOMAINS: z
        .string()
        .optional()
        .transform((val) =>
            (val ?? "").split(",").flatMap((s) => {
                const trimmed = s.trim().toLowerCase();
                return trimmed ? [trimmed] : [];
            }),
        ),

    // Disable the self-host update-available check (GitHub releases API).
    // When `true`, the footer never reaches out to api.github.com to look
    // for a newer release tag. Useful for instances with strict egress
    // controls or operators who don't want any phone-home behavior.
    // Defaults to `false` (check enabled). Inert when IS_HOSTED=true --
    // the hosted instance hides the badge unconditionally because the
    // operator (us) controls deploys.
    DISABLE_UPDATE_CHECK: z
        .string()
        .optional()
        .transform((val) => val === "true"),

    // Server-required values are optional at schema level so that `next build`
    // (phase-production-build) doesn't depend on server-only secrets.
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

    // Webhook target hardening. Unset means default to IS_HOSTED; explicit
    // false keeps self-host integrations like Docker service hostnames working.
    WEBHOOKS_REQUIRE_PUBLIC_TARGETS: optionalStrictBoolean,

    // Only enable when a trusted reverse proxy strips or overwrites incoming
    // client-supplied forwarding headers before requests reach Next.js.
    RATE_LIMIT_TRUST_PROXY_HEADERS: optionalStrictBoolean,

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

    // Webshare residential-proxy API key. When set, Plaud-bound outbound
    // requests route through the operator's Webshare proxy list with
    // automatic rotation on 403/407. Unset (default) keeps every call
    // on the direct egress path.
    WEBSHARE_API_KEY: z
        .string()
        .optional()
        .transform((val) => (val === "" ? undefined : val)),

    // Scope of the Webshare proxy. "all" (default) routes every Plaud
    // outbound (API + signed-URL audio CDN) through the proxy. "api-only"
    // skips proxying resource.plaud.ai signed-URL downloads, sending
    // those direct from the server's egress IP. Audio bytes dominate
    // proxy bandwidth, so flipping this to api-only on hosted can save
    // most of the Webshare quota -- BUT only do so after verifying with
    // scripts/plaud-egress-probe.sh that resource.plaud.ai actually
    // serves direct from your egress IPs. Inert when WEBSHARE_API_KEY
    // is unset (no proxy is used at all).
    PLAUD_PROXY_SCOPE: z.enum(["all", "api-only"]).optional().default("all"),

    // Per-user rate limit on POST /api/plaud/sync, in requests per minute.
    // Defaults to 10. Backstops the client-side manual-sync floor and
    // cross-tab dedup: even if a script hammers the endpoint, the bucket
    // throttles it before any Plaud or Webshare call is issued. Set lower
    // for tighter quotas, higher for power users. Range 1..600.
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

    // Admin dashboard (hosted-only). All three are inert when IS_HOSTED is
    // unset/false -- the admin gate trips before any of these are read.
    //
    // ADMIN_EMAILS: comma-separated allowlist of operator email addresses.
    // Lower-cased and trimmed at parse time. Empty => no admins (default).
    // Source of truth for admin identity; intentionally out of the DB so a
    // DB compromise alone does not grant admin.
    ADMIN_EMAILS: z
        .string()
        .optional()
        .transform((val) =>
            (val ?? "").split(",").flatMap((s) => {
                const trimmed = s.trim().toLowerCase();
                return trimmed ? [trimmed] : [];
            }),
        ),

    // ADMIN_IP_ALLOWLIST: optional comma-separated CIDR list. When set, admin
    // routes 404 for requests whose client IP isn't in the list. Empty/unset
    // disables the check (relying on the auth + reauth chain instead).
    ADMIN_IP_ALLOWLIST: z
        .string()
        .optional()
        .transform((val) =>
            (val ?? "").split(",").flatMap((s) => {
                const trimmed = s.trim();
                return trimmed ? [trimmed] : [];
            }),
        ),

    // ADMIN_REAUTH_TTL_MINUTES: how long an admin's elevated cookie is valid
    // after password reprompt before the dashboard forces another reauth.
    // Default 30. Mutations require the cookie to be issued within the last
    // ADMIN_MUTATION_TTL_MINUTES (default 10) -- a tighter window than reads.
    // TTLs validated as strict positive integers. The leading regex
    // rejects malformed values (`parseInt("30abc")` would silently coerce
    // to 30); the .pipe(z.number()...) clamps to a sane range.
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
    ADMIN_MUTATION_TTL_MINUTES: z
        .string()
        .regex(/^\d+$/, "ADMIN_MUTATION_TTL_MINUTES must be a positive integer")
        .optional()
        .transform((val) => (val ? Number(val) : 10))
        .pipe(z.number().int().positive().max(60)),
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
            ALLOWED_EMAIL_DOMAINS: process.env.ALLOWED_EMAIL_DOMAINS,
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

            if (
                parsed.IS_HOSTED &&
                parsed.RATE_LIMIT_TRUST_PROXY_HEADERS !== true
            ) {
                throw new Error(
                    "RATE_LIMIT_TRUST_PROXY_HEADERS=true must be set when IS_HOSTED=true so /api/v1/* rate limits use a per-client IP bucket",
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
