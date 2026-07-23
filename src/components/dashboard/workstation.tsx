"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { FiletagDialog } from "@/components/dashboard/filetag-dialog";
import {
    type FiletagFilter,
    FiletagRail,
} from "@/components/dashboard/filetag-rail";
import { PlaudReconnectBanner } from "@/components/dashboard/plaud-reconnect-banner";
import {
    RecordingList,
    type RecordingListHandle,
} from "@/components/dashboard/recording-list";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { WorkstationDetailPane } from "@/components/dashboard/workstation-detail-pane";
import { WorkstationEmptyState } from "@/components/dashboard/workstation-empty-state";
import { WorkstationHeader } from "@/components/dashboard/workstation-header";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useTheme } from "@/hooks/use-theme";
import { useTranscribeQueue } from "@/hooks/use-transcribe-queue";
import { useUploadQueue } from "@/hooks/use-upload-queue";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import type { InitialSettings } from "@/lib/settings/initial-settings";
import { SYNC_CONFIG } from "@/lib/sync-config";
import { cn } from "@/lib/utils";
import type { Filetag } from "@/types/filetag";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
}

const EMPTY_PROVIDERS: Provider[] = [];

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    /** Plaud directories (filetags), decrypted server-side. */
    filetags: Filetag[];
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
    initialSettings: InitialSettings;
    /**
     * True when Plaud has rejected the stored token (connection row carries
     * an `invalidatedAt`). Seeds the reconnect banner on first paint; the
     * live sync result takes over once a sync runs. Server-supplied.
     */
    plaudNeedsReconnect: boolean;
    /**
     * True when running in Riffado's hosted mode (`IS_HOSTED=true`).
     * Forwarded into SettingsDialog so hosted-only UI gating reflects
     * the deployment mode. Server-supplied; never derive client-side.
     * Required (no default) so a future caller can't silently regress
     * hosted-mode behavior by forgetting to thread the value through.
     */
    isHosted: boolean;
}

