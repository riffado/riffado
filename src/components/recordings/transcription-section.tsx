"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SummaryTabs } from "@/components/dashboard/summary-tabs";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";

interface TranscriptionSectionProps {
    recordingId: string;
    initialTranscription?: string;
    initialLanguage?: string | null;
    initialType?: string | null;
}

export function TranscriptionSection({
    recordingId,
    initialTranscription,
    initialLanguage,
    initialType,
}: TranscriptionSectionProps) {
    const [transcription, setTranscription] = useState(initialTranscription);
    const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
    const [transcriptionType, setTranscriptionType] = useState(initialType);
    const [isProcessing, setIsProcessing] = useState(false);
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);

    const handleTranscribe = async () => {
        setIsProcessing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/transcribe`,
                { method: "POST" },
            );

            if (!response.ok) {
                const errorData = await response.json();
                if (
                    response.status === 400 &&
                    errorData.error?.includes("No transcription API")
                ) {
                    toast.error(
                        "Please configure an AI provider in Settings first",
                    );
                } else {
                    toast.error(errorData.error || "Transcription failed");
                }
                return;
            }

            const data = await response.json();
            setTranscription(data.transcription);
            setDetectedLanguage(data.detectedLanguage);
            setTranscriptionType("server");
            setSummaryFetchKey((k) => k + 1);
            toast.success("Transcription complete");
        } catch {
            toast.error("Transcription failed. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-6">
            <Panel>
                <div className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-xl font-bold">Transcription</h2>
                            {detectedLanguage && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset">
                                    <LEDIndicator
                                        active
                                        status="active"
                                        size="sm"
                                    />
                                    <span className="text-label text-xs">
                                        Lang:{" "}
                                        <span className="font-mono uppercase text-accent-cyan">
                                            {detectedLanguage}
                                        </span>
                                    </span>
                                </div>
                            )}
                            {transcriptionType && (
                                <span className="text-label text-xs px-3 py-1.5 rounded-lg bg-panel-inset border border-panel-border">
                                    {transcriptionType}
                                </span>
                            )}
                        </div>
                        <MetalButton
                            onClick={handleTranscribe}
                            variant="cyan"
                            disabled={isProcessing}
                            className="w-full md:w-auto"
                        >
                            {isProcessing
                                ? "Processing..."
                                : transcription
                                  ? "Re-transcribe"
                                  : "Transcribe"}
                        </MetalButton>
                    </div>

                    {transcription ? (
                        <div className="info-card">
                            <p className="whitespace-pre-wrap leading-relaxed">
                                {transcription}
                            </p>
                        </div>
                    ) : (
                        <Panel variant="inset" className="text-center py-12">
                            <LEDIndicator
                                active={false}
                                status="active"
                                size="md"
                                className="mx-auto mb-4"
                            />
                            <p className="text-muted-foreground mb-2">
                                No transcription yet
                            </p>
                            <p className="text-sm text-text-muted">
                                Click &quot;Transcribe&quot; to generate a
                                transcription
                            </p>
                        </Panel>
                    )}
                </div>
            </Panel>

            {transcription && (
                <SummaryTabs
                    recordingId={recordingId}
                    fetchKey={summaryFetchKey}
                />
            )}
        </div>
    );
}
