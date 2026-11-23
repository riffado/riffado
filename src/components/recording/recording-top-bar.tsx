"use client";

import { ChevronLeft, MoreHorizontal } from "lucide-react";
import {
    type RecordingActionHandlers,
    RecordingActionsContent,
    type RecordingActionsState,
} from "@/components/recording/recording-actions";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusLine } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

interface Props {
    title: string;
    origin: string | null;
    back?: { label: string; onBack: () => void; showOnDesktop?: boolean };
    /** State and handlers for the More menu's recording action list. */
    actions: RecordingActionsState & RecordingActionHandlers;
}

/**
 * Recording top bar: small title (or a back link on phones), where the
 * transcript came from, and a More menu with the recording action list
 * (Download audio lives there).
 */
export function RecordingTopBar({ title, origin, back, actions }: Props) {
    return (
        <div className="flex h-13 shrink-0 items-center justify-between gap-4 px-2 lg:h-16 lg:pr-6 lg:pl-10">
            <div className="flex min-w-0 items-center gap-1">
                {back ? (
                    <button
                        type="button"
                        onClick={back.onBack}
                        className={cn(
                            "flex h-11 shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] pr-2.5 pl-1 text-base font-medium text-strong outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-8 lg:text-ui",
                            !back.showOnDesktop && "lg:hidden",
                            back.showOnDesktop && "lg:-ml-3",
                        )}
                    >
                        <ChevronLeft
                            className="size-5.5 lg:size-4.5"
                            strokeWidth={1.9}
                        />
                        {back.label}
                    </button>
                ) : null}
                <p
                    className={cn(
                        "truncate text-ui font-medium text-strong max-lg:hidden",
                        back?.showOnDesktop && "lg:pl-2",
                    )}
                >
                    {title}
                </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {origin ? (
                    <StatusLine
                        tone="ready"
                        className="mr-1 text-small text-subtle max-lg:hidden"
                    >
                        {origin}
                    </StatusLine>
                ) : null}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="More actions"
                            className="max-lg:size-11 max-lg:rounded-[var(--radius-control)] data-[state=open]:bg-accent"
                        >
                            <MoreHorizontal className="size-4.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <RecordingActionsContent
                        flavour="dropdown"
                        align="end"
                        {...actions}
                    />
                </DropdownMenu>
            </div>
        </div>
    );
}
