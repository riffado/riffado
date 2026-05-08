"use client";

import { FileText, Languages, RefreshCw, Sparkles } from "lucide-react";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recording } from "@/types/recording";
import { SummaryTabs } from "./summary-tabs";

interface Transcription {
    text?: string;
    language?: string;
}

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    onTranscribe: () => void;
}

export function TranscriptionPanel({
    recording,
    transcription,
    isTranscribing,
    onTranscribe,
}: TranscriptionPanelProps) {
    const [summaryFetchKey, setSummaryFetchKey] = useState(0);
    const transcriptionTextRef = React.useRef(transcription?.text);

    if (transcription?.text !== transcriptionTextRef.current) {
        transcriptionTextRef.current = transcription?.text;
        setSummaryFetchKey((k) => k + 1);
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="w-5 h-5" />
                            Transcription
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            {transcription?.text && (
                                <Button
                                    onClick={onTranscribe}
                                    size="sm"
                                    variant="outline"
                                    disabled={isTranscribing}
                                >
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Re-transcribe
                                </Button>
                            )}
                            {!transcription?.text && !isTranscribing && (
                                <Button
                                    onClick={onTranscribe}
                                    size="sm"
                                    disabled={isTranscribing}
                                >
                                    <Sparkles className="w-4 h-4 mr-2" />
                                    Transcribe
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isTranscribing ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                            <p className="text-sm text-muted-foreground">
                                Transcribing audio...
                            </p>
                        </div>
                    ) : transcription?.text ? (
                        <div className="space-y-4">
                            <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
                                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                    {transcription.text}
                                </p>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                                {transcription.language && (
                                    <div className="flex items-center gap-1">
                                        <Languages className="w-3 h-3" />
                                        <span>
                                            Language: {transcription.language}
                                        </span>
                                    </div>
                                )}
                                <div>
                                    {transcription.text.trim()
                                        ? transcription.text.trim().split(/\s+/)
                                              .length
                                        : 0}{" "}
                                    words
                                </div>
                                <div>
                                    {transcription.text.length} characters
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                            <p className="text-sm text-muted-foreground mb-4">
                                No transcription available
                            </p>
                            <Button onClick={onTranscribe} size="sm">
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate Transcription
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {transcription?.text && (
                <SummaryTabs
                    recordingId={recording.id}
                    fetchKey={summaryFetchKey}
                />
            )}
        </div>
    );
}
