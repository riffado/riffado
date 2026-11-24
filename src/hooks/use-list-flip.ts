"use client";

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

const MAX_AGE_MS = 5000;
const ANIMATION_ID = "list-flip";

function rowTops(container: HTMLElement): Map<string, number> {
    const origin = container.getBoundingClientRect().top;
    const tops = new Map<string, number>();
    for (const node of container.querySelectorAll<HTMLElement>(
        "[data-flip-key]",
    )) {
        const key = node.dataset.flipKey;
        if (key) tops.set(key, node.getBoundingClientRect().top - origin);
    }
    return tops;
}

/**
 * Animates list rows (`[data-flip-key]`) from where they were to where
 * they are after an add or remove. Call `snapshot()` right before the
 * change; renders that don't change the set of keys keep the snapshot
 * for the next one, so an add that lands after a server refresh still
 * animates. Positions are measured against the container, so scrolling
 * in between doesn't count as movement.
 */
export function useListFlip(containerRef: RefObject<HTMLElement | null>) {
    const before = useRef<{ tops: Map<string, number>; at: number } | null>(
        null,
    );

    const snapshot = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        before.current = { tops: rowTops(container), at: performance.now() };
    }, [containerRef]);

    useLayoutEffect(() => {
        const saved = before.current;
        const container = containerRef.current;
        if (!saved || !container) return;
        if (performance.now() - saved.at > MAX_AGE_MS) {
            before.current = null;
            return;
        }
        const nodes = [
            ...container.querySelectorAll<HTMLElement>("[data-flip-key]"),
        ];
        const keys = nodes.map((n) => n.dataset.flipKey ?? "");
        const sameKeys =
            keys.length === saved.tops.size &&
            keys.every((k) => saved.tops.has(k));
        if (sameKeys) return;
        before.current = null;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }

        for (const node of nodes) {
            for (const animation of node.getAnimations()) {
                if (animation.id === ANIMATION_ID) animation.cancel();
            }
        }

        const root = getComputedStyle(document.documentElement);
        const duration =
            Number.parseFloat(root.getPropertyValue("--duration-reflow")) ||
            200;
        const move =
            root.getPropertyValue("--ease-in-out").trim() || "ease-in-out";
        const enter = root.getPropertyValue("--ease-out").trim() || "ease-out";
        const origin = container.getBoundingClientRect().top;
        const viewport = window.innerHeight;
        for (const node of nodes) {
            const key = node.dataset.flipKey;
            if (!key) continue;
            const rect = node.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > viewport) continue;
            const old = saved.tops.get(key);
            if (old === undefined) {
                node.animate([{ opacity: 0 }, { opacity: 1 }], {
                    id: ANIMATION_ID,
                    duration,
                    easing: enter,
                });
                continue;
            }
            const dy = old - (rect.top - origin);
            if (Math.abs(dy) < 1) continue;
            node.animate(
                [
                    { transform: `translateY(${dy}px)` },
                    { transform: "translateY(0)" },
                ],
                { id: ANIMATION_ID, duration, easing: move },
            );
        }
    });

    return { snapshot };
}
