/**
 * Optimistic filename overlays for the dashboard list. Applied only
 * until a refreshed `recordings` snapshot arrives; after that, server
 * truth wins (sync, another client, or our own PATCH).
 */

export function applyFilenameOverrides<
    T extends { id: string; filename: string },
>(recordings: T[], overrides: Map<string, string>): T[] {
    if (overrides.size === 0) return recordings;
    return recordings.map((recording) => {
        const filename = overrides.get(recording.id);
        return filename !== undefined ? { ...recording, filename } : recording;
    });
}

/**
 * End the pending overlay window. Workstation always receives the full
 * list: ids in the snapshot have server truth, ids missing from it are
 * gone. Either way the overlay is done.
 */
export function reconcileFilenameOverrides(
    _recordings: readonly { id: string }[],
    overrides: Map<string, string>,
): Map<string, string> {
    if (overrides.size === 0) return overrides;
    return new Map();
}
