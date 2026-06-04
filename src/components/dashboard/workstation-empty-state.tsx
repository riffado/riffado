"use client";

import { Mic, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
    isSyncing: boolean;
    onSync: () => void;
    onUpload: () => void;
}

export function WorkstationEmptyState({ isSyncing, onSync, onUpload }: Props) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            {/* Icon halo */}
            <div className="mb-5 flex items-center justify-center rounded-full bg-primary/10 p-5 ring-1 ring-primary/20 dark:bg-primary/5">
                <Mic className="size-7 text-primary/60" />
            </div>

            <h3 className="mb-1.5 text-base font-semibold text-foreground">
                No recordings yet
            </h3>
            <p className="mb-8 max-w-xs text-sm text-muted-foreground leading-relaxed">
                Sync your Plaud device to import recordings, or upload an audio
                file directly.
            </p>

            <div className="flex items-center gap-3">
                <Button
                    onClick={onSync}
                    disabled={isSyncing}
                    variant="glow"
                    size="sm"
                    className="gap-2"
                >
                    <RefreshCw
                        className={
                            isSyncing ? "size-3.5 animate-spin" : "size-3.5"
                        }
                    />
                    {isSyncing ? "Syncing…" : "Sync device"}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onUpload}
                    className="gap-2"
                >
                    <Upload className="size-3.5" />
                    Upload audio
                </Button>
            </div>
        </div>
    );
}
