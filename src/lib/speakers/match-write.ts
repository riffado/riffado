/** Postgres SQLSTATE for unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code;
    return code === PG_UNIQUE_VIOLATION || causeCode === PG_UNIQUE_VIOLATION;
}

export type LockedSpeakerName = {
    id: string;
    source: string;
    displayName: string;
};

export type ConflictSpeakerOutcome =
    | { action: "skip"; displayName: string }
    | { action: "update"; id: string; displayName: string }
    | { action: "none" };

/**
 * After an absent-row insert loses a unique race, classify the row that
 * now exists. A manual name wins and must be reported as skipped; any
 * other existing row can take a guarded auto update.
 */
export function classifyConflictSpeaker(
    row: LockedSpeakerName | undefined,
): ConflictSpeakerOutcome {
    if (!row) return { action: "none" };
    if (row.source === "manual") {
        return { action: "skip", displayName: row.displayName };
    }
    return { action: "update", id: row.id, displayName: row.displayName };
}
