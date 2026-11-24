"use client";

import { ArrowDownWideNarrow, Search, X } from "lucide-react";
import type * as React from "react";
import { Button, touchTargetClass } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SortOrder = "newest" | "oldest" | "name";
export type ListDensity = "comfortable" | "compact";

const SORT_LABEL: Record<SortOrder, string> = {
    newest: "Newest first",
    oldest: "Oldest first",
    name: "Name",
};

/**
 * Search field and result count for viewports below `lg`, where the
 * sidebar (and its search field) is hidden.
 */
export function RecordingListToolbar({
    query,
    onQueryChange,
    onEnterSelectFirst,
    searchRef,
    filteredCount,
    totalCount,
}: {
    query: string;
    onQueryChange: (next: string) => void;
    onEnterSelectFirst: () => void;
    searchRef: React.RefObject<HTMLInputElement | null>;
    filteredCount: number;
    totalCount: number;
}) {
    return (
        <div className="flex flex-col gap-2 px-1 pb-3 lg:hidden">
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onEnterSelectFirst();
                        }
                    }}
                    placeholder="Search recordings, transcripts..."
                    className="h-9 pl-8 pr-8"
                    aria-label="Search recordings"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => onQueryChange("")}
                        aria-label="Clear search"
                        className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground",
                            touchTargetClass,
                        )}
                    >
                        <X className="size-4" />
                    </button>
                )}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums select-none">
                {filteredCount}
                {query ? " matching" : ""} of {totalCount} recording
                {totalCount !== 1 ? "s" : ""}
            </span>
        </div>
    );
}

/** Quiet icon menu holding the list's sort order and row density. */
export function ListViewMenu({
    sortOrder,
    onSortOrderChange,
    density,
    onDensityChange,
}: {
    sortOrder: SortOrder;
    onSortOrderChange: (next: SortOrder) => void;
    density: ListDensity;
    onDensityChange: (next: ListDensity) => void;
}) {
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            aria-label={`Sort and density: ${SORT_LABEL[sortOrder]}`}
                            className="text-foreground"
                        >
                            <ArrowDownWideNarrow className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    {SORT_LABEL[sortOrder]}
                </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={sortOrder}
                    onValueChange={(v) => onSortOrderChange(v as SortOrder)}
                >
                    <DropdownMenuRadioItem value="newest">
                        Newest first
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="oldest">
                        Oldest first
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="name">
                        Name
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Density</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={density}
                    onValueChange={(v) => onDensityChange(v as ListDensity)}
                >
                    <DropdownMenuRadioItem value="comfortable">
                        Comfortable
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="compact">
                        Compact
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
