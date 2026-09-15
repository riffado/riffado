import { uiText } from "@/lib/i18n";

const errorMessages: Readonly<Record<string, string>> = {
    UNAUTHORIZED: "Please sign in again.",
    AUTH_SESSION_MISSING: "Please sign in again.",
    FORBIDDEN: "You do not have permission to perform this action.",
    ACCOUNT_SUSPENDED: "This account has been suspended.",
    ACCOUNT_LOCKED: "Your hosted plan has lapsed. Subscribe to resume.",
    PLAUD_INVALID_TOKEN:
        "Your Plaud sign-in has expired. Reconnect to resume syncing.",
    PLAUD_OTP_INVALID: "The verification code is invalid. Please try again.",
    PLAUD_OTP_EXPIRED: "The verification code has expired. Request a new code.",
    PLAUD_NOT_CONNECTED: "Connect your Plaud account first.",
    PLAUD_WORKSPACE_TOKEN_PASTED:
        "Use the Riffado Connector or paste the long-lived account token from pld_tokenstr.",
    PLAUD_RATE_LIMITED:
        "Plaud is rate limiting requests. Please try again later.",
    NO_TRANSCRIPTION_PROVIDER:
        "Please configure an AI provider in Settings first",
    AI_PROVIDER_NOT_CONFIGURED:
        "Please configure an AI provider in Settings first",
    RECORDING_NOT_FOUND: "Recording not found",
    STORAGE_QUOTA_EXCEEDED:
        "Storage limit reached. Free up space or upgrade your plan.",
    MYNAH_BUDGET_EXHAUSTED:
        "Your included transcription allowance is exhausted. Use your own provider or wait for renewal.",
    SMTP_NOT_CONFIGURED: "The administrator has not configured email delivery.",
    RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
};

/** Localize known errors without mutating the API payload or hiding unknown diagnostics. */
export function uiError(message: string, code?: string): string {
    const translated = uiText(message);
    if (translated !== message) return translated;
    return code && Object.hasOwn(errorMessages, code)
        ? uiText(errorMessages[code])
        : message;
}
