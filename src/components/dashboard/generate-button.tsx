"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface GenerateButtonProps {
    onClick: () => void;
    disabled?: boolean;
    className?: string;
}

/**
 * Animated "Generate" call-to-action that replaces the empty transcription
 * state. Features a pulsing glow ring, floating particles, and a subtle
 * shimmer across the label.
 */
export function GenerateButton({
    onClick,
    disabled,
    className,
}: GenerateButtonProps) {
    // Cycle the glow hue so the ring slowly shifts color.
    const [hue, setHue] = useState(180);
    useEffect(() => {
        const id = setInterval(() => setHue((h) => (h + 0.4) % 360), 50);
        return () => clearInterval(id);
    }, []);

    return (
        <div className={cn("flex flex-col items-center gap-5", className)}>
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={cn(
                    "group relative flex items-center gap-2.5 rounded-xl px-8 py-3.5",
                    "text-sm font-semibold text-white",
                    "transition-all duration-300 ease-out",
                    "hover:scale-[1.04] active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    "disabled:pointer-events-none disabled:opacity-40",
                )}
                style={{
                    background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 65% 38%))`,
                    boxShadow: `0 0 24px 4px hsla(${hue} 70% 50% / 0.25), 0 0 60px 8px hsla(${hue} 70% 50% / 0.10)`,
                }}
            >
                {/* Shimmer sweep */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                    <span
                        className="absolute inset-0 -translate-x-full animate-[shimmer_2.5s_ease-in-out_infinite]"
                        style={{
                            background:
                                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)",
                        }}
                    />
                </span>

                {/* Pulse ring */}
                <span
                    className="pointer-events-none absolute -inset-1.5 rounded-2xl opacity-30 animate-[pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"
                    style={{
                        border: `2px solid hsl(${hue} 70% 55%)`,
                    }}
                />

                <Sparkles className="size-4 drop-shadow-sm transition-transform duration-300 group-hover:rotate-12" />
                <span className="relative">Generate</span>
            </button>

            <p className="text-xs text-muted-foreground/60 max-w-52 text-center leading-relaxed">
                Transcribe, summarize, and build the memory map in one click
            </p>
        </div>
    );
}
