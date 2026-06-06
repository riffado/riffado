import { useCallback, useRef } from "react";

interface UseLongPressOptions {
    /** How long to hold before firing (ms). Default 500. */
    delay?: number;
    /** Max pointer movement before cancelling (px). Default 8. */
    moveThreshold?: number;
    onLongPress: () => void;
}

/**
 * Detects a long-press gesture on any element.
 *
 * Attach the returned handlers to the element's `onPointerDown`,
 * `onPointerMove`, `onPointerUp`, and `onPointerCancel` props.
 * The long-press callback fires after `delay` ms if the pointer
 * has not moved more than `moveThreshold` px or been released.
 *
 * After a long-press fires, the subsequent `click` event is
 * suppressed for that interaction.
 */
export function useLongPress({
    delay = 500,
    moveThreshold = 8,
    onLongPress,
}: UseLongPressOptions) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPosRef = useRef<{ x: number; y: number } | null>(null);
    const didFireRef = useRef(false);

    const cancel = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startPosRef.current = null;
    }, []);

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            // Only primary pointer (left mouse / first touch).
            if (e.button !== 0 && e.pointerType === "mouse") return;
            didFireRef.current = false;
            startPosRef.current = { x: e.clientX, y: e.clientY };
            timerRef.current = setTimeout(() => {
                didFireRef.current = true;
                onLongPress();
                cancel();
            }, delay);
        },
        [delay, onLongPress, cancel],
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!startPosRef.current) return;
            const dx = e.clientX - startPosRef.current.x;
            const dy = e.clientY - startPosRef.current.y;
            if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
                cancel();
            }
        },
        [moveThreshold, cancel],
    );

    const onPointerUp = useCallback(() => cancel(), [cancel]);
    const onPointerCancel = useCallback(() => cancel(), [cancel]);

    /** Suppress the click that follows a long-press. */
    const onClick = useCallback((e: React.MouseEvent) => {
        if (didFireRef.current) {
            e.preventDefault();
            e.stopPropagation();
            didFireRef.current = false;
        }
    }, []);

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onClick,
    };
}
