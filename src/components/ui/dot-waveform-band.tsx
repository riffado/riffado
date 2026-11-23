import { cn } from "@/lib/utils";

/**
 * Dots per column, left to right, from the Paper "Dot-waveform band"
 * (01 Foundations > System > 05). Odd counts keep each column centred.
 */
const COLUMNS = [
    1, 3, 7, 7, 7, 7, 5, 1, 1, 1, 1, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 3, 5, 5, 5, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 5, 5,
    5, 5, 5, 5, 5, 7, 5, 5, 3, 3, 1, 1, 1, 1, 1, 1, 1, 3, 5, 7, 7, 7, 7, 5, 5,
    5, 9, 7, 7, 7, 7, 7, 5, 5, 5, 7, 7, 5, 5, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 3, 5, 5, 7, 7, 5, 7, 9, 9, 7, 9, 9, 9, 9, 7, 5, 5, 7, 7, 5, 5, 3, 3,
    1, 1, 1, 1, 1, 3, 5, 5, 5, 5, 5, 7, 7, 5, 5, 7, 7, 7, 5, 5, 5, 5, 5, 5, 3,
    1, 1, 1, 1, 1, 1, 1, 3, 7, 9, 7, 7, 9, 9, 7, 3, 1, 1, 1, 1, 5, 7, 9, 9, 11,
    9, 13, 13, 9, 11,
];

const STEP = 8;
const RADIUS = 2;
const WIDTH = COLUMNS.length * STEP;
const HEIGHT = 150;

function bandPath(): string {
    const parts: string[] = [];
    COLUMNS.forEach((count, column) => {
        const cx = column * STEP + STEP / 2;
        for (let k = 0; k < count; k++) {
            const cy = HEIGHT / 2 + (k - (count - 1) / 2) * STEP;
            parts.push(
                `M${cx - RADIUS} ${cy}a${RADIUS} ${RADIUS} 0 1 0 ${RADIUS * 2} 0a${RADIUS} ${RADIUS} 0 1 0 ${-RADIUS * 2} 0`,
            );
        }
    });
    return parts.join("");
}

const PATH = bandPath();

/**
 * The static dot-waveform band that sits along the bottom of the sign-in
 * pages, their only decoration. Drawn in `currentColor` (hairline by
 * default) so it follows the theme; it never animates. Position it with
 * `className` (it is 150px tall and crops its sides on narrow screens).
 */
export function DotWaveformBand({ className }: { className?: string }) {
    return (
        <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            focusable="false"
            className={cn(
                "pointer-events-none block h-37.5 w-full text-border",
                className,
            )}
        >
            <path d={PATH} fill="currentColor" />
        </svg>
    );
}
