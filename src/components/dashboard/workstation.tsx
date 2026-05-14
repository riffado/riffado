"use client";

import { ArrowLeft, Command, Mic, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/dashboard/command-palette";
import {
    type PendingUpload,
    RecordingList,
    type RecordingListHandle,
} from "@/components/dashboard/recording-list";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { UserMenu } from "@/components/dashboard/user-menu";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SyncButton } from "@/components/sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useListKeyboardNav } from "@/hooks/use-list-keyboard-nav";
import { useTheme } from "@/hooks/use-theme";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import type { InitialSettings } from "@/lib/settings/initial-settings";
import { SYNC_CONFIG } from "@/lib/sync-config";
import { cn } from "@/lib/utils";
import type { Recording } from "@/types/recording";

interface TranscriptionData {
    text?: string;
    language?: string;
}

// InitialSettings + its defaults live in
// `src/lib/settings/initial-settings.ts` so server pages and the
// client component agree on shape and fallback values.

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    /**
     * When true, an admin shortcut appears in the avatar menu. Set by the
     * server-rendered page based on env.ADMIN_EMAILS membership; never
     * trusted client-side — the actual /admin gate runs server-side.
     */
    isAdmin?: boolean;
    /**
     * Logged-in user's email. Passed down to the avatar menu for the
     * identity block. Server-supplied — never derive from any client
     * state, which would risk a stale or attacker-influenced value.
     */
    userEmail?: string | null;
    initialSettings: InitialSettings;
    /**
     * True when running in OpenPlaud's hosted mode (`IS_HOSTED=true`).
     * Forwarded into SettingsDialog so hosted-only UI gating (e.g. the
     * self-host-only storage backend card) reflects the deployment mode.
     * Server-supplied; never derive client-side. Required (no default)
     * so a future caller can't silently regress hosted-mode behavior
     * by forgetting to thread the value through.
     */
    isHosted: boolean;
}

