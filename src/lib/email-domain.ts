/**
 * Pure helpers for the ALLOWED_EMAIL_DOMAINS sign-up gate.
 *
 * Kept separate from `src/lib/auth.ts` so the predicate can be imported by
 * both the better-auth `databaseHooks` (server) and the register form
 * (client hint) without dragging the auth runtime through the client bundle.
 */

export function extractEmailDomain(email: string): string | null {
    const at = email.lastIndexOf("@");
    if (at < 0 || at === email.length - 1) return null;
    return email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/**
 * Returns true when `email`'s domain is in `allowedDomains` (case-insensitive,
 * exact match — subdomains are NOT auto-allowed). Empty `allowedDomains`
 * means "no restriction" (gate is off).
 */
export function isEmailDomainAllowed(
    email: string,
    allowedDomains: readonly string[],
): boolean {
    if (allowedDomains.length === 0) return true;
    const domain = extractEmailDomain(email);
    if (!domain) return false;
    return allowedDomains.includes(domain);
}
