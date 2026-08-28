export function isSummarizingForView(
    viewRecordingId: string | null | undefined,
    summarizingIds: ReadonlySet<string>,
): boolean {
    return viewRecordingId != null && summarizingIds.has(viewRecordingId);
}

export function shouldApplySummaryToView(
    viewRecordingId: string | null | undefined,
    jobRecordingId: string,
): boolean {
    return viewRecordingId === jobRecordingId;
}

export function shouldApplyFetchedSummary(
    viewRecordingId: string | null | undefined,
    requestedId: string,
    currentGeneration: number,
    fetchGeneration: number,
): boolean {
    return (
        shouldApplySummaryToView(viewRecordingId, requestedId) &&
        currentGeneration === fetchGeneration
    );
}

export function addSummarizingId(
    prev: ReadonlySet<string>,
    recordingId: string,
): Set<string> {
    const next = new Set(prev);
    next.add(recordingId);
    return next;
}

export function removeSummarizingId(
    prev: ReadonlySet<string>,
    recordingId: string,
): Set<string> {
    const next = new Set(prev);
    next.delete(recordingId);
    return next;
}
