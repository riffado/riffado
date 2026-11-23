"use client";

import { ChevronLeft } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import type { ConnectFailure } from "./connect-request";

/** Inline text button inside running copy. */
export const inlineLinkClass =
    "rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Dialog header: title and one subtitle line, clear of the close button. */
export function ConnectHeader({
    title,
    description,
    onBack,
    backRef,
}: {
    title: React.ReactNode;
    description: React.ReactNode;
    /** Shows a back button that returns to the main view. */
    onBack?: () => void;
    backRef?: React.Ref<HTMLButtonElement>;
}) {
    return (
        <div className="flex items-start gap-2 pt-6 pr-14 pl-6">
            {onBack && (
                <Button
                    ref={backRef}
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    onClick={onBack}
                    aria-label="Back to all ways to connect"
                    className="mt-1 -ml-1.5 shrink-0 text-subtle hover:text-strong"
                >
                    <ChevronLeft />
                </Button>
            )}
            <div className="flex min-w-0 flex-col gap-1.5 pt-1">
                <DialogTitle className="text-strong">{title}</DialogTitle>
                <DialogDescription className="text-ui leading-5 text-subtle">
                    {description}
                </DialogDescription>
            </div>
        </div>
    );
}

/** A failed dialog action, shown above the dialog's buttons. */
export function ConnectErrorNotice({
    failure,
    className,
}: {
    failure: ConnectFailure | null;
    className?: string;
}) {
    if (!failure) return null;
    return (
        <FieldError role="alert" className={className}>
            {failure.message}
            {failure.reportUrl && (
                <>
                    {" "}
                    <a
                        href={failure.reportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={inlineLinkClass}
                    >
                        Report this
                    </a>
                </>
            )}
        </FieldError>
    );
}
