"use client";

import { Mic } from "lucide-react";
import type * as React from "react";
import {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    type PendingUpload,
    PendingUploadRow,
} from "@/components/dashboard/pending-upload-row";
import {
    type ListDensity,
    RecordingListToolbar,
    type SortOrder,
} from "@/components/dashboard/recording-list-toolbar";
import { RecordingRow } from "@/components/dashboard/recording-row";
import { dateGroupLabel } from "@/lib/format-date";
import type { DateTimeFormat } from "@/types/common";
import type { Recording } from "@/types/recording";

export type { PendingUpload } from "@/components/dashboard/pending-upload-row";
export type {
    ListDensity,
    SortOrder,
} from "@/components/dashboard/recording-list-toolbar";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface RecordingListProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    currentRecording: Recording | null;
    pendingUploads: PendingUpload[];
    inFlightActions: Map<string, "transcribing" | "summarizing">;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    initialDateTimeFormat: DateTimeFormat;
    initialSortOrder: SortOrder;
    initialDensity: ListDensity;
    initialChunkSize: number;
}

export interface RecordingListHandle {
    focusSearch: () => void;
    next: () => void;
    prev: () => void;
}

function persistSetting(field: string, value: unknown) {
    fetch("/api/settings/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
    }).catch(() => {});
}

