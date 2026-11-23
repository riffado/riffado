"use client";

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
    ListViewMenu,
    RecordingListToolbar,
    type SortOrder,
} from "@/components/dashboard/recording-list-toolbar";
import {
    RecordingRow,
    type RecordingRowActions,
} from "@/components/dashboard/recording-row";
import { FilterGroup } from "@/components/ui/filter-group";
import { useListFlip } from "@/hooks/use-list-flip";
import {
    dateGroupLabel,
    formatDateTime,
    formatRowTime,
} from "@/lib/format-date";
import type { DateTimeFormat } from "@/types/common";
import type { Recording } from "@/types/recording";

export type { PendingUpload } from "@/components/dashboard/pending-upload-row";
export type {
    ListDensity,
    SortOrder,
} from "@/components/dashboard/recording-list-toolbar";

/** Which recordings the list shows. */
export type LibraryFilter = "all" | "untranscribed";

const FILTER_OPTIONS = [
    { value: "all", label: "All" },
    { value: "untranscribed", label: "Untranscribed" },
] as const satisfies readonly { value: LibraryFilter; label: string }[];

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
    /** Recorder names keyed by serial number, for the row metadata line. */
    deviceNames: Map<string, string>;
    query: string;
    onQueryChange: (next: string) => void;
    filter: LibraryFilter;
    onFilterChange: (next: LibraryFilter) => void;
    /** Sync status and actions shown next to the pane title on `lg`+. */
    headerActions: React.ReactNode;
    /** Notice shown between the header and the rows (e.g. reconnect). */
    banner: React.ReactNode;
    onSelect: (recording: Recording) => void;
    onDelete: (recording: Recording) => Promise<void>;
    /** Handlers and shared state for each row's action menus. */
    rowActions: RecordingRowActions;
    initialDateTimeFormat: DateTimeFormat;
    initialSortOrder: SortOrder;
    initialDensity: ListDensity;
    initialChunkSize: number;
}

export interface RecordingListHandle {
    focusSearch: () => void;
    /** Selects the first recording the list currently shows. */
    selectFirst: () => void;
    next: () => void;
    prev: () => void;
    /** Records row positions before an add or remove so the list can animate the change. */
    snapshotLayout: () => void;
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

function emptyMessage(query: string, filter: LibraryFilter): string {
    if (query) return "No recordings match your search.";
    if (filter === "untranscribed") return "Every recording is transcribed.";
    return "No recordings yet.";
}

export function RecordingList({
    recordings,
    transcriptions,
    currentRecording,
    pendingUploads,
    inFlightActions,
    deviceNames,
    query,
    onQueryChange,
    filter,
    onFilterChange,
    headerActions,
    banner,
    onSelect,
    onDelete,
    rowActions,
    initialDateTimeFormat,
    initialSortOrder,
    initialDensity,
    initialChunkSize,
    ref,
}: RecordingListProps & { ref?: React.Ref<RecordingListHandle> }) {
    const [dateTimeFormat] = useState<DateTimeFormat>(initialDateTimeFormat);
    const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder);
    const [density, setDensity] = useState<ListDensity>(initialDensity);
    const [visibleCount, setVisibleCount] = useState(initialChunkSize);
    const searchRef = useRef<HTMLInputElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
    const { snapshot } = useListFlip(bodyRef);

    const setSortOrderPersisted = useCallback((next: SortOrder) => {
        setSortOrder(next);
        persistSetting("recordingListSortOrder", next);
    }, []);

    const setDensityPersisted = useCallback((next: ListDensity) => {
        setDensity(next);
        persistSetting("listDensity", next);
    }, []);

    const registerRowRef = useCallback((id: string, el: HTMLElement | null) => {
        if (el) rowRefs.current.set(id, el);
        else rowRefs.current.delete(id);
    }, []);

