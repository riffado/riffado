/** Request header carrying the Turnstile token on protected auth calls. */
export const CAPTCHA_RESPONSE_HEADER = "x-captcha-response";

/**
 * Better Auth endpoints (path after `/api/auth`) that require a Turnstile
 * token when Turnstile is configured, mapped to the widget `action` label
 * used for Cloudflare analytics.
 */
export const TURNSTILE_ACTIONS = {
    "/sign-up/email": "sign-up",
    "/sign-in/email": "sign-in",
    "/request-password-reset": "password-reset",
    "/send-verification-email": "verify-email",
} as const;

/** Widget `action` label for a protected auth endpoint. */
export type TurnstileAction =
    (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
