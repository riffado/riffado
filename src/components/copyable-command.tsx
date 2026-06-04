"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Single-line shell command with a copy-to-clipboard button. Styled to
 * match the dark code blocks already used in the `Deploy` landing
 * section so it reads as "a thing you paste into a terminal," not as
 * generic site chrome.
 *
 * Kept deliberately small and prop-driven so it can be reused later
 * (docs pages, settings hints) without dragging page-specific styling
 * along. Client component because clipboard access requires it.
 */
export function CopyableCommand({
    command,
    ariaLabel,
}: {
    command: string;
    ariaLabel?: string;
}) {
    const [copied, setCopied] = useState(false);
    // Tracked so we can cancel a pending "flip back to Copy" timer if
    // the component unmounts (route change, parent re-render) before
    // it fires. Modern React no-ops setState-after-unmount silently,
    // but cancelling the timer is the cheap correct thing.
    const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimerRef.current !== null) {
                clearTimeout(resetTimerRef.current);
            }
        };
    }, []);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            if (resetTimerRef.current !== null) {
                clearTimeout(resetTimerRef.current);
            }
            // 1.6s is long enough to read "Copied" without lingering
            // past the user's next interaction.
            resetTimerRef.current = setTimeout(() => {
                setCopied(false);
                resetTimerRef.current = null;
            }, 1600);
        } catch {
            // Clipboard write can reject in iframes, insecure contexts,
            // or when the user denies permission. Swallow rather than
            // throw -- the command text is still selectable manually.
        }
    }

    return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-50 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900">
                <div className="text-xs font-mono text-zinc-500">
                    ~/mesynx-ai
                </div>
            </div>
            <div className="flex items-center gap-3 p-4 font-mono text-sm">
                <div className="flex-1 overflow-x-auto">
                    <span className="text-zinc-500">$ </span>
                    <span className="text-zinc-100 whitespace-nowrap">
                        {command}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={ariaLabel ?? "Copy command"}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:border-zinc-700 transition-colors"
                >
                    {copied ? (
                        <>
                            <Check className="size-3.5 text-green-400" />
                            <span>Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="size-3.5" />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
