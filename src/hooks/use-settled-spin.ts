"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Tailwind's `animate-spin` is `spin 1s linear infinite`. */
const SPIN_PERIOD_MS = 1000;
const SETTLE_MS = 400;

/**
 * Keeps a spinning icon turning until it can stop on a resting angle.
 * RefreshCw is symmetric under a half turn, so it settles on the next
 * multiple of 180 degrees instead of snapping back to 0.
 *
 * Put `ref` on the icon and add `animate-spin` while `spinning` is true.
 */
export function useSettledSpin(active: boolean) {
    const ref = useRef<SVGSVGElement>(null);
    const [spinning, setSpinning] = useState(active);

    useLayoutEffect(() => {
        if (active) {
            setSpinning(true);
            return;
        }
        const el = ref.current;
        if (typeof el?.getAnimations !== "function") {
            setSpinning(false);
            return;
        }
        const spin = el
            .getAnimations()
            .find(
                (a): a is CSSAnimation =>
                    typeof CSSAnimation !== "undefined" &&
                    a instanceof CSSAnimation &&
                    a.animationName === "spin",
            );
        const time = spin?.currentTime;
        setSpinning(false);
        if (typeof time !== "number") return;
        const angle = ((time % SPIN_PERIOD_MS) / SPIN_PERIOD_MS) * 360;
        const rest = Math.ceil(angle / 180) * 180;
        if (rest - angle < 6) return;
        const easing =
            getComputedStyle(document.documentElement)
                .getPropertyValue("--ease-out")
                .trim() || "ease-out";
        el.animate(
            [
                { transform: `rotate(${angle}deg)` },
                { transform: `rotate(${rest}deg)` },
            ],
            { duration: SETTLE_MS, easing },
        );
    }, [active]);

    return { ref, spinning };
}
