import type { InferSelectModel } from "drizzle-orm";
import type { speakerNames, voiceProfiles } from "@/db/schema";

export type SpeakerNameRow = InferSelectModel<typeof speakerNames>;
export type VoiceProfileRow = InferSelectModel<typeof voiceProfiles>;

/** How a speaker got its name: typed by the user, or matched by voice. */
export type SpeakerNameSource = "manual" | "auto";

/** One diarized speaker label mapped to a human name, over the wire. */
export interface SpeakerName {
    speakerLabel: string;
    displayName: string;
    source: SpeakerNameSource;
    /** Cosine similarity of the voice match; null for manual names. */
    confidence: number | null;
    voiceProfileId: string | null;
    updatedAt: string;
}

/** Speaker names for one recording, keyed by raw transcript label. */
export type SpeakerNameMap = Record<string, SpeakerName>;

/** A known voice, without the embedding (too bulky for list responses). */
export interface VoiceProfileSummary {
    id: string;
    displayName: string;
    sampleCount: number;
    createdAt: string;
    updatedAt: string;
}

export function serializeSpeakerName(row: SpeakerNameRow): SpeakerName {
    return {
        speakerLabel: row.speakerLabel,
        displayName: row.displayName,
        // Column is a plain varchar, so anything unexpected in the DB
        // degrades to the conservative 'manual' reading rather than
        // widening the client-facing union.
        source: row.source === "auto" ? "auto" : "manual",
        confidence: row.confidence ?? null,
        voiceProfileId: row.voiceProfileId ?? null,
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function indexSpeakerNames(names: SpeakerName[]): SpeakerNameMap {
    const map: SpeakerNameMap = {};
    for (const name of names) map[name.speakerLabel] = name;
    return map;
}

export function serializeVoiceProfile(
    row: Omit<VoiceProfileRow, "embedding" | "userId">,
): VoiceProfileSummary {
    return {
        id: row.id,
        displayName: row.displayName,
        sampleCount: row.sampleCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
