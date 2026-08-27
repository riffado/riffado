export type SummaryJobResult<T> =
    | { status: "ok"; data: T }
    | { status: "error"; message: string };

const jobs = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

export function subscribeInFlightSummaries(
    onStoreChange: () => void,
): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

export function hasInFlightSummary(recordingId: string): boolean {
    return jobs.has(recordingId);
}

export function getInFlightSummary(
    recordingId: string,
): Promise<unknown> | undefined {
    return jobs.get(recordingId);
}

export function isSummarizingForView(
    viewRecordingId: string | null | undefined,
): boolean {
    return viewRecordingId != null && hasInFlightSummary(viewRecordingId);
}

export function trackInFlightSummary<T>(
    recordingId: string,
    work: () => Promise<T>,
): Promise<T> {
    const existing = jobs.get(recordingId);
    if (existing) return existing as Promise<T>;

    const promise = work().finally(() => {
        if (jobs.get(recordingId) === promise) {
            jobs.delete(recordingId);
            emit();
        }
    });
    jobs.set(recordingId, promise);
    emit();
    return promise;
}

export function nextSummariesById<T>(
    prev: ReadonlyMap<string, T | null>,
    recordingId: string,
    data: T | null,
): Map<string, T | null> {
    const next = new Map(prev);
    next.set(recordingId, data);
    return next;
}

export function summaryForView<T>(
    byId: ReadonlyMap<string, T | null>,
    viewRecordingId: string | null | undefined,
): T | null {
    if (!viewRecordingId) return null;
    return byId.get(viewRecordingId) ?? null;
}

export function resetInFlightSummaries(): void {
    jobs.clear();
    emit();
}
