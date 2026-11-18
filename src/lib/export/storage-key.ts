import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

const EXPORT_KEY_PREFIX = "exports/";
const EXPORT_KEY_SUFFIX = ".zip";

/** Storage key of one claim attempt's archive: `exports/{userId}/{jobId}-{claimToken}.zip`. */
export function exportArchiveStorageKey(input: {
    userId: string;
    jobId: string;
    claimToken: string;
}): string {
    return `${EXPORT_KEY_PREFIX}${input.userId}/${input.jobId}-${input.claimToken}${EXPORT_KEY_SUFFIX}`;
}

/** `exportArchiveStorageKey` as a SQL expression, for queries that derive the key from `export_jobs` columns. */
export function exportArchiveStorageKeySql(columns: {
    userId: SQLWrapper;
    jobId: SQLWrapper;
    claimToken: SQLWrapper;
}): SQL {
    return sql`${EXPORT_KEY_PREFIX}::text || ${columns.userId} || '/' || ${columns.jobId} || '-' || ${columns.claimToken} || ${EXPORT_KEY_SUFFIX}::text`;
}
