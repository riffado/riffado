/**
 * Maps Better Auth error responses from the email-and-password endpoints
 * to the field they belong to on the auth forms. Better Auth answers a
 * wrong email and a wrong password with the same error, so sign-in shows
 * one message that names both.
 */

/** The shape Better Auth's client returns in `result.error`. */
export interface AuthClientError {
    code?: string;
    message?: string;
    status?: number;
}

/** Where an auth error is shown: under a field, or above the submit button. */
export type AuthErrorTarget = "email" | "password" | "form";

export type AuthErrorKind =
    | "credentials"
    | "email-not-verified"
    | "email-taken"
    | "invalid-email"
    | "password-too-short"
    | "password-too-long"
    | "invalid-token"
    | "sign-up-disabled"
    | "rate-limited"
    | "unknown";

export interface MappedAuthError {
    kind: AuthErrorKind;
    target: AuthErrorTarget;
}

const FIELD_ERRORS: Record<string, MappedAuthError> = {
    INVALID_EMAIL_OR_PASSWORD: { kind: "credentials", target: "password" },
    EMAIL_NOT_VERIFIED: { kind: "email-not-verified", target: "email" },
    USER_ALREADY_EXISTS: { kind: "email-taken", target: "email" },
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
        kind: "email-taken",
        target: "email",
    },
    INVALID_EMAIL: { kind: "invalid-email", target: "email" },
    PASSWORD_TOO_SHORT: { kind: "password-too-short", target: "password" },
    PASSWORD_TOO_LONG: { kind: "password-too-long", target: "password" },
    INVALID_TOKEN: { kind: "invalid-token", target: "form" },
    EMAIL_PASSWORD_SIGN_UP_DISABLED: {
        kind: "sign-up-disabled",
        target: "form",
    },
};

/** Classifies a Better Auth client error for the auth forms. */
export function mapAuthError(error: AuthClientError): MappedAuthError {
    if (error.status === 429) return { kind: "rate-limited", target: "form" };
    const mapped = error.code ? FIELD_ERRORS[error.code] : undefined;
    return mapped ?? { kind: "unknown", target: "form" };
}

/** Minimum password length Better Auth enforces by default. */
export const MIN_PASSWORD_LENGTH = 8;

/** Message for a password shorter than the minimum. */
export function passwordTooShortMessage(length: number): string {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. This one has ${length}`;
}

/** Plain-language copy for errors that need no link. */
export const AUTH_ERROR_COPY = {
    emailNotVerified:
        "Confirm your email first. Open the link we sent when you created your account",
    invalidEmail: "Enter an email address, like you@example.com",
    passwordTooLong: "Use at most 128 characters",
    passwordsDontMatch: "These passwords don't match",
    signUpDisabled: "Sign-ups are turned off on this server",
    rateLimited: "Too many attempts. Wait a minute, then try again",
    network: "Couldn't reach the server. Check your connection and try again",
} as const;
