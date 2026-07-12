"use client";

import {
    ChevronRight,
    FolderInput,
    FolderOpen,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getFiletagIcon } from "@/lib/plaud/filetag-icons";
import { cn } from "@/lib/utils";
import type { Filetag } from "@/types/filetag";

export type FiletagFilter = "all" | "none" | string;

const COLLAPSED_STORAGE_KEY = "riffado.filetagRail.collapsed";

interface FiletagRailProps {
    filetags: Filetag[];
    /** Recording counts over the unfiltered list. */
    counts: { total: number; unorganized: number; byTag: Map<string, number> };
    activeFilter: FiletagFilter;
    onFilterChange: (filter: FiletagFilter) => void;
    onCreate: () => void;
    onEdit: (filetag: Filetag) => void;
    onDelete: (filetag: Filetag) => void;
}

function RailRow({
    active,
    onClick,
    icon,
    label,
    count,
    localBadge,
    actions,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    count: number;
    localBadge?: boolean;
    actions?: React.ReactNode;
}) {
    return (
        <div className="group/tag relative">
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60",
                    active && "bg-accent font-medium",
                )}
            >
                {icon}
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate">{label}</span>
                    {localBadge && (
                        <span className="shrink-0 rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            local
                        </span>
                    )}
                </span>
                <span
                    className={cn(
                        "shrink-0 text-right text-xs tabular-nums text-muted-foreground",
                        // Reserve at least the footprint of the hover actions
                        // button (size-8 at right-1) so it swaps in over the
                        // count alone and never covers the local badge.
                        actions && "min-w-8 group-hover/tag:opacity-0",
                    )}
                >
                    {count}
                </span>
            </button>
            {actions && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tag:opacity-100 has-[[data-state=open]]:opacity-100">
                    {actions}
                </div>
            )}
        </div>
    );
}

/**
 * Collapsible directory section at the top of the recording-list card
 * (a third grid column would starve the detail pane and break the
 * mobile master/detail toggle). Filters the list client-side; all
 * directory management flows (create/edit/delete) are delegated up.
 */
export function FiletagRail({
    filetags,
    counts,
    activeFilter,
    onFilterChange,
    onCreate,
    onEdit,
    onDelete,
}: FiletagRailProps) {
    const [collapsed, setCollapsed] = useState(false);

    // localStorage is unavailable during SSR; hydrate the persisted
    // collapse state after mount.
    useEffect(() => {
        try {
            setCollapsed(
                localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true",
            );
        } catch {
            // Private mode / storage disabled: keep default (expanded).
        }
    }, []);

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
            } catch {
                // Best-effort persistence only.
            }
            return next;
        });
    };

    return (
        <div className="border-b px-2 py-2">
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 transition-colors hover:text-foreground"
                    aria-expanded={!collapsed}
                >
                    <ChevronRight
                        className={cn(
                            "size-3 transition-transform",
                            !collapsed && "rotate-90",
                        )}
                    />
                    Directories
                </button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="New directory"
                    onClick={onCreate}
                >
                    <Plus className="size-4" />
                </Button>
            </div>

            {!collapsed && (
                <div className="mt-1 space-y-0.5">
                    <RailRow
                        active={activeFilter === "all"}
                        onClick={() => onFilterChange("all")}
                        icon={
                            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                        }
                        label="All recordings"
                        count={counts.total}
                    />
                    {filetags.map((tag) => {
                        const Icon = getFiletagIcon(tag.icon);
                        return (
                            <RailRow
                                key={tag.id}
                                active={activeFilter === tag.id}
                                onClick={() => onFilterChange(tag.id)}
                                icon={
                                    <Icon
                                        className="size-4 shrink-0"
                                        style={{ color: tag.color }}
                                    />
                                }
                                label={tag.name}
                                count={counts.byTag.get(tag.id) ?? 0}
                                localBadge={tag.isLocalOnly}
                                actions={
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={`Actions for ${tag.name}`}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onSelect={() => onEdit(tag)}
                                            >
                                                <Pencil />
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                variant="destructive"
                                                onSelect={() => onDelete(tag)}
                                            >
                                                <Trash2 />
                                                Delete
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                }
                            />
                        );
                    })}
                    <RailRow
                        active={activeFilter === "none"}
                        onClick={() => onFilterChange("none")}
                        icon={
                            <FolderInput className="size-4 shrink-0 text-muted-foreground" />
                        }
                        label="No directory"
                        count={counts.unorganized}
                    />
                </div>
            )}
        </div>
    );
}