    const isTranscribed = useCallback(
        (r: Recording) =>
            r.hasTranscript === true || !!transcriptions.get(r.id)?.text,
        [transcriptions],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base = recordings.filter((r) => {
            if (filter === "untranscribed" && isTranscribed(r)) return false;
            if (!q) return true;
            if (r.filename.toLowerCase().includes(q)) return true;
            const t = transcriptions.get(r.id);
            return !!t?.text && t.text.toLowerCase().includes(q);
        });

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
    }, [recordings, transcriptions, query, filter, sortOrder, isTranscribed]);

    const visible = filtered.slice(0, visibleCount);
    const isGrouped = sortOrder !== "name";

    const grouped = useMemo(() => {
        if (!isGrouped) {
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
    }, [visible, isGrouped]);

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
            selectFirst: () => {
                const target = filtered[0];
                if (target) onSelect(target);
            },
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
                    rowRefs.current.get(target.id)?.scrollIntoView({
                        block: "nearest",
                        behavior: "instant",
                    });
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
                    rowRefs.current.get(target.id)?.scrollIntoView({
                        block: "nearest",
                        behavior: "instant",
                    });
                }
            },
            snapshotLayout: snapshot,
        }),
        [filtered, currentRecording, onSelect, snapshot],
    );

    const isCompact = density === "compact";
    const now = new Date();
    const rowMeta = (r: Recording): string => {
        const time =
            isGrouped && dateTimeFormat === "relative"
                ? formatRowTime(r.startTime, now)
                : formatDateTime(r.startTime, dateTimeFormat);
        const device = r.deviceSn ? deviceNames.get(r.deviceSn) : undefined;
        return device ? `${time} \u00b7 ${device}` : time;
    };

    return (
        <div className="flex flex-col lg:h-full lg:min-h-0">
            <div className="flex flex-col gap-4 pb-3.5 lg:px-6 lg:pt-6.5">
                <div className="hidden items-baseline justify-between gap-3 lg:flex">
                    <h1 className="font-display text-pane-title font-semibold text-strong select-none">
                        Library
                    </h1>
                    {headerActions}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <FilterGroup
                        aria-label="Show recordings"
                        value={filter}
                        onValueChange={onFilterChange}
                        options={FILTER_OPTIONS}
                    />
                    <ListViewMenu
                        sortOrder={sortOrder}
                        onSortOrderChange={setSortOrderPersisted}
                        density={density}
                        onDensityChange={setDensityPersisted}
                    />
                </div>
            </div>

            {banner}

            <RecordingListToolbar
                query={query}
                onQueryChange={onQueryChange}
                onEnterSelectFirst={() => {
                    if (filtered.length > 0) onSelect(filtered[0]);
                }}
                searchRef={searchRef}
                filteredCount={filtered.length}
                totalCount={recordings.length}
            />

            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
                <div
                    ref={bodyRef}
                    className="flex flex-col gap-0.5 pb-4 lg:px-2.5"
                >
                    {pendingUploads.map((p) => (
                        <PendingUploadRow
                            key={p.id}
                            upload={p}
                            isCompact={isCompact}
                        />
                    ))}

                    {grouped.map((group, gi) => (
                        <div
                            key={group.label ?? `__ungrouped-${gi.toString()}`}
                            className="flex flex-col gap-0.5"
                        >
                            {group.label && (
                                <div
                                    data-flip-key={`group:${group.label}`}
                                    className="z-10 bg-background px-3.5 pt-3.5 pb-1.5 text-xs font-medium text-muted-foreground select-none lg:sticky lg:top-0"
                                >
                                    {group.label}
                                </div>
                            )}
                            {group.items.map((recording) => (
                                <RecordingRow
                                    key={recording.id}
                                    recording={recording}
                                    href={`?r=${encodeURIComponent(recording.id)}`}
                                    isSelected={
                                        currentRecording?.id === recording.id
                                    }
                                    hasTranscript={isTranscribed(recording)}
                                    inFlight={inFlightActions.get(recording.id)}
                                    snippet={transcriptSnippet(
                                        transcriptions.get(recording.id)?.text,
                                    )}
                                    meta={rowMeta(recording)}
                                    isCompact={isCompact}
                                    onSelect={onSelect}
                                    onDelete={onDelete}
                                    actions={rowActions}
                                    registerRef={registerRowRef}
                                />
                            ))}
                        </div>
                    ))}

                    {filtered.length === 0 && pendingUploads.length === 0 && (
                        <p className="px-3.5 py-10 text-center text-small text-muted-foreground select-none">
                            {emptyMessage(query, filter)}
                        </p>
                    )}

                    <div ref={sentinelRef} className="h-4" aria-hidden="true" />
                </div>
            </div>
        </div>
    );
}
