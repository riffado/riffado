"use client";

import { ArrowDownAZ, Rows3, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
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
    const t = useTranslations("dashboard.list");
    const tDashboard = useTranslations("dashboard");
    return (
        <div className="flex flex-col gap-2 border-b p-3">
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
                    placeholder={t("searchPlaceholder")}
                    className="h-9 pl-8 pr-8"
                    aria-label={t("searchLabel")}
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => onQueryChange("")}
                        aria-label={t("clearSearch")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                        <X className="size-4" />
                    </button>
                )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {t("ofCount", {
                        filtered: filteredCount,
                        matchingSuffix: query ? t("matchingSuffix") : "",
                        total: totalCount,
                        recordingLabel: t("recordingsLabel", {
                            count: totalCount,
                        }),
                    })}
                </span>
                <div className="flex items-center gap-1">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                aria-label={t("sort")}
                            >
                                <ArrowDownAZ className="size-3.5" />
                                <span>
                                    {sortOrder === "newest"
                                        ? tDashboard("newest")
                                        : sortOrder === "oldest"
                                          ? tDashboard("oldest")
                                          : t("byName")}
                                </span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={sortOrder}
                                onValueChange={(v) =>
                                    onSortOrderChange(v as SortOrder)
                                }
                            >
                                <DropdownMenuRadioItem value="newest">
                                    {t("newestFirst")}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="oldest">
                                    {t("oldestFirst")}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="name">
                                    {t("byName")}
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                aria-label={t("density")}
                            >
                                <Rows3 className="size-3.5" />
                                <span>
                                    {density === "compact"
                                        ? t("compactDensity")
                                        : tDashboard("comfortable")}
                                </span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>
                                {t("density")}
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={density}
                                onValueChange={(v) =>
                                    onDensityChange(v as ListDensity)
                                }
                            >
                                <DropdownMenuRadioItem value="comfortable">
                                    {tDashboard("comfortable")}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="compact">
                                    {t("compactDensity")}
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
}
