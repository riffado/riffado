"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    indexSpeakerNames,
    type SpeakerName,
    type SpeakerNameMap,
} from "@/types/speaker";

/**
 * Speaker names for one recording plus the writer the transcript UI uses
 * to rename them inline.
 *
 * Names are fetched once per recording and written optimistically: the
 * chip updates immediately and only rolls back if the request fails.
 * Passing an empty `displayName` clears the name, dropping the speaker
 * back to its raw diarization label.
 *
 * A rename always lands as `source: 'manual'`, because renaming an
 * auto-matched speaker usually means the match itself was wrong.
 */
export function useSpeakerNames(recordingId: string | null | undefined) {
    const [speakerNames, setSpeakerNames] = useState<SpeakerNameMap>({});

    useEffect(() => {
        setSpeakerNames({});
        if (!recordingId) return;

        const controller = new AbortController();
        fetch(`/api/recordings/${recordingId}/speakers`, {
            signal: controller.signal,
        })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: { speakers?: SpeakerName[] } | null) => {
                if (data?.speakers) {
                    setSpeakerNames(indexSpeakerNames(data.speakers));
                }
            })
            .catch(() => {});

        return () => controller.abort();
    }, [recordingId]);

    const renameSpeaker = useCallback(
        async (speakerLabel: string, displayName: string) => {
            if (!recordingId) return;

            const name = displayName.trim();
            const previous = speakerNames;
            const existing = previous[speakerLabel];

            if (!name) {
                if (!existing) return;
                setSpeakerNames(
                    Object.fromEntries(
                        Object.entries(previous).filter(
                            ([label]) => label !== speakerLabel,
                        ),
                    ),
                );
                try {
                    const response = await fetch(
                        `/api/recordings/${recordingId}/speakers?label=${encodeURIComponent(speakerLabel)}`,
                        { method: "DELETE" },
                    );
                    if (!response.ok) throw new Error("request failed");
                } catch {
                    setSpeakerNames(previous);
                    toast.error("Failed to clear speaker name");
                }
                return;
            }

            if (
                existing?.displayName === name &&
                existing.source === "manual"
            ) {
                return;
            }

            setSpeakerNames({
                ...previous,
                [speakerLabel]: {
                    speakerLabel,
                    displayName: name,
                    source: "manual",
                    confidence: null,
                    voiceProfileId: null,
                    updatedAt: new Date().toISOString(),
                },
            });

            try {
                const response = await fetch(
                    `/api/recordings/${recordingId}/speakers`,
                    {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            speakerLabel,
                            displayName: name,
                        }),
                    },
                );
                if (!response.ok) throw new Error("request failed");
                const data = (await response.json()) as {
                    speaker?: SpeakerName;
                };
                const saved = data.speaker;
                if (saved) {
                    setSpeakerNames((current) => ({
                        ...current,
                        [speakerLabel]: saved,
                    }));
                }
            } catch {
                setSpeakerNames(previous);
                toast.error("Failed to rename speaker");
            }
        },
        [recordingId, speakerNames],
    );

    return { speakerNames, renameSpeaker };
}
