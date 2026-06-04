"use client";

import { ArrowDownAZ, Rows3, Search, X } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export type SortOrder = "newest" | "oldest" | "name";
export type ListDensity = "comfortable" | "compact";

export function RecordingListToolbar({
    query,
    onQueryChange,
    onEnterSelectFirst,
    searchRef,
    filteredCount,
    totalCount,
    sortOrder,
    onSortOrderChange,
    density,
    onDensityChange,
}: {
    query: string;
    onQueryChange: (next: string) => void;
    onEnterSelectFirst: () => void;
    searchRef: React.RefObject<HTMLInputElement | null>;
    filteredCount: number;
    totalCount: number;
    sortOrder: SortOrder;
    onSortOrderChange: (next: SortOrder) => void;
    density: ListDensity;
    onDensityChange: (next: ListDensity) => void;
}) {
    return (
        <div className="flex flex-col gap-2 border-b border-border/40 px-4 py-3">
            {/* Title row */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                    All files
                </h2>
                <span className="text-xs text-muted-foreground/50 font-mono tabular-nums">
                    {query
                        ? `${filteredCount} of ${totalCount}`
                        : totalCount.toString()}
                </span>
            </div>

            {/* Search bar */}
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
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
                    placeholder="Search recordings…"
                    className="h-8 bg-transparent pl-8 pr-8 text-sm placeholder:text-muted-foreground/30 border-border/40 dark:bg-muted/15 rounded-lg"
                    aria-label="Search recordings"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => onQueryChange("")}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </div>

            {/* Sort / density controls */}
            <div className="flex items-center justify-end px-0.5">
                <div className="flex items-center gap-0.5">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/60 hover:text-foreground"
                                aria-label="Sort"
                            >
                                <ArrowDownAZ className="size-3" />
                                {sortOrder === "newest"
                                    ? "Newest"
                                    : sortOrder === "oldest"
                                      ? "Oldest"
                                      : "Name"}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuLabel className="text-[11px]">
                                Sort by
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={sortOrder}
                                onValueChange={(v) =>
                                    onSortOrderChange(v as SortOrder)
                                }
                            >
                                <DropdownMenuRadioItem
                                    value="newest"
                                    className="text-xs"
                                >
                                    Newest first
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="oldest"
                                    className="text-xs"
                                >
                                    Oldest first
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="name"
                                    className="text-xs"
                                >
                                    Name
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/60 hover:text-foreground"
                                aria-label="Density"
                            >
                                <Rows3 className="size-3" />
                                {density === "compact"
                                    ? "Compact"
                                    : "Comfortable"}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuLabel className="text-[11px]">
                                Density
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={density}
                                onValueChange={(v) =>
                                    onDensityChange(v as ListDensity)
                                }
                            >
                                <DropdownMenuRadioItem
                                    value="comfortable"
                                    className="text-xs"
                                >
                                    Comfortable
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="compact"
                                    className="text-xs"
                                >
                                    Compact
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
}