/**
 * Top-level dashboard component. Composition root for the recording
 * list, the detail pane (player + transcription), and the five
 * modals (CommandPalette, ShortcutsDialog, SettingsDialog,
 * OnboardingDialog, FiletagDialog).
 *
 * State ownership is split:
 *  - selection / mobile master-detail toggle live here
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
    filetags,
    isAdmin = false,
    userEmail = null,
    initialSettings,
    plaudNeedsReconnect,
    isHosted,
}: WorkstationProps) {
    const { refresh } = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Auto-opens on first paint when the account hasn't finished
    // onboarding yet (server-supplied truth, re-evaluated on every fresh
    // navigation to this page). Everyone must finish onboarding --
    // `mandatory` below keeps it non-dismissible in that case.
    const [onboardingOpen, setOnboardingOpen] = useState(
        () => !initialSettings.onboardingCompleted,
    );
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
    // On <lg viewports the list and detail panes can't coexist -- we
    // toggle between them instead of stacking. Desktop ignores this
    // state entirely (both panes render via the grid).
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [providers, setProviders] = useState<Provider[]>(EMPTY_PROVIDERS);

    const { theme, setTheme } = useTheme(initialSettings.theme);
    const listRef = useRef<RecordingListHandle>(null);
    const confirm = useConfirm();

    // Filter out optimistically-hidden (deleted) rows.
    const visibleRecordings = useMemo(
        () => recordings.filter((r) => !hiddenIds.has(r.id)),
        [recordings, hiddenIds],
    );

    const [filetagFilter, setFiletagFilter] = useState<FiletagFilter>("all");
    const [filetagDialogOpen, setFiletagDialogOpen] = useState(false);
    const [editingFiletag, setEditingFiletag] = useState<Filetag | null>(null);

    const tagFilteredRecordings = useMemo(() => {
        if (filetagFilter === "all") return visibleRecordings;
        if (filetagFilter === "none") {
            return visibleRecordings.filter((r) => r.filetagId === null);
        }
        return visibleRecordings.filter((r) => r.filetagId === filetagFilter);
    }, [visibleRecordings, filetagFilter]);

    const filetagCounts = useMemo(() => {
        const byTag = new Map<string, number>();
        let unorganized = 0;
        for (const r of visibleRecordings) {
            if (r.filetagId === null) unorganized++;
            else byTag.set(r.filetagId, (byTag.get(r.filetagId) ?? 0) + 1);
        }
        return { total: visibleRecordings.length, unorganized, byTag };
    }, [visibleRecordings]);

    // If the active directory disappears (deleted here or in the official
    // app, confirmed by a refresh), fall back to "all".
    useEffect(() => {
        if (
            filetagFilter !== "all" &&
            filetagFilter !== "none" &&
            !filetags.some((tag) => tag.id === filetagFilter)
        ) {
            setFiletagFilter("all");
        }
    }, [filetags, filetagFilter]);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    const currentFiletag = useMemo(
        () =>
            currentRecording?.filetagId
                ? (filetags.find(
                      (tag) => tag.id === currentRecording.filetagId,
                  ) ?? null)
                : null,
        [currentRecording, filetags],
    );

    // Keep currentRecording in sync with the recordings prop (updated
    // after refresh()). If the previously-selected recording is no
    // longer present (e.g. just deleted), clear the selection.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return prev;
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
    }, [recordings]);

    // Keep the selection inside the active directory scope. When the
    // filter changes (or a move pushes the current recording out of
    // scope), fall back to the first visible recording so the detail
    // pane and auto-advance always operate on the filtered list.
    useEffect(() => {
        setCurrentRecording((prev) => {
            if (!prev) return prev;
            if (tagFilteredRecordings.some((r) => r.id === prev.id)) {
                return prev;
            }
            return tagFilteredRecordings[0] ?? null;
        });
    }, [tagFilteredRecordings]);

    // On mobile, an empty selection has no detail pane to show: go
    // back to the list.
    useEffect(() => {
        if (!currentRecording && mobileView === "detail") {
            setMobileView("list");
        }
    }, [currentRecording, mobileView]);

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
        enabled: initialSettings.autoSyncEnabled,
        onSuccess: (newRecordings) => {
            if (initialSettings.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                } else {
                    toast.success("Sync complete - no new recordings");
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
        await manualSync();
    }, [manualSync]);

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
        if (typeof lastSyncResult?.needsReconnect === "boolean") {
            setReconnectOverride(lastSyncResult.needsReconnect);
        }
    }, [lastSyncResult]);
    const showReconnect = reconnectOverride ?? plaudNeedsReconnect;

    const handleReconnected = useCallback(() => {
        refresh();
        manualSync();
    }, [refresh, manualSync]);

    // Settings dialog needs the provider list at open-time so the
    // Providers section seeds correctly. Fetching on open (rather
    // than on mount) avoids loading a list the user may never see.
    useEffect(() => {
        if (settingsOpen) {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => setProviders(data.providers || []))
                .catch(() => setProviders([]));
        }
    }, [settingsOpen]);

    const {
        isUploading,
        pendingUploads,
        uploadInputRef,
        handleUpload,
        triggerUpload,
    } = useUploadQueue({ onUploadComplete: refresh });

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

    const handleDelete = useCallback(
        async (recording: Recording) => {
            const id = recording.id;
            // Optimistic hide.
            setHiddenIds((prev) => new Set(prev).add(id));
            const wasCurrent = currentRecording?.id === id;
            if (wasCurrent) {
                const idx = visibleRecordings.findIndex((r) => r.id === id);
                const next =
                    visibleRecordings[idx + 1] ??
                    visibleRecordings[idx - 1] ??
                    null;
                setCurrentRecording(next);
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
                // Rollback
                setHiddenIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
                if (wasCurrent) setCurrentRecording(recording);
                throw err;
            }
        },
        [currentRecording, visibleRecordings, refresh],
    );

    const handleMoveToFiletag = useCallback(
        async (recording: Recording, filetagId: string | null) => {
            if (recording.filetagId === filetagId) return;
            try {
                const res = await fetch("/api/recordings/filetag", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        recordingIds: [recording.id],
                        filetagId,
                    }),
                });
                if (!res.ok) {
                    const data = (await res.json().catch(() => ({}))) as {
                        error?: string;
                    };
                    toast.error(data.error ?? "Failed to move recording");
                    return;
                }
                const target = filetagId
                    ? filetags.find((tag) => tag.id === filetagId)
                    : null;
                toast.success(
                    target
                        ? `Moved to ${target.name}`
                        : "Removed from directory",
                );
                refresh();
            } catch {
                toast.error("Failed to move recording");
            }
        },
        [filetags, refresh],
    );

    const openCreateFiletag = useCallback(() => {
        setEditingFiletag(null);
        setFiletagDialogOpen(true);
    }, []);

    const openEditFiletag = useCallback((tag: Filetag) => {
        setEditingFiletag(tag);
        setFiletagDialogOpen(true);
    }, []);

    const handleDeleteFiletag = useCallback(
        (tag: Filetag) => {
            void confirm({
                title: "Delete this directory?",
                description: (
                    <>
                        <span className="font-medium text-foreground">
                            {tag.name}
                        </span>
                        <br />
                        Its recordings are kept and become "No directory".
                        {!tag.isLocalOnly &&
                            " The directory is also deleted in the Plaud app."}
                    </>
                ),
                confirmLabel: "Delete",
                pendingLabel: "Deleting…",
                destructive: true,
                errorMessage: "Failed to delete directory",
                onConfirm: async () => {
                    const res = await fetch(`/api/filetags/${tag.id}`, {
                        method: "DELETE",
                    });
                    if (!res.ok) {
                        const data = (await res.json().catch(() => ({}))) as {
                            error?: string;
                        };
                        throw new Error(
                            data.error ?? "Failed to delete directory",
                        );
                    }
                    toast.success("Directory deleted");
                    refresh();
                },
            });
        },
        [confirm, refresh],
    );

    // Keyboard shortcuts (global). Disabled while any modal is open
    // so the modal owns keyboard focus exclusively. The shortcuts
    // dialog itself uses these very keys to navigate its rows.
    useListKeyboardNav({
        onNext: () => listRef.current?.next(),
        onPrev: () => listRef.current?.prev(),
        onFocusSearch: () => listRef.current?.focusSearch(),
        onOpenPalette: () => setPaletteOpen(true),
        onOpenShortcuts: () => setShortcutsOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
        enabled:
            !settingsOpen &&
            !onboardingOpen &&
            !paletteOpen &&
            !shortcutsOpen &&
            !filetagDialogOpen,
    });

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto max-w-7xl px-4 py-6">
                    <TrialBanner isHosted={isHosted} />
                    <WorkstationHeader
                        isAdmin={isAdmin}
                        userEmail={userEmail}
                        initialTheme={initialSettings.theme}
                        lastSyncTime={lastSyncTime}
                        nextSyncTime={nextSyncTime}
                        isAutoSyncing={isAutoSyncing}
                        lastSyncResult={lastSyncResult}
                        onSync={handleSync}
                        isUploading={isUploading}
                        isProcessing={isProcessing}
                        uploadInputRef={uploadInputRef}
                        onTriggerUpload={triggerUpload}
                        onUploadInputChange={handleUpload}
                        onOpenPalette={() => setPaletteOpen(true)}
                        onOpenSettings={() => setSettingsOpen(true)}
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                    />

                    <PlaudReconnectBanner
                        show={showReconnect}
                        onReconnected={handleReconnected}
                    />

                    {visibleRecordings.length === 0 &&
                    pendingUploads.length === 0 ? (
                        <WorkstationEmptyState
                            isSyncing={isAutoSyncing}
                            onSync={handleSync}
                            onUpload={triggerUpload}
                        />
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                            {/*
                              Mobile master/detail: on <lg, only one
                              pane renders at a time. `mobileView ===
                              "detail"` hides the list (via `hidden`)
                              while keeping its state mounted, so
                              scroll position, search query, and
                              selection survive the back-navigation.
                              The `lg:block` override brings the list
                              back on desktop where both panes coexist.
                            */}
                            <div
                                className={cn(
                                    "lg:col-span-1 lg:block",
                                    mobileView === "detail" && "hidden",
                                )}
                            >
                                <RecordingList
                                    ref={listRef}
                                    recordings={tagFilteredRecordings}
                                    transcriptions={transcriptions}
                                    currentRecording={currentRecording}
                                    pendingUploads={pendingUploads}
                                    inFlightActions={inFlightActions}
                                    filetags={filetags}
                                    railSlot={
                                        <FiletagRail
                                            filetags={filetags}
                                            counts={filetagCounts}
                                            activeFilter={filetagFilter}
                                            onFilterChange={setFiletagFilter}
                                            onCreate={openCreateFiletag}
                                            onEdit={openEditFiletag}
                                            onDelete={handleDeleteFiletag}
                                        />
                                    }
                                    onSelect={(r) => {
                                        setCurrentRecording(r);
                                        // Tapping a row on mobile
                                        // reveals the detail pane.
                                        // Desktop ignores this state.
                                        setMobileView("detail");
                                    }}
                                    onDelete={handleDelete}
                                    onMoveToFiletag={handleMoveToFiletag}
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
                                currentRecording={currentRecording}
                                currentTranscription={currentTranscription}
                                currentFiletag={currentFiletag}
                                isCurrentTranscribing={isCurrentTranscribing}
                                visibleRecordings={tagFilteredRecordings}
                                onTranscribe={handleTranscribe}
                                onTranscribeComplete={refresh}
                                onSelectRecording={setCurrentRecording}
                                onBackToList={() => setMobileView("list")}
                                hiddenOnMobile={mobileView === "list"}
                                initialPlaybackSpeed={
                                    initialSettings.defaultPlaybackSpeed
                                }
                                initialVolume={initialSettings.defaultVolume}
                                initialAutoPlayNext={
                                    initialSettings.autoPlayNext
                                }
                                scrubberStyle={initialSettings.playerScrubber}
                            />
                        </div>
                    )}
                </div>
            </div>

            <CommandPalette
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                recordings={tagFilteredRecordings}
                transcriptions={transcriptions}
                currentRecording={currentRecording}
                inFlightActions={inFlightActions}
                currentTheme={theme}
                dateTimeFormat={initialSettings.dateTimeFormat}
                onSelectRecording={(r) => {
                    setCurrentRecording(r);
                    setMobileView("detail");
                }}
                onSync={handleSync}
                onUpload={triggerUpload}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onSetTheme={setTheme}
                onTranscribeRecording={transcribeById}
            />

            <FiletagDialog
                open={filetagDialogOpen}
                onOpenChange={setFiletagDialogOpen}
                editing={editingFiletag}
                onSaved={refresh}
            />

            <ShortcutsDialog
                open={shortcutsOpen}
                onOpenChange={setShortcutsOpen}
            />

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                initialProviders={providers}
                isHosted={isHosted}
                onReRunOnboarding={() => {
                    setSettingsOpen(false);
                    setOnboardingOpen(true);
                }}
                onPlaudReconnected={handleReconnected}
            />

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    refresh();
                }}
                mandatory={!initialSettings.onboardingCompleted}
            />
        </>
    );
}
