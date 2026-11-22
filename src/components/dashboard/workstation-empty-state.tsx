"use client";

import { RefreshCw } from "lucide-react";
import { type DragEvent, useState } from "react";
import {
    type PlaudConnectMode,
    PlaudConnectTabs,
} from "@/components/plaud-connect-tabs";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
}: Props) {
    const [connectMode, setConnectMode] = useState<PlaudConnectMode | null>(
        null,
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
                                className={cn(
                                    "size-4",
                                    isSyncing &&
                                        "animate-spin motion-reduce:animate-none",
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
                            className="squircle flex min-w-0 flex-1 flex-col gap-5 rounded-[var(--radius-card)] border border-accent bg-card p-6"
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
                                    onClick={() => setConnectMode("connector")}
                                >
                                    Sign in with Plaud
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="control"
                                    onClick={() => setConnectMode("email")}
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

                    <Dialog
                        open={connectMode !== null}
                        onOpenChange={(open) => {
                            if (!open) setConnectMode(null);
                        }}
                    >
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>
                                    Connect your Plaud account
                                </DialogTitle>
                                <DialogDescription>
                                    Sign in to Plaud so your recordings sync to
                                    this server.
                                </DialogDescription>
                            </DialogHeader>
                            {connectMode !== null && (
                                <PlaudConnectTabs
                                    key={connectMode}
                                    initialMode={connectMode}
                                    onConnected={() => {
                                        setConnectMode(null);
                                        onPlaudConnected();
                                    }}
                                />
                            )}
                        </DialogContent>
                    </Dialog>
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
