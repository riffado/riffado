"use client";

import { useEffect, useRef } from "react";

interface Ripple {
    id: number;
    x: number;
    y: number;
    startedAt: number;
}

interface DotGridBackgroundProps {
    /** Cursor position in viewport coords, or null when not over background. */
    cursorRef: React.RefObject<{ x: number; y: number } | null>;
    /** Active click ripples. Read each frame; no re-render needed. */
    ripplesRef: React.RefObject<Ripple[]>;
}

// ── Grid ────────────────────────────────────────────────────────────
const SPACING = 10;           // px between dot centres — dense, logo-like grid
const DOT_R = 1.5;            // dot radius in logical px

// ── Hover ───────────────────────────────────────────────────────────
const BASE_OPACITY = 0.06;    // resting dim state (barely visible texture)
const HOVER_RADIUS = 8;       // px — only the dot(s) the cursor tip touches
const HOVER_PEAK = 0.85;      // max opacity when cursor is exactly on a dot
const FADE_IN_RATE = 0.25;    // lerp factor — fast fade-in  (~4 frames ≈ 65 ms)
const FADE_OUT_RATE = 0.02;   // lerp factor — slow fade-out (~50 frames ≈ 830 ms)

// ── Ripple ──────────────────────────────────────────────────────────
const RIPPLE_SPEED = 200;         // px / s
const RIPPLE_HALF_WIDTH = 18;     // half-width of the lit ring in px
const RIPPLE_PEAK = 0.92;         // peak opacity at ring centre
const RIPPLE_DURATION = 1800;     // ms — full lifetime of one ripple event

// Primary cyan — matches logo dots
const DOT_COLOR = "#00c8e8";

/**
 * Full-bleed canvas rendered behind the panel scroll area.
 *
 * Hover: only the dot(s) directly under the cursor tip glow —
 *   they fade in quickly when touched and fade out slowly when the
 *   cursor moves away, leaving a gentle bioluminescent trail.
 *
 * Click ripple: an expanding ring passes through the grid; each dot
 *   the ring touches flickers at its own unique frequency and phase
 *   (deterministic per-dot hash) — firefly / bioluminescent effect —
 *   then fades to nothing as the ring moves on.
 */
export function DotGridBackground({
    cursorRef,
    ripplesRef,
}: DotGridBackgroundProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let rafId = 0;

        // ── Per-dot persistent hover-opacity map ──────────────────
        // One Float32 per grid cell; smoothly lerped each frame.
        // Re-allocated on resize (old glow state cleared — acceptable).
        let gridCols = 0;
        let gridRows = 0;
        let opacityMap = new Float32Array(0);

        const ensureGrid = (cols: number, rows: number) => {
            if (cols !== gridCols || rows !== gridRows) {
                opacityMap = new Float32Array(cols * rows).fill(BASE_OPACITY);
                gridCols = cols;
                gridRows = rows;
            }
        };

        // ── Canvas sizing ─────────────────────────────────────────
        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
        };
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        resize();

        // ── RAF draw loop ─────────────────────────────────────────
        const draw = () => {
            const dpr = window.devicePixelRatio || 1;
            const W = canvas.width;
            const H = canvas.height;

            if (W === 0 || H === 0) {
                rafId = requestAnimationFrame(draw);
                return;
            }

            const now = performance.now();
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = DOT_COLOR;

            // Convert viewport cursor coords → canvas pixel coords
            const rect = canvas.getBoundingClientRect();
            const cursor = cursorRef.current;
            const cx = cursor != null ? (cursor.x - rect.left) * dpr : null;
            const cy = cursor != null ? (cursor.y - rect.top) * dpr : null;

            const spacing = SPACING * dpr;
            const dotR = DOT_R * dpr;
            const hoverR = HOVER_RADIUS * dpr;

            // Pre-compute ripple ring geometry for this frame
            const activeRipples = (ripplesRef.current ?? [])
                .map((r) => {
                    const elapsed = now - r.startedAt;
                    return {
                        cx: (r.x - rect.left) * dpr,
                        cy: (r.y - rect.top) * dpr,
                        ringR: (RIPPLE_SPEED * elapsed) / 1000 * dpr,
                        halfW: RIPPLE_HALF_WIDTH * dpr,
                        life: Math.max(0, 1 - elapsed / RIPPLE_DURATION),
                    };
                })
                .filter((r) => r.life > 0);

            // (Re-)allocate opacity map if grid dimensions changed
            const cols = Math.ceil(W / spacing) + 1;
            const rows = Math.ceil(H / spacing) + 1;
            ensureGrid(cols, rows);

            let ci = 0;
            for (let dotX = spacing / 2; dotX < W; dotX += spacing) {
                let ri = 0;
                for (let dotY = spacing / 2; dotY < H; dotY += spacing) {
                    // ── Hover: compute target brightness ──────────
                    let hoverTarget = BASE_OPACITY;
                    if (cx != null && cy != null) {
                        const d = Math.hypot(dotX - cx, dotY - cy);
                        if (d < hoverR) {
                            const t = 1 - d / hoverR;
                            hoverTarget = Math.max(hoverTarget, t * HOVER_PEAK);
                        }
                    }

                    // ── Smooth lerp toward hover target ───────────
                    //    Fast fade-in, slow fade-out — organic feel
                    const idx = ri * gridCols + ci;
                    if (idx < opacityMap.length) {
                        const prev = opacityMap[idx];
                        const rate =
                            hoverTarget > prev ? FADE_IN_RATE : FADE_OUT_RATE;
                        opacityMap[idx] = prev + (hoverTarget - prev) * rate;
                    }

                    // ── Ripple: bioluminescent firefly flicker ─────
                    //    Direct (not lerped) so the flicker is sharp.
                    //    Each dot gets a unique phase + frequency from
                    //    a deterministic hash of its pixel position.
                    let rippleOpacity = 0;
                    for (const r of activeRipples) {
                        const d = Math.hypot(dotX - r.cx, dotY - r.cy);
                        const delta = Math.abs(d - r.ringR);
                        if (delta < r.halfW) {
                            const t = 1 - delta / r.halfW;
                            const ix = dotX | 0;
                            const iy = dotY | 0;
                            // Unique phase per dot (0 … 2π)
                            const phase =
                                ((ix * 127 + iy * 311) & 0xff) /
                                255 *
                                Math.PI *
                                2;
                            // Flicker frequency 3–10 Hz, varies per dot
                            const flickerHz =
                                3 + ((ix * 13 + iy * 17) & 7);
                            const flicker =
                                0.2 +
                                0.8 *
                                    Math.abs(
                                        Math.sin(
                                            now * flickerHz * 0.001 + phase,
                                        ),
                                    );
                            rippleOpacity = Math.max(
                                rippleOpacity,
                                t * t * RIPPLE_PEAK * r.life * flicker,
                            );
                        }
                    }

                    // ── Composite and draw ─────────────────────────
                    const stored =
                        idx < opacityMap.length
                            ? opacityMap[idx]
                            : BASE_OPACITY;
                    ctx.globalAlpha = Math.max(stored, rippleOpacity);
                    ctx.beginPath();
                    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                    ctx.fill();

                    ri++;
                }
                ci++;
            }

            rafId = requestAnimationFrame(draw);
        };

        rafId = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, [cursorRef, ripplesRef]);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 0 }}
        />
    );
}
