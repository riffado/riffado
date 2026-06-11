"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";

interface WaveformProps {
    peaks: number[];
    /** Playback position in [0, 1]. */
    progress: number;
    durationSeconds: number;
    disabled?: boolean;
    onSeek: (next: number) => void;
    className?: string;
    height?: number;
}

const TARGET_BAR_WIDTH_PX = 3;
const TARGET_BAR_GAP_PX = 2;
const MIN_VISIBLE_BARS = 32;
const MAX_VISIBLE_BARS = 220;
const CENTER_DEAD_ZONE_PX = 1;
const MIN_BAR_HEIGHT_FRAC = 0.04;
const PLAYHEAD_WIDTH_PX = 2;
const PLAYHEAD_GLOW_PX = 6;
const UNPLAYED_ALPHA = 0.35;
const HOVER_LINE_ALPHA = 0.55;

const formatSeconds = formatDuration;

function aggregatePeaks(peaks: number[], visibleBars: number): number[] {
    if (visibleBars >= peaks.length) return peaks.slice();
    const out = new Array<number>(visibleBars);
    const ratio = peaks.length / visibleBars;
    for (let i = 0; i < visibleBars; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
        let peak = 0;
        for (let j = start; j < end && j < peaks.length; j++) {
            if (peaks[j] > peak) peak = peaks[j];
        }
        out[i] = peak;
    }
    return out;
}

function computeVisibleBars(cssWidth: number): number {
    const slot = TARGET_BAR_WIDTH_PX + TARGET_BAR_GAP_PX;
    const raw = Math.floor(cssWidth / slot);
    return Math.max(MIN_VISIBLE_BARS, Math.min(MAX_VISIBLE_BARS, raw));
}

// Fallback to plain fillRect on engines lacking roundRect.
function fillBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    const ctxAny = ctx as CanvasRenderingContext2D & {
        roundRect?: (
            x: number,
            y: number,
            w: number,
            h: number,
            radii: number | number[],
        ) => void;
    };
    if (typeof ctxAny.roundRect === "function") {
        ctx.beginPath();
        ctxAny.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, h);
    }
}

