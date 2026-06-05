"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type PipelineStage =
    | "idle"
    | "transcribing"
    | "summarizing"
    | "complete"
    | "error";

interface GeneratePipelineProps {
    stage: PipelineStage;
    error?: string | null;
}

// ─── Fun loading messages per stage ──────────────────────────────────────────

const TRANSCRIBING_MESSAGES = [
    "Listening carefully to every word…",
    "Converting sound waves to text…",
    "Decoding the audio…",
    "Teaching electrons to understand speech…",
    "Turning your voice into words…",
    "Processing audio frequencies…",
    "Whisper is doing its thing…",
    "Parsing phonemes at lightspeed…",
    "Your GPU is warming up nicely…",
    "Crunching through the waveform…",
    "Almost there, just a few more syllables…",
    "Transcription engine is humming…",
];

const SUMMARIZING_MESSAGES = [
    "Reading between the lines…",
    "Extracting the key insights…",
    "Distilling the essence…",
    "Building your summary…",
    "Finding the action items…",
    "Organizing your thoughts…",
    "Crafting the mind map…",
    "Connecting the dots…",
    "Highlighting what matters…",
    "Turning transcription into intelligence…",
    "Generating your memory map…",
    "Almost ready to show you the results…",
];

function useRotatingMessage(messages: string[], intervalMs = 3500) {
    const [index, setIndex] = useState(() =>
        Math.floor(Math.random() * messages.length),
    );
    useEffect(() => {
        const id = setInterval(
            () => setIndex((i) => (i + 1) % messages.length),
            intervalMs,
        );
        return () => clearInterval(id);
    }, [messages, intervalMs]);
    return messages[index];
}

// ─── SVG animations ──────────────────────────────────────────────────────────

const BAR_IDS = Array.from({ length: 24 }, (_, i) => i);
const ORBIT_IDS = [0, 1, 2];
const DOT_IDS = Array.from({ length: 16 }, (_, i) => i);

function WaveformAnimation() {
    return (
        <div className="flex items-end justify-center gap-[3px] h-12">
            {BAR_IDS.map((id) => (
                <div
                    key={`bar-${id}`}
                    className="w-[3px] rounded-full bg-primary/70"
                    style={{
                        animation: `waveform-bar 1.2s ease-in-out ${id * 0.05}s infinite alternate`,
                        height: `${12 + Math.random() * 36}px`,
                    }}
                />
            ))}
        </div>
    );
}

