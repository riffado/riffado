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

export function contentGenerationFor(
    gens: ReadonlyMap<string, number>,
    recordingId: string,
): number {
    return gens.get(recordingId) ?? 0;
}

export function bumpContentGeneration(
    gens: Map<string, number>,
    recordingId: string,
): void {
    gens.set(recordingId, contentGenerationFor(gens, recordingId) + 1);
}

export function rememberTranscriptionText(
    texts: Map<string, string | null | undefined>,
    recordingId: string,
    text: string | null | undefined,
): boolean {
    const seen = texts.has(recordingId);
    const prev = texts.get(recordingId);
    texts.set(recordingId, text);
    return seen && prev !== text;
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
