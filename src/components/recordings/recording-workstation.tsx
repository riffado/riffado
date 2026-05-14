"use client";

import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { Recording } from "@/types/recording";

interface Transcription {
    text?: string;
    detectedLanguage?: string;
    transcriptionType?: string;
}

interface RecordingWorkstationProps {
    recording: Recording;
    transcription?: Transcription;
    /**
     * User playback preferences forwarded into the embedded
     * RecordingPlayer. Server-resolved (with the same defaults as the
     * dashboard's Workstation) so callers don't need to know the
     * shape of user_settings; the page server-component reads them
     * once and hands them down here.
     */
    initialPlaybackSpeed?: number;
    initialVolume?: number;
    initialAutoPlayNext?: boolean;
    scrubberStyle?: "waveform" | "slider";
}

export function RecordingWorkstation({
    recording,
    transcription,
    initialPlaybackSpeed,
    initialVolume,
    initialAutoPlayNext,
    scrubberStyle,
}: RecordingWorkstationProps) {
    const { push, refresh } = useRouter();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleTranscribe = useCallback(async () => {
        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe`,
                {
                    method: "POST",
                },
            );

            if (response.ok) {
                toast.success("Transcription complete");
                refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Transcription failed");
            }
        } catch {
            toast.error("Failed to transcribe recording");
        } finally {
            setIsTranscribing(false);
        }
    }, [recording.id, refresh]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            const response = await fetch(`/api/recordings/${recording.id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                toast.success("Recording deleted");
                setDeleteDialogOpen(false);
                push("/dashboard");
                refresh();
            } else {
                const error = await response.json().catch(() => ({}));
                toast.error(error.error || "Failed to delete recording");
                setIsDeleting(false);
            }
        } catch {
            toast.error("Failed to delete recording");
            setIsDeleting(false);
        }
    }, [recording.id, refresh, push]);

    return (
        <div className="bg-background">
            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <Button
                        onClick={() => push("/dashboard")}
                        variant="outline"
                        size="icon"
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-3xl font-semibold truncate">
                            {recording.filename}
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            <LocalTime value={recording.startTime} />
                        </p>
                    </div>
                    <Button
                        onClick={() => setDeleteDialogOpen(true)}
                        variant="outline"
                        size="icon"
                        aria-label="Delete recording"
                        title="Delete recording"
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>

                {/* Content */}
                <div className="space-y-6">
                    <RecordingPlayer
                        recording={recording}
                        initialPlaybackSpeed={initialPlaybackSpeed}
                        initialVolume={initialVolume}
                        initialAutoPlayNext={initialAutoPlayNext}
                        scrubberStyle={scrubberStyle}
                    />
                    <TranscriptionPanel
                        recording={recording}
                        transcription={transcription}
                        isTranscribing={isTranscribing}
                        onTranscribe={handleTranscribe}
                    />

                    {/* Metadata */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Duration
                                    </div>
                                    <div className="font-medium">
                                        {Math.floor(recording.duration / 60000)}
                                        :
                                        {((recording.duration % 60000) / 1000)
                                            .toFixed(0)
                                            .padStart(2, "0")}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        File Size
                                    </div>
                                    <div className="font-medium">
                                        {(
                                            recording.filesize /
                                            (1024 * 1024)
                                        ).toFixed(2)}{" "}
                                        MB
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Device
                                    </div>
                                    <div className="font-mono text-xs truncate">
                                        {recording.deviceSn}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Date
                                    </div>
                                    <div className="font-medium">
                                        <LocalTime
                                            value={recording.startTime}
                                            variant="date"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                    if (!isDeleting) setDeleteDialogOpen(open);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this recording?</DialogTitle>
                        <DialogDescription>
                            This permanently removes the audio file,
                            transcription, and AI summary from OpenPlaud. The
                            recording on your Plaud account is not affected, but
                            it will not be re-synced to OpenPlaud.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteDialogOpen(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="size-4 mr-2 animate-spin" />
                                    Deleting…
                                </>
                            ) : (
                                "Delete recording"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
