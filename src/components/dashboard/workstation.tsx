"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { LibrarySidebar } from "@/components/dashboard/library-sidebar";
import { PlaudReconnectBanner } from "@/components/dashboard/plaud-reconnect-banner";
import {
    type LibraryFilter,
    RecordingList,
    type RecordingListHandle,
} from "@/components/dashboard/recording-list";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import {
    type TranscriptionData,
    WorkstationDetailPane,
} from "@/components/dashboard/workstation-detail-pane";
import { WorkstationEmptyState } from "@/components/dashboard/workstation-empty-state";
import { WorkstationHeader } from "@/components/dashboard/workstation-header";
import { OnboardingDialog } from "@/components/onboarding-dialog";
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
import { useTheme } from "@/hooks/use-theme";
import { useTranscribeQueue } from "@/hooks/use-transcribe-queue";
import { useUploadQueue } from "@/hooks/use-upload-queue";
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
 * list, the detail pane (player + transcription), and the three
 * modals (CommandPalette, ShortcutsDialog, OnboardingDialog). Settings
 * is a separate page (`/settings`).
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
    const { refresh, push, prefetch } = useRouter();
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
        recordings.length > 0 ? recordings[0] : null,
    );
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
    const [filenameOverrides, setFilenameOverrides] = useState<
        Map<string, string>
    >(() => new Map());
    // On <lg viewports the list and detail panes can't coexist -- we
    // toggle between them instead of stacking. Desktop ignores this
    // state entirely (both panes render via the grid).
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<LibraryFilter>("all");
    const sidebarSearchRef = useRef<HTMLInputElement>(null);
    const deviceNames = useMemo(
        () => new Map(devices.map((d) => [d.serialNumber, d.name || d.model])),
        [devices],
    );
    const { providers, prefetch: prefetchProviders } = useProviderList();

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

    const {
        isUploading,
        pendingUploads,
        uploadInputRef,
        handleUpload,
        uploadFile,
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
            if (window.matchMedia("(min-width: 64rem)").matches) {
                sidebarSearchRef.current?.focus();
            } else {
                listRef.current?.focusSearch();
            }
        },
        onOpenPalette: () => setPaletteOpen(true),
        onOpenShortcuts: () => setShortcutsOpen(true),
        onOpenSettings: openSettings,
        enabled: !onboardingOpen && !paletteOpen && !shortcutsOpen,
    });

    const isEmpty =
        visibleRecordings.length === 0 && pendingUploads.length === 0;
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
                    initialTheme={initialSettings.theme}
                    onOpenSettings={openSettings}
                    onSettingsIntent={prefetchSettings}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                />
                <div className="mx-auto max-w-7xl px-4 py-6 max-lg:container lg:flex lg:min-w-0 lg:max-w-none lg:flex-1 lg:flex-col lg:p-0">
                    <WorkstationHeader
                        className="lg:hidden"
                        isAdmin={isAdmin}
                        userEmail={userEmail}
                        initialTheme={initialSettings.theme}
                        lastSyncTime={lastSyncTime}
                        nextSyncTime={nextSyncTime}
                        isAutoSyncing={isAutoSyncing}
                        lastSyncResult={lastSyncResult}
                        onSync={handleSync}
                        showSync={hasPlaudConnection}
                        isUploading={isUploading}
                        isProcessing={isProcessing}
                        onTriggerUpload={triggerUpload}
                        onOpenPalette={() => setPaletteOpen(true)}
                        onOpenSettings={openSettings}
                        onSettingsIntent={prefetchSettings}
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                    />

                    <div className="empty:hidden lg:px-6 lg:pt-4">
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
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:flex lg:min-h-0 lg:flex-1 lg:gap-0">
                            {/*
                              Mobile master/detail: on <lg, only one
                              pane renders at a time. `mobileView ===
                              "detail"` hides the list (via `hidden`)
                              while keeping its state mounted, so
                              scroll position, search query, and
                              selection survive the back-navigation.
                              The `lg:flex` override brings the list
                              back on desktop where both panes coexist.
                            */}
                            <div
                                className={cn(
                                    "lg:flex lg:w-93 lg:shrink-0 lg:flex-col lg:border-r lg:border-border",
                                    mobileView === "detail" && "hidden",
                                )}
                            >
                                <RecordingList
                                    ref={listRef}
                                    recordings={visibleRecordings}
                                    transcriptions={transcriptions}
                                    currentRecording={currentRecording}
                                    pendingUploads={pendingUploads}
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
                                    onSelect={(r) => {
                                        setCurrentRecording(r);
                                        // Tapping a row on mobile
                                        // reveals the detail pane.
                                        // Desktop ignores this state.
                                        setMobileView("detail");
                                    }}
                                    onDelete={handleDelete}
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
                                onSelectRecording={setCurrentRecording}
                                onRenamed={handleRenamed}
                                onDelete={handleDelete}
                                onBackToList={() => setMobileView("list")}
                                hiddenOnMobile={mobileView === "list"}
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
                onSelectRecording={(r) => {
                    setCurrentRecording(r);
                    setMobileView("detail");
                }}
                onSync={hasPlaudConnection ? handleSync : undefined}
                onUpload={triggerUpload}
                onOpenSettings={openSettings}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onSetTheme={setTheme}
                onTranscribeRecording={transcribeById}
            />

            <ShortcutsDialog
                open={shortcutsOpen}
                onOpenChange={setShortcutsOpen}
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
