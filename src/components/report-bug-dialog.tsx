"use client";

import { ArrowUpRight, Mail } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import {
    DialogHeading,
    settingsDialogClass,
} from "@/components/settings/form-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { buildReportBugMailto, buildReportBugUrl } from "@/lib/report-bug";
import { cn } from "@/lib/utils";
import { APP_VERSION_TAG } from "@/lib/version";

interface ReportBugDialogProps {
    isHosted: boolean;
    /** Optional correlation id from `details.errorId` on a 5xx response. */
    errorId?: string;
    /** Optional one-line summary of what the user was doing. */
    errorContext?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Element that gets focus back when the dialog closes. The dialog has
     * no Radix trigger, so without it focus drops to the page.
     */
    returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The bug-report dialog: the details Riffado fills in (what you were
 * doing, error id, page, version, mode), then the ways to send them:
 *   - "Open a GitHub issue": always.
 *   - "Email us": hosted only. Self-hosters aren't our customers and
 *     `support@riffado.com` would just confuse them; they should file
 *     on GitHub.
 *
 * Both open outside the app (GitHub in a new tab, the mailto in the
 * user's mail client) with the same details pre-filled.
 */
export function ReportBugDialog({
    isHosted,
    errorId,
    errorContext,
    open,
    onOpenChange,
    returnFocusTo,
}: ReportBugDialogProps) {
    const page =
        typeof window !== "undefined" ? window.location.pathname : undefined;
    const opts = { isHosted, errorId, errorContext, page };
    const githubUrl = buildReportBugUrl(opts);
    const mailtoUrl = buildReportBugMailto(opts);
    const details: { label: string; value: string; mono?: boolean }[] = [
        ...(errorContext
            ? [{ label: "While trying to", value: errorContext }]
            : []),
        ...(errorId ? [{ label: "Error id", value: errorId, mono: true }] : []),
        ...(page ? [{ label: "Page", value: page, mono: true }] : []),
        { label: "Version", value: APP_VERSION_TAG, mono: true },
        {
            label: "Mode",
            value: isHosted ? "Hosted (riffado.com)" : "Self-hosted",
        },
    ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(settingsDialogClass, "sm:max-w-120")}
                onCloseAutoFocus={(event) => {
                    const target = returnFocusTo?.current;
                    if (!target?.isConnected) return;
                    event.preventDefault();
                    target.focus({ preventScroll: true });
                }}
            >
                <DialogHeading
                    title="Report a bug"
                    description="We fill in these details. Add what you were doing and what went wrong."
                />

                <div className="flex flex-col gap-1.5">
                    <p className="text-sm leading-5 font-medium text-strong">
                        Filled in for you
                    </p>
                    <dl className="squircle flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-hairline bg-surface px-3.5 py-3 dark:border-night-border dark:bg-night">
                        {details.map((row) => (
                            <div key={row.label} className="flex gap-2.5">
                                <dt className="w-28 shrink-0 text-small leading-5 text-muted-foreground">
                                    {row.label}
                                </dt>
                                <dd
                                    className={cn(
                                        "min-w-0 leading-5 break-words text-foreground",
                                        row.mono
                                            ? "font-mono text-xs leading-5"
                                            : "text-small",
                                    )}
                                >
                                    {row.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {isHosted ? (
                        <Button variant="bordered" size="dialog" asChild>
                            <a
                                href={mailtoUrl}
                                rel="noopener noreferrer"
                                onClick={() => onOpenChange(false)}
                            >
                                <Mail />
                                Email us
                            </a>
                        </Button>
                    ) : null}
                    <Button variant="ink" size="dialog" asChild>
                        <a
                            href={githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => onOpenChange(false)}
                        >
                            Open a GitHub issue
                            <ArrowUpRight />
                        </a>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface ReportBugButtonProps {
    isHosted: boolean;
    /** Optional className for the trigger \u2014 lets the footer style it inline. */
    className?: string;
}

/**
 * Footer trigger for the bug-report dialog. Kept as a thin wrapper so the
 * server-rendered footer can mount it without itself becoming a client
 * component beyond this leaf.
 *
 * The button is reset to look like the surrounding inline `<Link>` siblings
 * (no border, no padding, no background, inherited font) so it doesn't get
 * the browser-default button chrome.
 */
const RESET_BUTTON_CLASSES =
    "appearance-none border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer";

export function ReportBugButton({ isHosted, className }: ReportBugButtonProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen(true)}
                className={`${RESET_BUTTON_CLASSES} ${className ?? ""}`}
            >
                Report a bug
            </button>
            <ReportBugDialog
                isHosted={isHosted}
                open={open}
                onOpenChange={setOpen}
                returnFocusTo={buttonRef}
            />
        </>
    );
}
