import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

interface DotWaveformProps {
    /** Normalized peaks in [0, 1]. */
    peaks: number[];
    /** Playback position in [0, 1]. */
    progress: number;
    /** Number of dot columns to render. */
    columns?: number;
    /** Maximum dots per column; forced odd so columns stay centered. */
    rows?: number;
    /** `night` for dark players, `light` for cream/white surfaces. */
    tone?: "night" | "light";
    className?: string;
}

const STEP = 6;
const RADIUS = 1.3;

function sample(peaks: number[], columns: number): number[] {
    if (peaks.length === 0) return new Array<number>(columns).fill(0);
    const out = new Array<number>(columns);
    const ratio = peaks.length / columns;
    for (let i = 0; i < columns; i++) {
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

/**
 * Dot-matrix waveform from the design system. Played columns are solid,
 * the playhead column is terracotta, unplayed columns are dimmed.
 */
export function DotWaveform({
    peaks,
    progress,
    columns = 60,
    rows = 7,
    tone = "light",
    className,
}: DotWaveformProps) {
    const maxRows = rows % 2 === 0 ? rows + 1 : rows;
    const values = sample(peaks, columns);
    const head = Math.min(
        columns - 1,
        Math.floor(Math.max(0, Math.min(1, progress)) * columns),
    );
    const width = columns * STEP;
    const height = maxRows * STEP;
    const played = tone === "night" ? "var(--background)" : "var(--ink)";
    const rest = tone === "night" ? "var(--night-border)" : "var(--border)";

    const dots: ReactElement[] = [];
    for (let i = 0; i < columns; i++) {
        let n = Math.max(1, Math.round(values[i] * maxRows));
        if (n % 2 === 0) n += 1;
        n = Math.min(n, maxRows);
        const cx = i * STEP + STEP / 2;
        const fill =
            i === head ? "var(--terracotta)" : i < head ? played : rest;
        for (let k = 0; k < n; k++) {
            const cy = height / 2 + (k - (n - 1) / 2) * STEP;
            dots.push(
                <circle
                    key={`${i}-${k}`}
                    cx={cx}
                    cy={cy}
                    r={RADIUS}
                    fill={fill}
                />,
            );
        }
    }

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            className={cn("block h-9 w-full", className)}
            aria-hidden="true"
        >
            {dots}
        </svg>
    );
}
