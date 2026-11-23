"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { type DragEvent, type ReactNode, useEffect, useState } from "react";
import {
    PlaudConnectDialog,
    type PlaudConnectView,
} from "@/components/plaud-connect/connect-dialog";
import type { Provider } from "@/components/settings-sections/providers-section";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { useSettledSpin } from "@/hooks/use-settled-spin";
import { cn } from "@/lib/utils";

interface Props {
    /** True when the account has a Plaud connection row. */
    hasPlaudConnection: boolean;
    isSyncing: boolean;
    /** True when automatic sync is on in the user's settings. */
    autoSyncEnabled: boolean;
    isUploading: boolean;
    onSync: () => void;
    onUpload: () => void;
    /** Uploads a file dropped on the Upload audio card. */
    onDropFile: (file: File) => void;
    /** Called after Plaud connects from this screen. */
    onPlaudConnected: () => void;
    /** The user's AI providers, or null until loaded. */
    providers: Provider[] | null;
    /** Loads `providers`; called on mount. */
    onRequestProviders: () => void;
}

/** Which transcription line the first-run screen shows, if any. */
export type TranscriptionNotice = "mynah" | "browser" | null;

/**
 * The transcription a new account will use, when it's worth a line:
 * Mynah when the plan includes it and nothing else is the default, or
 * browser transcription when there is no server provider at all. Null
 * while loading and when the user picked their own provider.
 */
export function transcriptionNoticeFor(
    providers: Provider[] | null,
): TranscriptionNotice {
    if (providers === null) return null;
    const own = providers.filter((p) => !p.managed);
    const mynah = providers.find((p) => p.managed && p.available !== false);
    const chosen = providers.find((p) => p.isDefaultTranscription);
    if (mynah && (chosen ? chosen.managed : own.length === 0)) return "mynah";
    if (!mynah && own.length === 0) return "browser";
    return null;
}

/**
 * Shown when the user has no recordings yet (and no in-flight upload).
 * Without a Plaud connection it teaches the next step: connect Plaud or
 * upload audio. With a connection it waits for the first sync and keeps
 * upload available.
 */
export function WorkstationEmptyState({
    hasPlaudConnection,
    isSyncing,
    autoSyncEnabled,
    isUploading,
    onSync,
    onUpload,
    onDropFile,
    onPlaudConnected,
    providers,
    onRequestProviders,
}: Props) {
    const [connectView, setConnectView] = useState<PlaudConnectView | null>(
        null,
    );
    const spin = useSettledSpin(isSyncing);

    useEffect(() => {
        onRequestProviders();
    }, [onRequestProviders]);
    const notice = (
        <TranscriptionNoticeLine notice={transcriptionNoticeFor(providers)} />
    );

    const waitingBody = autoSyncEnabled
        ? "New recordings in your Plaud account show up here automatically."
        : "New recordings in your Plaud account show up here after the next sync.";

    return (
        <div className="flex flex-col items-center justify-center gap-10 py-10 lg:min-h-full">
            {hasPlaudConnection ? (
                <>
                    <div className="flex flex-col items-center gap-6">
                        <Heading
                            title="Waiting for your first recording"
                            body={waitingBody}
                        />
                        <Button
                            variant="quiet"
                            size="control"
                            onClick={onSync}
                            disabled={isSyncing}
                        >
                            <RefreshCw
                                ref={spin.ref}
                                className={cn(
                                    "size-4",
                                    spin.spinning &&
                                        "animate-spin motion-reduce:animate-pulse",
                                )}
                                aria-hidden="true"
                            />
                            {isSyncing ? "Syncing…" : "Sync now"}
                        </Button>
                    </div>
                    <UploadCard
                        isUploading={isUploading}
                        onUpload={onUpload}
                        onDropFile={onDropFile}
                        className="w-full md:w-75"
                    />
                    {notice}
                </>
            ) : (
                <>
                    <Heading
                        title="Your first recording"
                        body="Recordings sync from your Plaud account, or you can upload audio you already have."
                    />
                    <div className="flex w-full max-w-184 flex-col gap-4 md:flex-row">
                        <section
                            aria-labelledby="first-run-plaud"
                            className="squircle flex min-w-0 flex-1 flex-col gap-5 rounded-[var(--radius-card)] border border-accent bg-card p-6 dark:border-border"
                        >
                            <div className="flex flex-col gap-1.5">
                                <h2
                                    id="first-run-plaud"
                                    className="text-base leading-5.5 font-semibold text-strong"
                                >
                                    Connect your Plaud account
                                </h2>
                                <p className="text-ui leading-5 text-subtle">
                                    Recordings from your Note, Note Pro or
                                    NotePin sync to this server, then get
                                    transcribed and summarized
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="ink"
                                    size="control"
                                    onClick={() => setConnectView("main")}
                                >
                                    Sign in with Plaud
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="control"
                                    onClick={() => setConnectView("email")}
                                    className="text-foreground"
                                >
                                    Other ways to connect
                                </Button>
                            </div>
                        </section>
                        <UploadCard
                            isUploading={isUploading}
                            onUpload={onUpload}
                            onDropFile={onDropFile}
                            className="md:w-75 md:shrink-0"
                        />
                    </div>
                    {notice}

                    <PlaudConnectDialog
                        open={connectView !== null}
                        onOpenChange={(open) => {
                            if (!open) setConnectView(null);
                        }}
                        initialView={connectView ?? "main"}
                        onConnected={() => {
                            setConnectView(null);
                            onPlaudConnected();
                        }}
                    />
                </>
            )}
        </div>
    );
}