function transcriptSnippet(
    text: string | undefined,
    maxChars = 140,
): string | null {
    if (!text) return null;
    const stripped = text
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) return null;
    if (stripped.length <= maxChars) return stripped;
    return `${stripped.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

export function RecordingList({
    recordings,
    transcriptions,
    currentRecording,
    pendingUploads,
    inFlightActions,
    onSelect,
    onDelete,
    initialDateTimeFormat,
    initialSortOrder,
    initialDensity,
    initialChunkSize,
    ref,
}: RecordingListProps & { ref?: React.Ref<RecordingListHandle> }) {
    const [dateTimeFormat] = useState<DateTimeFormat>(initialDateTimeFormat);
    const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder);
    const [density, setDensity] = useState<ListDensity>(initialDensity);
    const [query, setQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(initialChunkSize);
    const searchRef = useRef<HTMLInputElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const setSortOrderPersisted = useCallback((next: SortOrder) => {
        setSortOrder(next);
        persistSetting("recordingListSortOrder", next);
    }, []);

    const setDensityPersisted = useCallback((next: ListDensity) => {
        setDensity(next);
        persistSetting("listDensity", next);
    }, []);

    const registerRowRef = useCallback(
        (id: string, el: HTMLButtonElement | null) => {
            if (el) rowRefs.current.set(id, el);
            else rowRefs.current.delete(id);
        },
        [],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base = q
            ? recordings.filter((r) => {
                  if (r.filename.toLowerCase().includes(q)) return true;
                  const t = transcriptions.get(r.id);
                  return !!t?.text && t.text.toLowerCase().includes(q);
              })
            : recordings;

        const sorted = [...base];
        switch (sortOrder) {
            case "newest":
                sorted.sort(
                    (a, b) =>
                        new Date(b.startTime).getTime() -
                        new Date(a.startTime).getTime(),
                );
                break;
            case "oldest":
                sorted.sort(
                    (a, b) =>
                        new Date(a.startTime).getTime() -
                        new Date(b.startTime).getTime(),
                );
                break;
            case "name":
                sorted.sort((a, b) => a.filename.localeCompare(b.filename));
                break;
        }
        return sorted;
    }, [recordings, transcriptions, query, sortOrder]);

    const visible = filtered.slice(0, visibleCount);

    const grouped = useMemo(() => {
        if (sortOrder === "name") {
            return [{ label: null as string | null, items: visible }];
        }
        const groups: { label: string; items: Recording[] }[] = [];
        for (const r of visible) {
            const label = dateGroupLabel(r.startTime);
            const last = groups[groups.length - 1];
            if (last && last.label === label) {
                last.items.push(r);
            } else {
                groups.push({ label, items: [r] });
            }
        }
        return groups;
    }, [visible, sortOrder]);

    // Reset visibleCount when the filter changes so search results
    // aren't accidentally truncated.
    useEffect(() => {
        setVisibleCount(initialChunkSize);
    }, [initialChunkSize]);
    useEffect(() => {
        setVisibleCount((c) =>
            c > filtered.length
                ? Math.max(initialChunkSize, filtered.length)
                : c,
        );
    }, [filtered.length, initialChunkSize]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        setVisibleCount((c) =>
                            Math.min(c + initialChunkSize, filtered.length),
                        );
                    }
                }
            },
            { rootMargin: "200px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [filtered.length, initialChunkSize]);

    useImperativeHandle(
        ref,
        () => ({
            focusSearch: () => searchRef.current?.focus(),
            next: () => {
                const list = filtered;
                if (list.length === 0) return;
                const idx = currentRecording
                    ? list.findIndex((r) => r.id === currentRecording.id)
                    : -1;
                const nextIdx = Math.min(idx + 1, list.length - 1);
                const target = list[Math.max(0, nextIdx)];
                if (target) {
                    onSelect(target);
                    rowRefs.current
                        .get(target.id)
                        ?.scrollIntoView({ block: "nearest" });
                }
            },
            prev: () => {
                const list = filtered;
                if (list.length === 0) return;
                const idx = currentRecording
                    ? list.findIndex((r) => r.id === currentRecording.id)
                    : 0;
                const prevIdx = Math.max(0, idx - 1);
                const target = list[prevIdx];
                if (target) {
                    onSelect(target);
                    rowRefs.current
                        .get(target.id)
                        ?.scrollIntoView({ block: "nearest" });
                }
            },
        }),
        [filtered, currentRecording, onSelect],
    );

    const isCompact = density === "compact";
    const rowPadding = isCompact ? "px-4 py-2" : "px-4 py-3";

    return (
        <div className="flex h-full flex-col">
            <RecordingListToolbar
                query={query}
                onQueryChange={setQuery}
                onEnterSelectFirst={() => {
                    if (filtered.length > 0) onSelect(filtered[0]);
                }}
                searchRef={searchRef}
                filteredCount={filtered.length}
                totalCount={recordings.length}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrderPersisted}
                density={density}
                onDensityChange={setDensityPersisted}
            />

            <div className="flex-1 overflow-y-auto">
                {pendingUploads.length > 0 && (
                    <div className="divide-y divide-border/40 bg-muted/20">
                        {pendingUploads.map((p) => (
                            <PendingUploadRow
                                key={p.id}
                                upload={p}
                                rowPadding={rowPadding}
                            />
                        ))}
                    </div>
                )}

                {grouped.map((group, gi) => (
                    <div key={group.label ?? `__ungrouped-${gi.toString()}`}>
                        {group.label && (
                            <div className="sticky top-0 z-10 bg-background/90 px-5 pt-4 pb-1.5 text-[10px] font-semibold uppercase leading-none tracking-widest text-muted-foreground/50 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75 font-mono">
                                {group.label}
                            </div>
                        )}
                        <div className="divide-y divide-border/30">
                            {group.items.map((recording) => (
                                <RecordingRow
                                    key={recording.id}
                                    recording={recording}
                                    isSelected={
                                        currentRecording?.id === recording.id
                                    }
                                    inFlight={inFlightActions.get(recording.id)}
                                    snippet={transcriptSnippet(
                                        transcriptions.get(recording.id)?.text,
                                    )}
                                    isCompact={isCompact}
                                    rowPadding={rowPadding}
                                    dateTimeFormat={dateTimeFormat}
                                    onSelect={onSelect}
                                    onDelete={onDelete}
                                    registerRef={registerRowRef}
                                />
                            ))}
                        </div>
                    </div>
                ))}

                {filtered.length === 0 && pendingUploads.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
                        <div className="rounded-full bg-muted/40 p-3">
                            <Mic className="size-5 text-muted-foreground/40" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {query
                                ? "No recordings match your search."
                                : "No recordings yet."}
                        </p>
                    </div>
                )}

                <div ref={sentinelRef} className="h-4" aria-hidden="true" />
            </div>
        </div>
    );
}
