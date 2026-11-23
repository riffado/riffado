import { cn } from "@/lib/utils";

/* Phase offsets for the three dots, a third of the breathe cycle apart. */
const DOT_DELAYS = ["0ms", "-333ms", "-666ms"] as const;
/* Static fall-off shown under reduced motion (Paper: System 05). */
const REDUCED_OPACITY = [
    "",
    "motion-reduce:opacity-55",
    "motion-reduce:opacity-25",
] as const;

const dotClass = {
    /** 4px dots, for buttons and status lines. */
    default: "size-1",
    /** 3px dots, inside a 24px step circle. */
    small: "size-[3px]",
} as const;

const gapClass = {
    default: "gap-0.75",
    small: "gap-0.5",
} as const;

/**
 * Three dots that breathe in turn while something waits (a sign-in in
 * another tab, a slow request). Under reduced motion the dots hold a
 * static fall-off. Decorative: pair it with a text label.
 */
export function DotLoader({
    size = "default",
    className,
}: {
    size?: keyof typeof dotClass;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "inline-flex items-center",
                gapClass[size],
                className,
            )}
        >
            {DOT_DELAYS.map((delay, i) => (
                <span
                    key={delay}
                    className={cn(
                        "motion-breathe shrink-0 rounded-full bg-current",
                        dotClass[size],
                        REDUCED_OPACITY[i],
                    )}
                    style={{ animationDelay: delay }}
                />
            ))}
        </span>
    );
}
