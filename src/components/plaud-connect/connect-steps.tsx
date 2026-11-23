"use client";

import { Check } from "lucide-react";
import type * as React from "react";
import { DotLoader } from "@/components/ui/dot-loader";
import { cn } from "@/lib/utils";

/** Where one connect step stands. */
export type ConnectStepState = "todo" | "working" | "done";

export interface ConnectStep {
    title: string;
    description?: string;
    state: ConnectStepState;
}

const STATE_LABEL: Record<ConnectStepState, string> = {
    todo: "",
    working: "In progress: ",
    done: "Done: ",
};

function StepMarker({
    index,
    state,
}: {
    index: number;
    state: ConnectStepState;
}) {
    if (state === "done") {
        return (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-strong text-background">
                <Check className="size-3.5" strokeWidth={2.6} />
            </span>
        );
    }
    if (state === "working") {
        return (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-strong text-strong">
                <DotLoader size="small" />
            </span>
        );
    }
    return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-foreground">
            {index + 1}
        </span>
    );
}

/**
 * Numbered steps joined by a hairline (Paper: System 05, connect steps).
 * A done step shows a check and drops its description; a working step
 * shows the dot loader.
 */
export function ConnectSteps({
    steps,
    className,
}: {
    steps: ConnectStep[];
    className?: string;
}): React.ReactElement {
    return (
        <ol className={cn("flex flex-col", className)}>
            {steps.map((step, i) => {
                const last = i === steps.length - 1;
                return (
                    <li key={step.title} className="flex gap-3.5">
                        <div
                            aria-hidden="true"
                            className="flex w-6 shrink-0 flex-col items-center"
                        >
                            <StepMarker index={i} state={step.state} />
                            {!last && (
                                <span className="min-h-3.5 w-px grow bg-border" />
                            )}
                        </div>
                        <div
                            className={cn(
                                "flex min-w-0 flex-col gap-0.5 pt-0.5",
                                !last && "pb-4",
                            )}
                        >
                            <p
                                className={cn(
                                    "text-ui font-medium",
                                    step.state === "done"
                                        ? "text-subtle"
                                        : "text-strong",
                                )}
                            >
                                <span className="sr-only">
                                    {STATE_LABEL[step.state]}
                                </span>
                                {step.title}
                            </p>
                            {step.description && step.state !== "done" && (
                                <p className="text-small leading-4.5 text-balance text-subtle">
                                    {step.description}
                                </p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