export function Waveform({
    peaks,
    progress,
    durationSeconds,
    disabled = false,
    onSeek,
    className,
    height = 56,
}: WaveformProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDraggingRef = useRef(false);
    const [hoverRatio, setHoverRatio] = useState<number | null>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = wrap.clientWidth;
        const cssHeight = height;
        canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
        canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        const styles = getComputedStyle(wrap);
        const primary =
            styles.getPropertyValue("--primary").trim() ||
            "oklch(0.6171 0.1375 39.0427)";
        const muted =
            styles.getPropertyValue("--muted-foreground").trim() ||
            "rgba(0,0,0,0.5)";

        if (peaks.length === 0) return;

        const visibleBars = computeVisibleBars(cssWidth);
        const bars = aggregatePeaks(peaks, visibleBars);

        const slotWidth = cssWidth / visibleBars;
        const barWidth = Math.max(1, slotWidth - TARGET_BAR_GAP_PX);
        const centerY = cssHeight / 2;
        const halfMax = (cssHeight - CENTER_DEAD_ZONE_PX) / 2;
        const minHalfHeight = halfMax * MIN_BAR_HEIGHT_FRAC;
        const radius = Math.min(barWidth / 2, 2);

        const playedX = progress * cssWidth;

        for (let i = 0; i < visibleBars; i++) {
            const x = i * slotWidth + (slotWidth - barWidth) / 2;
            const p = bars[i] ?? 0;
            const halfH = Math.max(minHalfHeight, p * halfMax);

            const barCenter = x + barWidth / 2;
            const played = barCenter <= playedX;

            if (played) {
                ctx.fillStyle = primary;
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = muted;
                ctx.globalAlpha = UNPLAYED_ALPHA;
            }

            const topY = centerY - CENTER_DEAD_ZONE_PX / 2 - halfH;
            fillBar(ctx, x, topY, barWidth, halfH, radius);
            const botY = centerY + CENTER_DEAD_ZONE_PX / 2;
            fillBar(ctx, x, botY, barWidth, halfH, radius);
        }

        ctx.globalAlpha = 1;

        if (
            hoverRatio !== null &&
            !disabled &&
            Math.abs(hoverRatio - progress) > 0.001
        ) {
            const hx = hoverRatio * cssWidth;
            ctx.save();
            ctx.globalAlpha = HOVER_LINE_ALPHA;
            ctx.fillStyle = muted;
            ctx.fillRect(Math.floor(hx), 0, 1, cssHeight);
            ctx.restore();
        }

        if (progress > 0 && progress < 1) {
            ctx.save();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = primary;
            ctx.fillRect(
                Math.floor(playedX) - PLAYHEAD_GLOW_PX / 2,
                0,
                PLAYHEAD_GLOW_PX,
                cssHeight,
            );
            ctx.globalAlpha = 1;
            ctx.fillRect(
                Math.floor(playedX) - PLAYHEAD_WIDTH_PX / 2,
                0,
                PLAYHEAD_WIDTH_PX,
                cssHeight,
            );
            ctx.restore();
        }
    }, [peaks, progress, height, hoverRatio, disabled]);

    useEffect(() => {
        draw();
    }, [draw]);

    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        return () => ro.disconnect();
    }, [draw]);

    const ratioFromClientX = useCallback((clientX: number) => {
        const wrap = wrapRef.current;
        if (!wrap) return 0;
        const rect = wrap.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        return rect.width > 0 ? x / rect.width : 0;
    }, []);

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (disabled) return;
            isDraggingRef.current = true;
            // Capture on currentTarget (wrapper), not e.target (canvas).
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = ratioFromClientX(e.clientX);
            setHoverRatio(r);
            onSeek(r);
        },
        [disabled, ratioFromClientX, onSeek],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (disabled) return;
            if (e.pointerType !== "touch") {
                setHoverRatio(ratioFromClientX(e.clientX));
            }
            if (isDraggingRef.current) {
                onSeek(ratioFromClientX(e.clientX));
            }
        },
        [disabled, ratioFromClientX, onSeek],
    );

    const onPointerUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const onPointerLeave = useCallback(() => {
        setHoverRatio(null);
    }, []);

    // role="slider" keyboard; stopPropagation so the player's window-level
    // ←/→ listener doesn't double-seek.
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (disabled) return;
            const step = e.shiftKey ? 0.05 : 0.01;
            let handled = false;
            switch (e.key) {
                case "ArrowLeft":
                    onSeek(Math.max(0, progress - step));
                    handled = true;
                    break;
                case "ArrowRight":
                    onSeek(Math.min(1, progress + step));
                    handled = true;
                    break;
                case "Home":
                    onSeek(0);
                    handled = true;
                    break;
                case "End":
                    onSeek(1);
                    handled = true;
                    break;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        [disabled, progress, onSeek],
    );

    const tooltipRatio = hoverRatio;
    const tooltipVisible =
        tooltipRatio !== null &&
        !disabled &&
        durationSeconds > 0 &&
        Number.isFinite(durationSeconds);
    const tooltipSeconds = tooltipVisible
        ? (tooltipRatio as number) * durationSeconds
        : 0;
    const tooltipLeftPct = tooltipVisible
        ? Math.max(0, Math.min(100, (tooltipRatio as number) * 100))
        : 0;

    return (
        <div
            ref={wrapRef}
            className={cn(
                "relative w-full select-none touch-none",
                disabled
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm",
                className,
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Audio waveform scrubber"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-valuetext={`${formatSeconds(progress * durationSeconds)} of ${formatSeconds(durationSeconds)}`}
            aria-disabled={disabled || undefined}
            style={{ height }}
        >
            <canvas ref={canvasRef} />
            {tooltipVisible && (
                <div
                    className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 font-mono text-[11px] text-background shadow-md"
                    style={{ left: `${tooltipLeftPct}%` }}
                    aria-hidden="true"
                >
                    {formatSeconds(tooltipSeconds)}
                </div>
            )}
        </div>
    );
}