export function Workstation({
    recordings,
    transcriptions,
    isAdmin = false,
    userEmail = null,
    initialSettings,
    isHosted,
}: WorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    // No standalone `isTranscribing` boolean: that races when two
    // transcribes run concurrently (each request's `finally` would
    // flip it back to false while another was still pending). The
    // per-id `inFlightActions` map below is the source of truth;
    // `isCurrentTranscribing` / `anyTranscribing` are derived from it.
    const [isUploading, setIsUploading] = useState(false);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
    const [inFlightActions, setInFlightActions] = useState<
        Map<string, "transcribing" | "summarizing">
    >(new Map());
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
    // On <lg viewports the list and detail panes can't coexist — we
    // toggle between them instead of stacking. Desktop ignores this
    // state entirely (both panes render via the grid).
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [providers, setProviders] = useState<
        Array<{
            id: string;
            provider: string;
            baseUrl: string | null;
            defaultModel: string | null;
            isDefaultTranscription: boolean;
            isDefaultEnhancement: boolean;
            createdAt: Date;
        }>
    >([]);

    const { theme, setTheme } = useTheme(initialSettings.theme);

    const listRef = useRef<RecordingListHandle>(null);

    // Filter out optimistically-hidden (deleted) rows.
    const visibleRecordings = useMemo(
        () => recordings.filter((r) => !hiddenIds.has(r.id)),
        [recordings, hiddenIds],
    );

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    // Any transcribe in flight (across all recordings) blocks new
    // uploads. The previous `isTranscribing` boolean conflated "this
    // recording is being transcribed" with "some transcribe is
    // happening"; splitting them out fixes the concurrency bug.
    const anyTranscribing = Array.from(inFlightActions.values()).some(
        (kind) => kind === "transcribing",
    );
    const isCurrentTranscribing =
        currentRecording !== null &&
        inFlightActions.get(currentRecording.id) === "transcribing";
    const isProcessing = anyTranscribing || isUploading;

    // Keep currentRecording in sync with the recordings prop (updated
    // after router.refresh()). If the previously-selected recording is no
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
                if (ids.has(id)) next.add(id); // still present → keep hidden until confirmed
            }
            return next.size === prev.size ? prev : next;
        });
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

    useEffect(() => {
        if (settingsOpen) {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => setProviders(data.providers || []))
                .catch(() => setProviders([]));
        }
    }, [settingsOpen]);

    const markAction = useCallback(
        (id: string, kind: "transcribing" | "summarizing" | null) => {
            setInFlightActions((prev) => {
                const next = new Map(prev);
                if (kind === null) next.delete(id);
                else next.set(id, kind);
                return next;
            });
        },
        [],
    );

    // Trigger transcription for a specific recording id. Used by:
    //   - the per-recording "Transcribe" button in TranscriptionPanel
    //     (via `handleTranscribe`, which always targets the currently
    //     selected recording for backwards compatibility), and
    //   - the command palette's per-row "Transcribe X" quick actions,
    //     which need to dispatch against an arbitrary recording without
    //     having to first change the selection.
    const transcribeById = useCallback(
        async (id: string) => {
            markAction(id, "transcribing");
            try {
                const response = await fetch(
                    `/api/recordings/${id}/transcribe`,
                    { method: "POST" },
                );
                if (response.ok) {
                    toast.success("Transcription complete");
                    router.refresh();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Transcription failed");
                }
            } catch {
                toast.error("Failed to transcribe recording");
            } finally {
                // Per-id clear only — don't touch any global "is
                // transcribing" flag (there isn't one), so a concurrent
                // transcribe on a different recording keeps its own
                // marker intact.
                markAction(id, null);
            }
        },
        [router, markAction],
    );

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;
        await transcribeById(currentRecording.id);
    }, [currentRecording, transcribeById]);

    const handleUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            e.target.value = "";

            // Optimistic placeholder in the list.
            const placeholderId = `pending:${Date.now()}:${Math.random()
                .toString(36)
                .slice(2)}`;
            setPendingUploads((prev) => [
                ...prev,
                {
                    id: placeholderId,
                    filename: file.name,
                    filesize: file.size,
                },
            ]);

            setIsUploading(true);
            try {
                const formData = new FormData();
                formData.append("file", file);
                const response = await fetch("/api/recordings/upload", {
                    method: "POST",
                    body: formData,
                });
                if (response.ok) {
                    const data = await response.json();
                    toast.success(`"${data.filename}" uploaded`);
                    router.refresh();
                } else {
                    const error = await response.json();
                    toast.error(error.error || "Upload failed");
                }
            } catch {
                toast.error("Failed to upload recording");
            } finally {
                setIsUploading(false);
                setPendingUploads((prev) =>
                    prev.filter((p) => p.id !== placeholderId),
                );
            }
        },
        [router],
    );

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
                toast.success("Recording deleted");
                router.refresh();
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
        [currentRecording, visibleRecordings, router],
    );

    const triggerUpload = useCallback(() => {
        uploadInputRef.current?.click();
    }, []);

    // Keyboard shortcuts (global).
    useListKeyboardNav({
        onNext: () => listRef.current?.next(),
        onPrev: () => listRef.current?.prev(),
        onFocusSearch: () => listRef.current?.focusSearch(),
        onOpenPalette: () => setPaletteOpen(true),
        onOpenShortcuts: () => setShortcutsOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
        // Disable global j/k/?/,/Enter etc. while any modal is open
        // so the modal owns keyboard focus exclusively. The shortcuts
        // dialog itself uses these very keys to navigate its rows.
        enabled:
            !settingsOpen && !onboardingOpen && !paletteOpen && !shortcutsOpen,
    });

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto max-w-7xl px-4 py-6">
                    {/*
                      Header: title on the left, actions on the right,
                      always one row. On mobile the title shrinks and the
                      buttons collapse to icon-only (see the per-button
                      `sm:` overrides below), so the whole bar fits in
                      ~360px. `min-w-0` on the title block lets it
                      truncate before pushing buttons off-screen.
                    */}
                    <div className="sticky top-0 z-30 -mx-4 mb-6 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
                        <div className="flex min-w-0 items-baseline gap-3">
                            <h1 className="truncate text-xl font-bold leading-tight sm:text-2xl md:text-3xl">
                                Recordings
                            </h1>
                            {/*
                              Recording count lives in the list pane's own
                              meta row ("N of N recordings") — showing it
                              again in the page header is duplicative on
                              every breakpoint, so the count is gone here.
                            */}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => setPaletteOpen(true)}
                                        variant="outline"
                                        size="sm"
                                        className="hidden h-9 md:inline-flex"
                                        aria-label="Open command palette"
                                    >
                                        <Command className="mr-2 size-4" />
                                        <span>Search</span>
                                        <kbd className="ml-2 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
                                            ⌘K
                                        </kbd>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    Search recordings, transcripts, and actions
                                </TooltipContent>
                            </Tooltip>
                            {/*
                              Sync button is status-aware: its label is
                              the last-sync relative time, so the user
                              sees "Synced 2m ago" / "Retry sync" /
                              "Syncing…" without a separate status
                              block. Tooltip carries next-sync ETA and
                              error detail.
                            */}
                            <SyncButton
                                lastSyncTime={lastSyncTime}
                                nextSyncTime={nextSyncTime}
                                isAutoSyncing={isAutoSyncing}
                                lastSyncResult={lastSyncResult}
                                onSync={handleSync}
                            />
                            <input
                                ref={uploadInputRef}
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={handleUpload}
                            />
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={triggerUpload}
                                        disabled={isProcessing}
                                        variant="outline"
                                        size="sm"
                                        className="h-9"
                                        aria-label={
                                            isUploading
                                                ? "Uploading audio"
                                                : "Upload audio"
                                        }
                                    >
                                        <Upload className="size-4 sm:mr-2" />
                                        <span className="hidden sm:inline">
                                            {isUploading
                                                ? "Uploading…"
                                                : "Upload Audio"}
                                        </span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    Upload an audio file from your computer
                                </TooltipContent>
                            </Tooltip>
                            <UserMenu
                                isAdmin={isAdmin}
                                initialTheme={initialSettings.theme}
                                userEmail={userEmail}
                                onOpenSettings={() => setSettingsOpen(true)}
                                onOpenShortcuts={() => setShortcutsOpen(true)}
                            />
                        </div>
                    </div>

                    {visibleRecordings.length === 0 &&
                    pendingUploads.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="mb-4 size-16 text-muted-foreground" />
                                <h3 className="mb-2 text-lg font-semibold">
                                    No recordings yet
                                </h3>
                                <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
                                    Sync your Plaud device to import your
                                    recordings and start transcribing them.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleSync}
                                        disabled={isAutoSyncing}
                                    >
                                        {isAutoSyncing ? (
                                            <>
                                                <RefreshCw className="mr-2 size-4 animate-spin" />
                                                Syncing…
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="mr-2 size-4" />
                                                Sync Device
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={triggerUpload}
                                    >
                                        <Upload className="mr-2 size-4" />
                                        Upload Audio
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                            {/*
                              Mobile master/detail: on <lg, only one pane
                              renders at a time. `mobileView === "detail"`
                              hides the list (via `hidden`) while keeping
                              its state mounted, so scroll position,
                              search query, and selection survive the
                              back-navigation. The `lg:block` override
                              brings the list back on desktop where both
                              panes coexist.
                            */}
                            <div
                                className={cn(
                                    "lg:col-span-1 lg:block",
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
                                    onSelect={(r) => {
                                        setCurrentRecording(r);
                                        // Tapping a row on mobile reveals
                                        // the detail pane. Desktop ignores
                                        // this state.
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

                            {/*
                              On lg+: pin the detail pane just below the
                              sticky page header so the list is the only
                              thing that scrolls vertically. `self-start`
                              opts the grid item out of the default
                              `stretch` alignment that would otherwise
                              defeat `position: sticky`. Max-height clamps
                              the pane to the viewport minus the header
                              + a little breathing room, and any content
                              that overflows (e.g. long transcripts)
                              scrolls internally instead of pushing the
                              list down. Below lg the layout stacks, so
                              the sticky behavior is intentionally off.
                            */}
                            <div
                                className={cn(
                                    "space-y-6 lg:sticky lg:top-[4.5rem] lg:col-span-2 lg:block lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto lg:pr-1",
                                    mobileView === "list" && "hidden",
                                )}
                            >
                                {/*
                                  Mobile back affordance. Returns to the
                                  list view without dropping the selected
                                  recording — reopening shows the same
                                  detail. Hidden on lg+ where both panes
                                  are visible at once.
                                */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setMobileView("list")}
                                    className="-ml-2 h-9 gap-1 px-2 lg:hidden"
                                >
                                    <ArrowLeft className="size-4" />
                                    Back to recordings
                                </Button>
                                {currentRecording ? (
                                    <>
                                        <RecordingPlayer
                                            recording={currentRecording}
                                            initialPlaybackSpeed={
                                                initialSettings.defaultPlaybackSpeed
                                            }
                                            initialVolume={
                                                initialSettings.defaultVolume
                                            }
                                            initialAutoPlayNext={
                                                initialSettings.autoPlayNext
                                            }
                                            scrubberStyle={
                                                initialSettings.playerScrubber
                                            }
                                            onEnded={() => {
                                                const currentIndex =
                                                    visibleRecordings.findIndex(
                                                        (r) =>
                                                            r.id ===
                                                            currentRecording.id,
                                                    );
                                                if (
                                                    currentIndex >= 0 &&
                                                    currentIndex <
                                                        visibleRecordings.length -
                                                            1
                                                ) {
                                                    setCurrentRecording(
                                                        visibleRecordings[
                                                            currentIndex + 1
                                                        ],
                                                    );
                                                }
                                            }}
                                        />
                                        <TranscriptionPanel
                                            recording={currentRecording}
                                            transcription={currentTranscription}
                                            isTranscribing={
                                                isCurrentTranscribing
                                            }
                                            onTranscribe={handleTranscribe}
                                        />
                                    </>
                                ) : (
                                    <Card>
                                        <CardContent className="py-16 text-center">
                                            <p className="text-muted-foreground">
                                                Select a recording to view
                                                details and transcription
                                            </p>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
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
                onSync={handleSync}
                onUpload={triggerUpload}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onSetTheme={setTheme}
                onTranscribeRecording={transcribeById}
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
            />

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    router.refresh();
                }}
            />
        </>
    );
}
