"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
    nextSpeakerEditGeneration,
    rollbackSpeakerName,
    shouldApplySpeakerEdit,
} from "@/lib/speakers/rename-state";
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
    const speakerNamesRef = useRef<SpeakerNameMap>({});
    const generationsRef = useRef(new Map<string, number>());

    speakerNamesRef.current = speakerNames;

    useEffect(() => {
        setSpeakerNames({});
        speakerNamesRef.current = {};
        generationsRef.current = new Map();
        if (!recordingId) return;

        const controller = new AbortController();
        fetch(`/api/recordings/${recordingId}/speakers`, {
            signal: controller.signal,
        })
            .then((response) => (response.ok ? response.json() : null))
            .then((data: { speakers?: SpeakerName[] } | null) => {
                if (data?.speakers) {
                    const next = indexSpeakerNames(data.speakers);
                    speakerNamesRef.current = next;
                    setSpeakerNames(next);
                }
            })
            .catch(() => {});

        return () => controller.abort();
    }, [recordingId]);

    const renameSpeaker = useCallback(
        async (speakerLabel: string, displayName: string) => {
            if (!recordingId) return;

            const name = displayName.trim();
            const previousForLabel = speakerNamesRef.current[speakerLabel];

            if (!name && !previousForLabel) return;
            if (
                name &&
                previousForLabel?.displayName === name &&
                previousForLabel.source === "manual"
            ) {
                return;
            }

            const opGeneration = nextSpeakerEditGeneration(
                generationsRef.current,
                speakerLabel,
            );

            const applyIfCurrent = (
                updater: (current: SpeakerNameMap) => SpeakerNameMap,
            ) => {
                setSpeakerNames((current) => {
                    if (
                        !shouldApplySpeakerEdit(
                            generationsRef.current,
                            speakerLabel,
                            opGeneration,
                        )
                    ) {
                        return current;
                    }
                    return updater(current);
                });
            };

            if (!name) {
                applyIfCurrent((current) =>
                    rollbackSpeakerName(current, speakerLabel, undefined),
                );
                try {
                    const response = await fetch(
                        `/api/recordings/${recordingId}/speakers?label=${encodeURIComponent(speakerLabel)}`,
                        { method: "DELETE" },
                    );
                    if (!response.ok) throw new Error("request failed");
                } catch {
                    applyIfCurrent((current) =>
                        rollbackSpeakerName(
                            current,
                            speakerLabel,
                            previousForLabel,
                        ),
                    );
                    toast.error("Failed to clear speaker name");
                }
                return;
            }

            applyIfCurrent((current) => ({
                ...current,
                [speakerLabel]: {
                    speakerLabel,
                    displayName: name,
                    source: "manual",
                    confidence: null,
                    voiceProfileId: null,
                    updatedAt: new Date().toISOString(),
                },
            }));

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
                    applyIfCurrent((current) => ({
                        ...current,
                        [speakerLabel]: saved,
                    }));
                }
            } catch {
                applyIfCurrent((current) =>
                    rollbackSpeakerName(
                        current,
                        speakerLabel,
                        previousForLabel,
                    ),
                );
                toast.error("Failed to rename speaker");
            }
        },
        [recordingId],
    );

    return { speakerNames, renameSpeaker };
}
