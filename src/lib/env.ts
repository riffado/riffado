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
    /** True for the Mesynx AI-operated hosted instance; default false (self-host). */
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

    /** Comma-separated list of IPs or hostnames to scan for LLMs/whisper servers. */
    LLM_HOSTS: z.string().optional(),
    OLLAMA_BASE_URL: z.string().optional(),
    OLLAMA_URL: z.string().optional(),
    LM_STUDIO_URL: z.string().optional(),
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
            LLM_HOSTS: process.env.LLM_HOSTS,
            OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
            OLLAMA_URL: process.env.OLLAMA_URL,
            LM_STUDIO_URL: process.env.LM_STUDIO_URL,
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

            if (
                parsed.IS_HOSTED &&
                parsed.RATE_LIMIT_TRUST_PROXY_HEADERS !== true
            ) {
                throw new Error(
                    "RATE_LIMIT_TRUST_PROXY_HEADERS=true must be set when IS_HOSTED=true so /api/v1/* rate limits use a per-client IP bucket",
                );
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
