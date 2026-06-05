"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

// ── Logo dome fade ──────────────────────────────────────────────────────────
// The Mesynx halftone dome (same geometry as the app logo). The dots fade out
// in a diagonal sweep from bottom-right → top-left; once all are gone they pop
// back with a subtle flash, then the fade repeats in a loop.
const DOME_DOTS: { x: number; y: number }[] = [
    { x: 10.55, y: 9.7 },
    { x: 13.4, y: 9.7 },
    { x: 16.25, y: 9.7 },
    { x: 19.1, y: 9.7 },
    { x: 21.95, y: 9.7 },
    { x: 7.7, y: 12.55 },
    { x: 10.55, y: 12.55 },
    { x: 13.4, y: 12.55 },
    { x: 16.25, y: 12.55 },
    { x: 19.1, y: 12.55 },
    { x: 21.95, y: 12.55 },
    { x: 24.8, y: 12.55 },
    { x: 4.85, y: 15.4 },
    { x: 7.7, y: 15.4 },
    { x: 10.55, y: 15.4 },
    { x: 13.4, y: 15.4 },
    { x: 16.25, y: 15.4 },
    { x: 19.1, y: 15.4 },
    { x: 21.95, y: 15.4 },
    { x: 24.8, y: 15.4 },
    { x: 27.65, y: 15.4 },
    { x: 4.85, y: 18.25 },
    { x: 7.7, y: 18.25 },
    { x: 10.55, y: 18.25 },
    { x: 13.4, y: 18.25 },
    { x: 16.25, y: 18.25 },
    { x: 19.1, y: 18.25 },
    { x: 21.95, y: 18.25 },
    { x: 24.8, y: 18.25 },
    { x: 27.65, y: 18.25 },
    { x: 4.85, y: 21.1 },
    { x: 7.7, y: 21.1 },
    { x: 10.55, y: 21.1 },
    { x: 13.4, y: 21.1 },
    { x: 16.25, y: 21.1 },
    { x: 19.1, y: 21.1 },
    { x: 21.95, y: 21.1 },
    { x: 24.8, y: 21.1 },
    { x: 27.65, y: 21.1 },
    { x: 16, y: 23.1 },
    { x: 17.6, y: 24.6 },
    { x: 19.2, y: 26.1 },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function LogoDomeAnimation() {
    const circleRefs = useRef<(SVGCircleElement | null)[]>([]);

    // Per-dot fade trigger: bottom-right (high x+y) fades first → trigger ~0,
    // top-left (low x+y) fades last → trigger ~1.
    const triggers = useMemo(() => {
        const scores = DOME_DOTS.map((d) => d.x + d.y);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        return scores.map((s) => 1 - (s - min) / (max - min));
    }, []);

    useEffect(() => {
        const FADE_MS = 2200;
        const FLASH_MS = 650;
        const EDGE = 0.32;
        const BASE_R = 1.02;
        const cycle = FADE_MS + FLASH_MS;
        const start = performance.now();
        let raf = 0;

        const tick = (now: number) => {
            const tt = (now - start) % cycle;
            for (let i = 0; i < DOME_DOTS.length; i++) {
                const c = circleRefs.current[i];
                if (!c) continue;
                let op: number;
                let r = BASE_R;
                if (tt < FADE_MS) {
                    // Fade-out sweep
                    const front = (tt / FADE_MS) * (1 + EDGE);
                    op = 1 - smoothstep(triggers[i], triggers[i] + EDGE, front);
                } else {
                    // Flash back on
                    const f = (tt - FADE_MS) / FLASH_MS; // 0 → 1
                    const glow = Math.sin(f * Math.PI); // 0 → 1 → 0
                    op = Math.max(f, glow * 0.95);
                    r = BASE_R * (1 + 0.7 * glow);
                }
                c.setAttribute("fill-opacity", op.toFixed(3));
                c.setAttribute("r", r.toFixed(2));
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [triggers]);

    return (
        <svg
            viewBox="0 0 32 32"
            className="size-16 text-foreground"
            style={{ filter: "drop-shadow(0 0 4px rgba(0,200,232,0.5))" }}
            aria-hidden="true"
        >
            <title>Generating</title>
            {DOME_DOTS.map((d, i) => (
                <circle
                    key={`dome-${d.x}-${d.y}`}
                    ref={(el) => {
                        circleRefs.current[i] = el;
                    }}
                    cx={d.x}
                    cy={d.y}
                    r={1.02}
                    fill="currentColor"
                    fillOpacity={1}
                />
            ))}
        </svg>
    );
}

// ── Pulse rings ─────────────────────────────────────────────────────────────
const RING_IDS = [0, 1, 2];

function PulseRingsAnimation() {
    return (
        <div className="relative flex size-16 items-center justify-center">
            {RING_IDS.map((id) => (
                <span
                    key={`ring-${id}`}
                    className="absolute rounded-full border-2 border-primary"
                    style={{
                        width: "100%",
                        height: "100%",
                        animation: `pulse-rings 1.8s cubic-bezier(0.2,0.6,0.3,1) ${id * 0.6}s infinite`,
                    }}
                />
            ))}
            <span className="size-3 rounded-full bg-primary animate-pulse" />
        </div>
    );
}

// ── Comet spinner (conic ring) ──────────────────────────────────────────────
function CometSpinnerAnimation() {
    return (
        <div
            className="size-14 rounded-full animate-spin"
            style={{
                background:
                    "conic-gradient(from 0deg, transparent 0%, var(--primary) 85%, transparent 100%)",
                WebkitMask:
                    "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))",
                animationDuration: "0.9s",
            }}
        />
    );
}

const ANIMATIONS = [
    WaveformAnimation,
    OrbitAnimation,
    DnaHelixAnimation,
    LogoDomeAnimation,
    PulseRingsAnimation,
    CometSpinnerAnimation,
];

// Show each animation for a few loops, then cross-fade to the next one so the
// user has something fresh to watch the whole time the pipeline runs.
const ANIMATION_SWITCH_MS = 7000;

function RandomAnimation() {
    // Shuffle the order once per run (Fisher–Yates) so the sequence — and the
    // animation shown first — varies each time the pipeline starts.
    const order = useMemo(() => {
        const arr = ANIMATIONS.map((_, i) => i);
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }, []);

    const [pos, setPos] = useState(0);

    useEffect(() => {
        const id = setInterval(
            () => setPos((p) => (p + 1) % order.length),
            ANIMATION_SWITCH_MS,
        );
        return () => clearInterval(id);
    }, [order.length]);

    const Animation = ANIMATIONS[order[pos]];

    return (
        // key={pos} remounts on switch: restarts the next animation cleanly
        // (e.g. the dome's rAF clock) and re-triggers the entrance transition.
        <div
            key={pos}
            className="flex items-center justify-center animate-in fade-in zoom-in-95 duration-500"
        >
            <Animation />
        </div>
    );
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