function OrbitAnimation() {
    return (
        <div className="relative size-14">
            {/* Center dot */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="size-3 rounded-full bg-primary animate-pulse" />
            </div>
            {/* Orbiting dots */}
            {ORBIT_IDS.map((id) => (
                <div
                    key={`orbit-${id}`}
                    className="absolute inset-0"
                    style={{
                        animation: `orbit ${1.8 + id * 0.3}s linear infinite`,
                        animationDelay: `${id * 0.6}s`,
                    }}
                >
                    <div
                        className="size-2 rounded-full"
                        style={{
                            backgroundColor: `hsl(${180 + id * 40} 70% 55%)`,
                            marginTop: "-4px",
                            marginLeft: "calc(50% - 4px)",
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

function DnaHelixAnimation() {
    return (
        <div className="flex items-center justify-center gap-[2px] h-12">
            {DOT_IDS.map((id) => (
                <div key={`dna-${id}`} className="flex flex-col gap-1">
                    <div
                        className="size-[5px] rounded-full bg-primary/60"
                        style={{
                            animation: `dna-top 2s ease-in-out ${id * 0.12}s infinite`,
                        }}
                    />
                    <div
                        className="size-[5px] rounded-full bg-cyan-400/60"
                        style={{
                            animation: `dna-bottom 2s ease-in-out ${id * 0.12}s infinite`,
                        }}
                    />
                </div>
            ))}
        </div>
    );
}

const ANIMATIONS = [WaveformAnimation, OrbitAnimation, DnaHelixAnimation];

function RandomAnimation() {
    const Animation = useMemo(
        () => ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)],
        [],
    );
    return <Animation />;
}

// ─── Pipeline steps indicator ────────────────────────────────────────────────

const STEPS = [
    { key: "transcribing", label: "Transcribe" },
    { key: "summarizing", label: "Summarize" },
    { key: "complete", label: "Done" },
] as const;

function stageIndex(stage: PipelineStage): number {
    if (stage === "transcribing") return 0;
    if (stage === "summarizing") return 1;
    if (stage === "complete") return 2;
    return -1;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function GeneratePipeline({ stage, error }: GeneratePipelineProps) {
    const currentIndex = stageIndex(stage);

    const message = useRotatingMessage(
        stage === "transcribing" ? TRANSCRIBING_MESSAGES : SUMMARIZING_MESSAGES,
    );

    if (stage === "idle") return null;

    return (
        <div className="flex flex-col items-center justify-center gap-6 py-10 animate-in fade-in duration-500">
            {/* Animation */}
            {stage !== "complete" && stage !== "error" && (
                <div className="mb-2">
                    <RandomAnimation />
                </div>
            )}

            {/* Complete icon */}
            {stage === "complete" && (
                <div className="animate-in zoom-in-50 duration-500">
                    <CheckCircle2 className="size-12 text-emerald-500 drop-shadow-[0_0_12px_rgba(34,197,94,0.4)]" />
                </div>
            )}

            {/* Error icon */}
            {stage === "error" && (
                <div className="animate-in zoom-in-50 duration-300">
                    <XCircle className="size-12 text-red-500" />
                </div>
            )}

            {/* Rotating status message */}
            {stage !== "complete" && stage !== "error" && (
                <p
                    className="text-sm text-muted-foreground text-center transition-all duration-500 min-h-[20px]"
                    key={message}
                >
                    <span className="animate-in fade-in duration-500">
                        {message}
                    </span>
                </p>
            )}

            {stage === "complete" && (
                <p className="text-sm font-medium text-emerald-500">
                    All done! Switching to summary…
                </p>
            )}

            {stage === "error" && (
                <p className="text-sm text-red-400 text-center max-w-xs">
                    {error ||
                        "Something went wrong. Check your provider settings and try again."}
                </p>
            )}

            {/* Step indicator */}
            <div className="flex items-center gap-3 mt-2">
                {STEPS.map((step, i) => {
                    const isDone = currentIndex > i || stage === "complete";
                    const isActive = currentIndex === i && stage !== "error";
                    const isError = stage === "error" && currentIndex === i;

                    return (
                        <div key={step.key} className="flex items-center gap-2">
                            {i > 0 && (
                                <div
                                    className={cn(
                                        "w-8 h-[2px] rounded-full transition-colors duration-500",
                                        isDone
                                            ? "bg-emerald-500"
                                            : isActive
                                              ? "bg-primary/50"
                                              : "bg-muted-foreground/20",
                                    )}
                                />
                            )}
                            <div className="flex items-center gap-1.5">
                                <div
                                    className={cn(
                                        "size-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500",
                                        isDone
                                            ? "bg-emerald-500 text-white"
                                            : isActive
                                              ? "bg-primary text-white"
                                              : isError
                                                ? "bg-red-500 text-white"
                                                : "bg-muted-foreground/20 text-muted-foreground/50",
                                    )}
                                >
                                    {isDone ? (
                                        <CheckCircle2 className="size-3.5" />
                                    ) : isActive ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : isError ? (
                                        <XCircle className="size-3.5" />
                                    ) : (
                                        i + 1
                                    )}
                                </div>
                                <span
                                    className={cn(
                                        "text-xs transition-colors duration-300",
                                        isDone
                                            ? "text-emerald-500 font-medium"
                                            : isActive
                                              ? "text-foreground font-medium"
                                              : "text-muted-foreground/50",
                                    )}
                                >
                                    {step.label}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