function Heading({ title, body }: { title: string; body: string }) {
    return (
        <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="font-display text-pane-title font-medium text-strong sm:text-display">
                {title}
            </h2>
            <p className="max-w-130 text-reading text-subtle">{body}</p>
        </div>
    );
}

/**
 * One line under the cards naming the transcription in use, linked to
 * Settings. Its row is reserved from the first paint so the cards don't
 * move when the provider list arrives; the text fades in.
 */
function TranscriptionNoticeLine({ notice }: { notice: TranscriptionNotice }) {
    return (
        <p className="flex min-h-5 flex-wrap items-center justify-center gap-x-2 text-center text-sm text-subtle">
            {notice ? (
                <span
                    key={notice}
                    className="inline-flex items-center gap-2 transition-opacity duration-(--duration-status) ease-(--ease-out) starting:opacity-0"
                >
                    <StatusDot tone="ready" />
                    <span>
                        {notice === "mynah" ? (
                            <>
                                Transcription uses Mynah, included with your
                                plan. <NoticeLink>Change</NoticeLink>
                            </>
                        ) : (
                            <>
                                Transcribe in your browser for free, or{" "}
                                <NoticeLink>add a provider</NoticeLink>
                            </>
                        )}
                    </span>
                </span>
            ) : null}
        </p>
    );
}

function NoticeLink({ children }: { children: ReactNode }) {
    return (
        <Link
            href="/settings#transcription"
            className="rounded-sm font-medium text-strong underline decoration-1 underline-offset-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            {children}
        </Link>
    );
}

function UploadCard({
    isUploading,
    onUpload,
    onDropFile,
    className,
}: {
    isUploading: boolean;
    onUpload: () => void;
    onDropFile: (file: File) => void;
    className?: string;
}) {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (event: DragEvent<HTMLElement>) => {
        if (isUploading || !event.dataTransfer.types.includes("Files")) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
    };

    const handleDrop = (event: DragEvent<HTMLElement>) => {
        setIsDragOver(false);
        const file = event.dataTransfer.files[0];
        if (isUploading || !file) return;
        event.preventDefault();
        onDropFile(file);
    };

    return (
        <section
            aria-labelledby="first-run-upload"
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
                const next = event.relatedTarget;
                if (
                    next instanceof Node &&
                    event.currentTarget.contains(next)
                ) {
                    return;
                }
                setIsDragOver(false);
            }}
            onDrop={handleDrop}
            className={cn(
                "squircle flex flex-col justify-between gap-4 rounded-[var(--radius-card)] border-[1.5px] border-dashed border-border p-5.5 transition-colors duration-150",
                isDragOver && "border-foreground bg-accent",
                className,
            )}
        >
            <div className="flex flex-col gap-1.5">
                <h2
                    id="first-run-upload"
                    className="text-base leading-5 font-semibold text-strong"
                >
                    Upload audio
                </h2>
                <p className="text-ui leading-5 text-subtle">
                    Drop a file here. MP3, M4A, WAV, Opus and more, up to 500
                    MB.
                </p>
            </div>
            <Button
                variant="quiet"
                size="control"
                onClick={onUpload}
                disabled={isUploading}
                className="w-fit"
            >
                {isUploading ? "Uploading…" : "Choose a file"}
            </Button>
        </section>
    );
}
