import type { SpeakerName, SpeakerNameMap } from "@/types/speaker";

/** Bump and return the next edit generation for one speaker label. */
export function nextSpeakerEditGeneration(
    gens: Map<string, number>,
    speakerLabel: string,
): number {
    const next = (gens.get(speakerLabel) ?? 0) + 1;
    gens.set(speakerLabel, next);
    return next;
}

export function speakerEditGeneration(
    gens: ReadonlyMap<string, number>,
    speakerLabel: string,
): number {
    return gens.get(speakerLabel) ?? 0;
}

/** True when `opGeneration` is still the latest edit for this label. */
export function shouldApplySpeakerEdit(
    gens: ReadonlyMap<string, number>,
    speakerLabel: string,
    opGeneration: number,
): boolean {
    return speakerEditGeneration(gens, speakerLabel) === opGeneration;
}

/**
 * Restore one speaker label after a failed optimistic write, leaving
 * every other label in `current` untouched.
 */
export function rollbackSpeakerName(
    current: SpeakerNameMap,
    speakerLabel: string,
    previous: SpeakerName | undefined,
): SpeakerNameMap {
    if (previous === undefined) {
        if (!(speakerLabel in current)) return current;
        const next = { ...current };
        delete next[speakerLabel];
        return next;
    }
    return { ...current, [speakerLabel]: previous };
}
