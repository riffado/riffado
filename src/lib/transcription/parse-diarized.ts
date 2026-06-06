/**
 * Utilities for handling diarized (speaker-labelled) transcription output.
 *
 * WhisperX stores diarized output in the format:
 *   SPEAKER_00: First sentence spoken.\nSPEAKER_01: Second sentence.\n...
 *
 * Lines that don't start with a SPEAKER_XX: prefix are treated as
 * continuation lines belonging to the most-recent speaker.
 */

export interface DiarizedSegment {
    speaker: string;
    /** Display label derived from the raw speaker id, e.g. "Speaker 1". */
    label: string;
    text: string;
}

/** Regex that matches the WhisperX speaker-label prefix at line start. */
const SPEAKER_PREFIX = /^(SPEAKER_\d+):\s*/;

/**
 * Returns true when the text was produced by a diarized transcription run.
 * Checks the first non-empty line only — cheap enough to call on every render.
 */
export function isDiarized(text: string): boolean {
    const firstLine = text.trimStart().split("\n")[0] ?? "";
    return SPEAKER_PREFIX.test(firstLine);
}

/**
 * Parse a diarized transcript string into an ordered array of speaker
 * segments, merging consecutive lines from the same speaker.
 */
export function parseDiarized(text: string): DiarizedSegment[] {
    const lines = text.split("\n");
    const raw: { speaker: string; text: string }[] = [];
    let currentSpeaker: string | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = SPEAKER_PREFIX.exec(trimmed);
        if (match) {
            currentSpeaker = match[1];
            const segText = trimmed.slice(match[0].length).trim();
            if (segText) {
                raw.push({ speaker: currentSpeaker, text: segText });
            }
        } else if (currentSpeaker) {
            // Continuation line — append to the last segment from this speaker.
            const last = raw[raw.length - 1];
            if (last && last.speaker === currentSpeaker) {
                last.text = `${last.text} ${trimmed}`;
            } else {
                raw.push({ speaker: currentSpeaker, text: trimmed });
            }
        }
    }

    // Merge adjacent segments from the same speaker (WhisperX can emit
    // multiple short segments in a row for the same speaker ID).
    const merged: { speaker: string; text: string }[] = [];
    for (const seg of raw) {
        const prev = merged[merged.length - 1];
        if (prev && prev.speaker === seg.speaker) {
            prev.text = `${prev.text} ${seg.text}`;
        } else {
            merged.push({ ...seg });
        }
    }

    // Build stable speaker-number → friendly label mapping.
    const speakerOrder: string[] = [];
    for (const seg of merged) {
        if (!speakerOrder.includes(seg.speaker)) {
            speakerOrder.push(seg.speaker);
        }
    }

    return merged.map((seg) => ({
        speaker: seg.speaker,
        label: `Speaker ${speakerOrder.indexOf(seg.speaker) + 1}`,
        text: seg.text,
    }));
}

/** Palette of muted colours for speaker blocks. Cycles when > 8 speakers. */
export const SPEAKER_COLORS = [
    "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400",
    "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-400",
    "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
    "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400",
    "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400",
    "bg-cyan-500/10 border-cyan-500/20 text-cyan-700 dark:text-cyan-400",
    "bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-400",
    "bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-400",
] as const;

export function speakerColor(speakerIndex: number): string {
    return (
        SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length] ??
        SPEAKER_COLORS[0]
    );
}
