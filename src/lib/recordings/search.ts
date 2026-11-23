/**
 * Whether a recording matches a library search: case-insensitive
 * substring on the stored filename or the full transcript text. An empty
 * (or whitespace-only) query matches everything. The library list and
 * ⌘K both use this, so the same query finds the same recordings.
 */
export function recordingMatchesQuery(
    filename: string,
    transcriptText: string | undefined,
    query: string,
): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (filename.toLowerCase().includes(q)) return true;
    return !!transcriptText && transcriptText.toLowerCase().includes(q);
}

/** The recordings matching `query`, in their given order. */
export function filterRecordingsByQuery<
    R extends { id: string; filename: string },
>(
    recordings: readonly R[],
    transcriptions: ReadonlyMap<string, { text?: string }>,
    query: string,
): R[] {
    if (!query.trim()) return [...recordings];
    return recordings.filter((r) =>
        recordingMatchesQuery(
            r.filename,
            transcriptions.get(r.id)?.text,
            query,
        ),
    );
}
