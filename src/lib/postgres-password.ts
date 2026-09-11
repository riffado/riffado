/** Compose / image default for the bundled `postgres` role. */
export const DEFAULT_POSTGRES_PASSWORD = "postgres";

/** True when `DATABASE_URL` uses that known default password. */
export function usesDefaultPostgresPassword(
    databaseUrl: string | undefined,
): boolean {
    if (!databaseUrl) return false;
    try {
        return new URL(databaseUrl).password === DEFAULT_POSTGRES_PASSWORD;
    } catch {
        return false;
    }
}
