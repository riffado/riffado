"use client";

import { Upload } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { LibrarySidebar } from "@/components/dashboard/library-sidebar";
import { PlaudReconnectBanner } from "@/components/dashboard/plaud-reconnect-banner";
import {
    type LibraryFilter,
    type PendingUpload,
    RecordingList,
    type RecordingListHandle,
} from "@/components/dashboard/recording-list";
import type { RecordingRowActions } from "@/components/dashboard/recording-row";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { useBrowserTranscription } from "@/components/dashboard/transcribe-in-browser-button";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import {
    type TranscriptionData,
    WorkstationDetailPane,
} from "@/components/dashboard/workstation-detail-pane";
import { WorkstationEmptyState } from "@/components/dashboard/workstation-empty-state";
import { WorkstationHeader } from "@/components/dashboard/workstation-header";
import type { RecordingViewRequest } from "@/components/recording/recording-view";
import { transcriptionProviderStateFor } from "@/components/recording/summary-provider";
import { SyncStatus } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useProviderList } from "@/hooks/use-provider-list";
import { useSummaryPrompts } from "@/hooks/use-summary-prompts";
import { useTheme } from "@/hooks/use-theme";
import { useTranscribeQueue } from "@/hooks/use-transcribe-queue";
import {
    matchUploadedRecordings,
    useUploadQueue,
} from "@/hooks/use-upload-queue";
import { rememberLibraryLocation } from "@/lib/library-location";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import {
    applyFilenameOverrides,
    reconcileFilenameOverrides,
} from "@/lib/recordings/filename-overrides";
import type { InitialSettings } from "@/lib/settings/initial-settings";
import { SYNC_CONFIG } from "@/lib/sync-config";
import { chimeNewRecordings, setToastSound, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { RecorderDevice } from "@/types/device";
import type { Recording } from "@/types/recording";

const DESKTOP_QUERY = "(min-width: 64rem)";
/** `history.state` flag on a phone entry that opened a recording over the list. */
const LIST_BELOW = "riffadoListBelow";
/** How long an uploaded row waits for its recording before it is dropped. */
const UPLOAD_SETTLE_MS = 10_000;

function subscribeDesktop(onChange: () => void) {
    const query = window.matchMedia(DESKTOP_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}

function useIsDesktop(): boolean {
    return useSyncExternalStore(
        subscribeDesktop,
        () => window.matchMedia(DESKTOP_QUERY).matches,
        () => true,
    );
}

function openRecordingParam(): string | null {
    return new URLSearchParams(window.location.search).get("r");
}

/**
 * Puts the open recording in the URL (`?r=<id>`, or none) through the
 * History API, which Next.js syncs into `useSearchParams` without a
 * server round trip. A push marks its entry as sitting over the list so
 * the reader's back control can step back to it.
 */
function writeOpenRecording(id: string | null, mode: "push" | "replace") {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("r", id);
    else url.searchParams.delete("r");
    if (url.href === window.location.href) return;
    const listBelow =
        mode === "push" || window.history.state?.[LIST_BELOW] === true;
    const state = id && listBelow ? { [LIST_BELOW]: true } : {};
    if (mode === "push") window.history.pushState(state, "", url);
    else window.history.replaceState(state, "", url);
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    /**
     * When true, an admin shortcut appears in the avatar menu. Set by
     * the server-rendered page based on env.ADMIN_EMAILS membership;
     * never trusted client-side -- the actual /admin gate runs
     * server-side.
     */
    isAdmin?: boolean;
    /**
     * Logged-in user's email. Passed down to the avatar menu for the
     * identity block. Server-supplied -- never derive from any client
     * state, which would risk a stale or attacker-influenced value.
     */
    userEmail?: string | null;
    /**
     * Logged-in user's display name for the sidebar account row, or null
     * when the account has none. Server-supplied from the session.
     */
    userName: string | null;
    /**
     * Plaud recorders linked to this account, for the sidebar Recorders
     * section. Server-supplied; empty when Plaud isn't connected.
     */
    devices: RecorderDevice[];
    initialSettings: InitialSettings;
    /**
     * True when Plaud has rejected the stored token (connection row carries
     * an `invalidatedAt`). Seeds the reconnect banner on first paint; the
     * live sync result takes over once a sync runs. Server-supplied.
     */
    plaudNeedsReconnect: boolean;
    /**
     * When the Plaud sign-in ends for good (ISO string), or null when
     * unknown. Lets the reconnect banner warn before the connection ends.
     * Server-supplied.
     */
    plaudSessionExpiresAt: string | null;
    /**
     * When the server last recorded a successful Plaud sync (ISO string),
     * or null when never. Shown as "Last synced ..." while Plaud needs a
     * reconnect. Server-supplied.
     */
    plaudLastSyncAt: string | null;
    /**
     * True when the account has a Plaud connection row (valid or not).
     * Without one, sync UI is hidden and no sync runs. Seeds local state
     * that flips to true when Plaud connects from the dashboard.
     * Server-supplied.
     */
    hasPlaudConnection: boolean;
    /**
     * True when running in Riffado's hosted mode (`IS_HOSTED=true`).
     * Gates hosted-only dashboard UI such as the trial banner.
     * Server-supplied; never derive client-side.
     * Required (no default) so a future caller can't silently regress
     * hosted-mode behavior by forgetting to thread the value through.
     */
    isHosted: boolean;
}

/**
 * Top-level dashboard component. Composition root for the recording
 * list, the detail pane (player + transcription), and the two
 * modals (CommandPalette, ShortcutsDialog). Settings
 * is a separate page (`/settings`).
 *
 * State ownership is split:
 *  - the open recording lives in the URL (`?r=<id>`): desktop replaces
 *    the entry as the selection moves, phones push one per opened
 *    recording so Back returns to the list
 *  - uploads -> useUploadQueue
 *  - transcribes -> useTranscribeQueue
 *  - sync loop -> useAutoSync
 *  - theme -> useTheme
 *  - keyboard nav -> useListKeyboardNav
 *  - deletes stay here because they need access to currentRecording
 *    / visibleRecordings to pick the next selection.
 */
export function Workstation({
    recordings,
    transcriptions,
    isAdmin = false,
    userEmail = null,
    userName,
    devices,
    initialSettings,
    plaudNeedsReconnect,
    plaudSessionExpiresAt,
    plaudLastSyncAt,
    hasPlaudConnection: hasPlaudConnectionProp,
    isHosted,
}: WorkstationProps) {
    const { refresh, push, prefetch, back } = useRouter();
    const searchParams = useSearchParams();
    const urlRecordingId = searchParams.get("r");
    const isDesktop = useIsDesktop();
    // Seeded from the server; set true as soon as Plaud connects from the
    // dashboard so sync UI appears before `refresh()` lands, and re-seeded
    // whenever fresh server truth arrives.
    const [hasPlaudConnection, setHasPlaudConnection] = useState(
        hasPlaudConnectionProp,
    );
    useEffect(() => {
        setHasPlaudConnection(hasPlaudConnectionProp);
    }, [hasPlaudConnectionProp]);
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        () =>
            (urlRecordingId
                ? recordings.find((r) => r.id === urlRecordingId)
                : undefined) ??
            recordings[0] ??
            null,
    );
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
    const [filenameOverrides, setFilenameOverrides] = useState<
        Map<string, string>
    >(() => new Map());
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<LibraryFilter>("all");
    const sidebarSearchRef = useRef<HTMLInputElement>(null);
    const deviceNames = useMemo(
        () => new Map(devices.map((d) => [d.serialNumber, d.name || d.model])),
        [devices],
    );
    const { providers, prefetch: prefetchProviders } = useProviderList();

    // A new account lands here once with `?welcome=1` (straight after
    // sign-up, or from the verification link). Greet it by first name and
    // drop the flag so a reload or Back doesn't greet again.
    const welcomed = useRef(false);
    useEffect(() => {
        if (welcomed.current || searchParams.get("welcome") !== "1") return;
        welcomed.current = true;
        toast.success(welcomeMessage(userName));
        const url = new URL(window.location.href);
        url.searchParams.delete("welcome");
        window.history.replaceState(window.history.state, "", url);
    }, [searchParams, userName]);

    // Settings is its own page. Entry points warm the route on hover or
    // focus; the page reads providers on the server, so nothing else
    // needs loading first.
    const prefetchSettings = useCallback(() => {
        prefetch("/settings");
    }, [prefetch]);

    const openSettings = useCallback(() => {
        push("/settings");
    }, [push]);

    const { theme, setTheme } = useTheme(initialSettings.theme);
    useEffect(() => {
        setToastSound(initialSettings.notificationSound);
    }, [initialSettings.notificationSound]);
    const listRef = useRef<RecordingListHandle>(null);

    // Filter out optimistically-hidden (deleted) rows.
    const visibleRecordings = useMemo(
        () =>
            applyFilenameOverrides(
                recordings.filter((r) => !hiddenIds.has(r.id)),
                filenameOverrides,
            ),
        [recordings, hiddenIds, filenameOverrides],
    );

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    const selectedRecording = currentRecording
        ? (visibleRecordings.find((r) => r.id === currentRecording.id) ??
          currentRecording)
        : null;

    const readerOpen =
        urlRecordingId !== null &&
        visibleRecordings.some((r) => r.id === urlRecordingId);
    const phoneReaderOpen = readerOpen && !isDesktop;

    const lastPickAt = useRef(0);

    const selectRecording = useCallback((recording: Recording) => {
        lastPickAt.current = performance.now();
        setCurrentRecording(recording);
        const fromPhoneList =
            !window.matchMedia(DESKTOP_QUERY).matches &&
            openRecordingParam() === null;
        writeOpenRecording(recording.id, fromPhoneList ? "push" : "replace");
    }, []);

    const backToList = useCallback(() => {
        if (window.history.state?.[LIST_BELOW] === true) back();
        else writeOpenRecording(null, "replace");
    }, [back]);

    useEffect(() => {
        if (!urlRecordingId) return;
        if (openRecordingParam() !== urlRecordingId) return;
        const found = visibleRecordings.find((r) => r.id === urlRecordingId);
        if (found) {
            setCurrentRecording((prev) =>
                prev?.id === found.id ? prev : found,
            );
        } else {
            writeOpenRecording(null, "replace");
        }
    }, [urlRecordingId, visibleRecordings]);

    useEffect(() => {
        if (openRecordingParam() === urlRecordingId) rememberLibraryLocation();
    }, [urlRecordingId]);

    // Keep currentRecording in sync with the recordings prop (updated
    // after refresh()). If the previously-selected recording is no
    // longer present (e.g. just deleted), clear the selection. With
    // nothing selected (first upload or first sync into an empty
    // library), select the newest recording.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return recordings[0] ?? null;
            const updated = recordings.find((r) => r.id === prev.id);
            return updated ?? null;
        });
        // When server data comes back, clear any optimistic hides whose
        // rows no longer exist server-side (deletion confirmed).
        setHiddenIds((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set<string>();
            const ids = new Set(recordings.map((r) => r.id));
            for (const id of prev) {
                if (ids.has(id)) next.add(id); // still present -> keep hidden until confirmed
            }
            return next.size === prev.size ? prev : next;
        });
        setFilenameOverrides((prev) =>
            reconcileFilenameOverrides(recordings, prev),
        );
    }, [recordings]);

    const {
        isAutoSyncing,
        lastSyncTime,
        nextSyncTime,
        lastSyncResult,
        manualSync,
    } = useAutoSync({
        interval: initialSettings.syncInterval ?? SYNC_CONFIG.defaultInterval,
        minInterval: SYNC_CONFIG.minInterval,
        syncOnMount: initialSettings.syncOnMount,
        syncOnVisibilityChange: initialSettings.syncOnVisibilityChange,
        enabled: initialSettings.autoSyncEnabled && hasPlaudConnection,
        onSuccess: (newRecordings) => {
            if (initialSettings.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                    chimeNewRecordings();
                } else {
                    toast.success("No new recordings");
                }
            }
            if (initialSettings.browserNotifications) {
                (async () => {
                    const granted = await requestNotificationPermission();
                    if (!granted) return;
                    if (newRecordings > 0) {
                        showNewRecordingNotification(newRecordings);
                    } else {
                        showSyncCompleteNotification();
                    }
                })();
            }
        },
        onError: (error) => {
            toast.error(error);
        },
    });

    const handleSync = useCallback(async () => {
        if (!hasPlaudConnection) return;
        await manualSync();
    }, [manualSync, hasPlaudConnection]);

    // Prefer the live sync result once we have one; fall back to the
    // server-rendered flag on first paint (before any sync runs). A
    // change in `plaudNeedsReconnect` only happens when fresh server
    // truth arrives (e.g. a `router.refresh()` after another tab's sync
    // invalidated the token), so it always resets the override rather
    // than letting a stale client-side result keep masking it.
    const [reconnectOverride, setReconnectOverride] = useState<boolean | null>(
        null,
    );
    const prevPlaudNeedsReconnect = useRef(plaudNeedsReconnect);
    useEffect(() => {
        if (plaudNeedsReconnect !== prevPlaudNeedsReconnect.current) {
            prevPlaudNeedsReconnect.current = plaudNeedsReconnect;
            setReconnectOverride(null);
        }
    }, [plaudNeedsReconnect]);
    useEffect(() => {
        // Only Plaud rejecting the token raises the banner, and only a
        // sync that succeeded clears it: a sync that failed for another
        // reason (network, upstream) says nothing about the connection.
        if (lastSyncResult?.needsReconnect === true) {
            setReconnectOverride(true);
        } else if (lastSyncResult?.success === true) {
            setReconnectOverride(false);
        }
    }, [lastSyncResult]);
    const showReconnect = reconnectOverride ?? plaudNeedsReconnect;

    const handleReconnected = useCallback(() => {
        setHasPlaudConnection(true);
        setReconnectOverride(false);
        refresh();
        manualSync();
    }, [refresh, manualSync]);

    const snapshotList = useCallback(() => {
        listRef.current?.snapshotLayout();
    }, []);

    const [uploadBaselines, setUploadBaselines] = useState<
        ReadonlyMap<string, ReadonlySet<string>>
    >(() => new Map());
    const recordingsRef = useRef(recordings);
    useEffect(() => {
        recordingsRef.current = recordings;
    }, [recordings]);

    const {
        isUploading,
        pendingUploads,
        settleUpload,
        uploadInputRef,
        handleUpload,
        uploadFile,
        triggerUpload,
    } = useUploadQueue({
        onUploadComplete: (upload: PendingUpload) => {
            const known = new Set(recordingsRef.current.map((r) => r.id));
            setUploadBaselines((prev) => new Map(prev).set(upload.id, known));
            refresh();
            window.setTimeout(() => {
                settleUpload(upload.id);
                setUploadBaselines((prev) => {
                    if (!prev.has(upload.id)) return prev;
                    const next = new Map(prev);
                    next.delete(upload.id);
                    return next;
                });
            }, UPLOAD_SETTLE_MS);
        },
        onBeforeListChange: snapshotList,
    });

    const uploadArrivals = useMemo(
        () =>
            matchUploadedRecordings(
                pendingUploads,
                uploadBaselines,
                recordings,
            ),
        [pendingUploads, uploadBaselines, recordings],
    );

    const shownPendingUploads = useMemo(
        () => pendingUploads.filter((p) => !uploadArrivals.has(p.id)),
        [pendingUploads, uploadArrivals],
    );

    useEffect(() => {
        if (uploadArrivals.size === 0) return;
        for (const [pendingId, recording] of uploadArrivals) {
            const upload = pendingUploads.find((p) => p.id === pendingId);
            settleUpload(pendingId);
            if (!upload || lastPickAt.current > upload.startedAt) continue;
            if (window.matchMedia(DESKTOP_QUERY).matches) {
                selectRecording(recording);
            } else {
                setCurrentRecording(recording);
            }
        }
        setUploadBaselines((prev) => {
            const next = new Map(prev);
            for (const id of uploadArrivals.keys()) next.delete(id);
            return next;
        });
    }, [uploadArrivals, pendingUploads, settleUpload, selectRecording]);

    const { inFlightActions, transcribeById } = useTranscribeQueue({
        onTranscribeComplete: refresh,
    });

    // Any transcribe in flight (across all recordings) blocks new
    // uploads. The previous `isTranscribing` boolean conflated "this
    // recording is being transcribed" with "some transcribe is
    // happening"; splitting them fixes a concurrency bug where two
    // pending transcribes would race each other's finally clauses.
    const anyTranscribing = Array.from(inFlightActions.values()).some(
        (kind) => kind === "transcribing",
    );
    const isCurrentTranscribing =
        currentRecording !== null &&
        inFlightActions.get(currentRecording.id) === "transcribing";
    const isProcessing = anyTranscribing || isUploading;

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;
        await transcribeById(currentRecording.id);
    }, [currentRecording, transcribeById]);

    // One browser transcription runner and one summary-style list, shared
    // by the reader and every row menu.
    const browserTranscription = useBrowserTranscription({
        onComplete: refresh,
    });
    const summaryPrompts = useSummaryPrompts();
    const [summarizingIds, setSummarizingIds] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const [viewRequest, setViewRequest] = useState<RecordingViewRequest | null>(
        null,
    );
    const viewRequestKey = useRef(0);

    // Row actions that happen in the reader (rename in the title, summary
    // progress and errors in Overview) open the recording first.
    const openAndRequest = useCallback(
        (
            recording: Recording,
            action: RecordingViewRequest["action"],
            promptId?: string,
        ) => {
            viewRequestKey.current += 1;
            selectRecording(recording);
            setViewRequest({
                recordingId: recording.id,
                action,
                promptId,
                key: viewRequestKey.current,
            });
        },
        [selectRecording],
    );

    const serverTranscription =
        transcriptionProviderStateFor(providers) !== "missing";

    const rowActions = useMemo<RecordingRowActions>(
        () => ({
            browser: browserTranscription,
            summaryPrompts,
            summarizingIds,
            serverTranscription,
            onRename: (r) => openAndRequest(r, "rename"),
            onTranscribe: (r) => void transcribeById(r.id),
            onSummarize: (r, promptId) =>
                openAndRequest(r, "summarize", promptId),
            onDeleteSummary: (r) => openAndRequest(r, "delete-summary"),
        }),
        [
            browserTranscription,
            summaryPrompts,
            summarizingIds,
            serverTranscription,
            openAndRequest,
            transcribeById,
        ],
    );

    const handleDelete = useCallback(
        async (recording: Recording) => {
            const id = recording.id;
            snapshotList();
            setHiddenIds((prev) => new Set(prev).add(id));
            const wasCurrent = currentRecording?.id === id;
            const wasOpen = openRecordingParam() === id;
            if (wasCurrent) {
                const idx = visibleRecordings.findIndex((r) => r.id === id);
                const next =
                    visibleRecordings[idx + 1] ??
                    visibleRecordings[idx - 1] ??
                    null;
                setCurrentRecording(next);
                if (wasOpen) writeOpenRecording(next?.id ?? null, "replace");
            }
            try {
                const res = await fetch(`/api/recordings/${id}`, {
                    method: "DELETE",
                });
                if (!res.ok) throw new Error("Delete failed");
                if (posthog.__loaded) {
                    posthog.capture("recording_deleted");
                }
                toast.success("Recording deleted");
                refresh();
            } catch (err) {
                snapshotList();
                setHiddenIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
                if (wasCurrent) {
                    setCurrentRecording(recording);
                    if (wasOpen) writeOpenRecording(id, "replace");
                }
                throw err;
            }
        },
        [currentRecording, visibleRecordings, refresh, snapshotList],
    );

    const handleRenamed = useCallback(
        (filename: string) => {
            const id = currentRecording?.id;
            if (!id) return;
            setFilenameOverrides((prev) => new Map(prev).set(id, filename));
            refresh();
        },
        [currentRecording?.id, refresh],
    );

    // Keyboard shortcuts (global). Disabled while any modal is open
    // so the modal owns keyboard focus exclusively. The shortcuts
    // dialog itself uses these very keys to navigate its rows.
    useListKeyboardNav({
        onNext: () => listRef.current?.next(),
        onPrev: () => listRef.current?.prev(),
        onFocusSearch: () => {
            if (window.matchMedia(DESKTOP_QUERY).matches) {
                sidebarSearchRef.current?.focus();
            } else {
                listRef.current?.focusSearch();
            }
        },
        onOpenPalette: () => setPaletteOpen(true),
        onOpenShortcuts: () => setShortcutsOpen(true),
        onOpenSettings: openSettings,
        enabled: !paletteOpen && !shortcutsOpen,
    });

    const isEmpty =
        visibleRecordings.length === 0 && shownPendingUploads.length === 0;
    const reconnectBanner = (
        <PlaudReconnectBanner
            show={showReconnect}
            sessionExpiresAt={plaudSessionExpiresAt}
            onReconnected={handleReconnected}
        />
    );

    return (
        <>
            <input
                ref={uploadInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleUpload}
            />
            <div className="bg-background lg:flex lg:h-dvh">
                <LibrarySidebar
                    className="hidden lg:flex"
                    recordingCount={visibleRecordings.length}
                    devices={devices}
                    plaudNeedsReconnect={showReconnect}
                    query={query}
                    onQueryChange={setQuery}
                    onEnterSelectFirst={() => listRef.current?.selectFirst()}
                    searchRef={sidebarSearchRef}
                    onShowLibrary={() => {
                        setQuery("");
                        setFilter("all");
                    }}
                    isAdmin={isAdmin}
                    userEmail={userEmail}
                    userName={userName}
                    isHosted={isHosted}
                    onOpenSettings={openSettings}
                    onSettingsIntent={prefetchSettings}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                />
                <div className="mx-auto max-w-7xl px-4 pb-6 max-lg:container lg:flex lg:min-w-0 lg:max-w-none lg:flex-1 lg:flex-col lg:p-0">
                    <WorkstationHeader
                        className="mb-1 lg:hidden"
                        showSync={hasPlaudConnection}
                        needsReconnect={showReconnect}
                        lastSyncTime={lastSyncTime}
                        lastSuccessfulSyncTime={
                            plaudLastSyncAt ? new Date(plaudLastSyncAt) : null
                        }
                        isAutoSyncing={isAutoSyncing}
                        lastSyncResult={lastSyncResult}
                        onSync={handleSync}
                        isUploading={isUploading}
                        isProcessing={isProcessing}
                        onTriggerUpload={triggerUpload}
                        drawer={{
                            recordingCount: visibleRecordings.length,
                            devices,
                            plaudNeedsReconnect: showReconnect,
                            onSearch: isEmpty
                                ? undefined
                                : () => listRef.current?.focusSearch(),
                            onShowLibrary: () => {
                                setQuery("");
                                setFilter("all");
                            },
                            onOpenSettings: openSettings,
                            onSettingsIntent: prefetchSettings,
                            onOpenShortcuts: () => setShortcutsOpen(true),
                            isAdmin,
                            isHosted,
                            userEmail,
                            userName,
                        }}
                        inert={phoneReaderOpen}
                    />

                    <div
                        inert={phoneReaderOpen}
                        className="empty:hidden lg:px-6 lg:pt-4"
                    >
                        <TrialBanner isHosted={isHosted} />
                    </div>

                    {isEmpty ? (
                        <div className="lg:flex-1 lg:overflow-y-auto lg:p-8">
                            {reconnectBanner}
                            <WorkstationEmptyState
                                hasPlaudConnection={hasPlaudConnection}
                                isSyncing={isAutoSyncing}
                                autoSyncEnabled={
                                    initialSettings.autoSyncEnabled
                                }
                                isUploading={isUploading}
                                onSync={handleSync}
                                onUpload={triggerUpload}
                                onDropFile={uploadFile}
                                onPlaudConnected={handleReconnected}
                                providers={providers}
                                onRequestProviders={prefetchProviders}
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:flex lg:min-h-0 lg:flex-1 lg:gap-0">
                            {/*
                              Below lg the reader covers the list. The list
                              stays laid out (`invisible`, not `hidden`) so
                              the page keeps its scroll position for Back.
                            */}
                            <div
                                inert={phoneReaderOpen}
                                className={cn(
                                    "lg:flex lg:w-93 lg:shrink-0 lg:flex-col lg:border-r lg:border-border",
                                    readerOpen && "max-lg:invisible",
                                )}
                            >
                                <RecordingList
                                    ref={listRef}
                                    recordings={visibleRecordings}
                                    transcriptions={transcriptions}
                                    currentRecording={currentRecording}
                                    pendingUploads={shownPendingUploads}
                                    inFlightActions={inFlightActions}
                                    deviceNames={deviceNames}
                                    query={query}
                                    onQueryChange={setQuery}
                                    filter={filter}
                                    onFilterChange={setFilter}
                                    banner={reconnectBanner}
                                    headerActions={
                                        <div className="flex items-center gap-1">
                                            {hasPlaudConnection ? (
                                                <SyncStatus
                                                    lastSyncTime={lastSyncTime}
                                                    nextSyncTime={nextSyncTime}
                                                    isAutoSyncing={
                                                        isAutoSyncing
                                                    }
                                                    lastSyncResult={
                                                        lastSyncResult
                                                    }
                                                    onSync={handleSync}
                                                    needsReconnect={
                                                        showReconnect
                                                    }
                                                    lastSuccessfulSyncTime={
                                                        plaudLastSyncAt
                                                            ? new Date(
                                                                  plaudLastSyncAt,
                                                              )
                                                            : null
                                                    }
                                                />
                                            ) : null}
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-compact"
                                                        onClick={triggerUpload}
                                                        disabled={isProcessing}
                                                        aria-label={
                                                            isUploading
                                                                ? "Uploading audio"
                                                                : "Upload audio"
                                                        }
                                                        className="text-foreground"
                                                    >
                                                        <Upload className="size-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">
                                                    Upload an audio file from
                                                    your computer
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    }
                                    onSelect={selectRecording}
                                    onDelete={handleDelete}
                                    rowActions={rowActions}
                                    initialDateTimeFormat={
                                        initialSettings.dateTimeFormat
                                    }
                                    initialSortOrder={
                                        initialSettings.recordingListSortOrder
                                    }
                                    initialDensity={initialSettings.listDensity}
                                    initialChunkSize={
                                        initialSettings.itemsPerPage
                                    }
                                />
                            </div>

                            <WorkstationDetailPane
                                currentRecording={selectedRecording}
                                currentTranscription={currentTranscription}
                                deviceName={
                                    selectedRecording
                                        ? (deviceNames.get(
                                              selectedRecording.deviceSn,
                                          ) ?? null)
                                        : null
                                }
                                isCurrentTranscribing={isCurrentTranscribing}
                                visibleRecordings={visibleRecordings}
                                onTranscribe={handleTranscribe}
                                onTranscribeComplete={refresh}
                                onSelectRecording={selectRecording}
                                onRenamed={handleRenamed}
                                onDelete={handleDelete}
                                onBackToList={backToList}
                                hiddenOnMobile={!readerOpen}
                                providers={providers}
                                onRequestProviders={prefetchProviders}
                                initialPlaybackSpeed={
                                    initialSettings.defaultPlaybackSpeed
                                }
                                initialVolume={initialSettings.defaultVolume}
                                initialAutoPlayNext={
                                    initialSettings.autoPlayNext
                                }
                                scrubberStyle={initialSettings.playerScrubber}
                                browser={browserTranscription}
                                summaryPrompts={summaryPrompts}
                                request={viewRequest}
                                onSummaryChange={refresh}
                                onSummarizingChange={setSummarizingIds}
                            />
                        </div>
                    )}
                </div>
            </div>

            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                recordings={visibleRecordings}
                transcriptions={transcriptions}
                currentRecording={currentRecording}
                inFlightActions={inFlightActions}
                currentTheme={theme}
                dateTimeFormat={initialSettings.dateTimeFormat}
                onSelectRecording={selectRecording}
                onSync={hasPlaudConnection ? handleSync : undefined}
                onUpload={triggerUpload}
                onOpenSettings={openSettings}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onSetTheme={setTheme}
                onTranscribeRecording={
                    serverTranscription ? transcribeById : undefined
                }
            />

            <ShortcutsDialog
                open={shortcutsOpen}
                onOpenChange={setShortcutsOpen}
            />
        </>
    );
}

/** The one-time greeting after sign-up: "Welcome to Riffado, Maya". */
export function welcomeMessage(userName: string | null): string {
    const firstName = userName?.trim().split(/\s+/)[0];
    return firstName
        ? `Welcome to Riffado, ${firstName}`
        : "Welcome to Riffado";
}
