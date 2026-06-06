"use client";

import { Users } from "lucide-react";
import { useMemo } from "react";
import {
    parseDiarized,
    speakerColor,
} from "@/lib/transcription/parse-diarized";
import { cn } from "@/lib/utils";

interface Props {
    text: string;
    className?: string;
}

/**
 * Renders a diarized (speaker-labelled) transcript as styled speaker blocks.
 *
 * Each speaker gets a consistent colour badge. Consecutive segments from the
 * same speaker are visually grouped. Falls back to a plain `<p>` if the text
 * doesn't parse into any speaker segments (should never happen because the
 * parent checks `isDiarized()` first, but safe is better than sorry).
 */
export function DiarizedTranscript({ text, className }: Props) {
    const segments = useMemo(() => parseDiarized(text), [text]);

    // Build a stable speaker → index map so colours don't shift if the
    // segment array is re-parsed (e.g. after an inline edit).
    const speakerIndex = useMemo(() => {
        const map = new Map<string, number>();
        for (const seg of segments) {
            if (!map.has(seg.speaker)) {
                map.set(seg.speaker, map.size);
            }
        }
        return map;
    }, [segments]);

    const speakerCount = speakerIndex.size;

    if (segments.length === 0) {
        return (
            <p
                className={cn(
                    "text-sm whitespace-pre-wrap leading-relaxed text-foreground/90",
                    className,
                )}
            >
                {text}
            </p>
        );
    }

    return (
        <div className={cn("space-y-1", className)}>
            {/* Speaker legend */}
            {speakerCount > 1 && (
                <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-border/40">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">
                        <Users className="size-3" />
                        {speakerCount} speakers
                    </span>
                    {Array.from(speakerIndex.entries()).map(([, idx]) => (
                        <span
                            key={idx}
                            className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                speakerColor(idx),
                            )}
                        >
                            Speaker {idx + 1}
                        </span>
                    ))}
                </div>
            )}

            {/* Segments */}
            <div className="space-y-2 pt-1">
                {segments.map((seg, i) => {
                    const idx = speakerIndex.get(seg.speaker) ?? 0;
                    const color = speakerColor(idx);
                    // Check if this segment starts a new speaker block
                    const prevSpeaker = i > 0 ? segments[i - 1]?.speaker : null;
                    const isNewSpeaker = seg.speaker !== prevSpeaker;

                    return (
                        <div
                            key={`${seg.speaker}-${i}`}
                            className={cn(
                                "flex gap-3",
                                isNewSpeaker && i > 0 && "mt-3",
                            )}
                        >
                            {/* Speaker badge — only shown on the first segment of a run */}
                            <div className="w-20 shrink-0 pt-0.5">
                                {isNewSpeaker && (
                                    <span
                                        className={cn(
                                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap",
                                            color,
                                        )}
                                    >
                                        {seg.label}
                                    </span>
                                )}
                            </div>

                            {/* Transcript text */}
                            <p className="flex-1 text-sm leading-relaxed text-foreground/90">
                                {seg.text}
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
