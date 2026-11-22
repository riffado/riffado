"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PromptListItem {
    id: string;
    name: string;
    description?: string;
    /** True for the prompt currently in use. */
    active: boolean;
}

/**
 * A titled list of prompts (built-in or the user's own) as hairline rows,
 * with View and, for the user's own, Edit and Delete. Shared by the
 * summary and title prompt settings.
 */
export function PromptList({
    title,
    items,
    emptyText,
    addLabel,
    onAdd,
    onView,
    onEdit,
    onDelete,
}: {
    title: string;
    items: PromptListItem[];
    /** Shown instead of rows when `items` is empty. No trailing period. */
    emptyText?: string;
    addLabel?: string;
    onAdd?: () => void;
    onView: (id: string) => void;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 pt-4">
            <div className="flex min-h-8 items-center justify-between gap-4">
                <h3 className="text-row font-semibold text-strong">{title}</h3>
                {onAdd && addLabel && (
                    <Button variant="quiet" size="compact" onClick={onAdd}>
                        <Plus />
                        {addLabel}
                    </Button>
                )}
            </div>
            {items.length === 0 ? (
                emptyText ? (
                    <p className="border-y border-hairline py-4 text-ui text-subtle">
                        {emptyText}
                    </p>
                ) : null
            ) : (
                <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
                    {items.map((item) => (
                        <li
                            key={item.id}
                            className="flex items-center gap-4 py-3"
                        >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-ui font-medium text-strong">
                                    {item.name}
                                    {item.active && (
                                        <span className="font-normal text-subtle">
                                            {" "}
                                            · In use
                                        </span>
                                    )}
                                </span>
                                {item.description && (
                                    <span className="text-small leading-4 text-subtle">
                                        {item.description}
                                    </span>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="compact"
                                    onClick={() => onView(item.id)}
                                >
                                    View
                                </Button>
                                {onEdit && (
                                    <Button
                                        variant="ghost"
                                        size="icon-compact"
                                        onClick={() => onEdit(item.id)}
                                        aria-label={`Edit ${item.name}`}
                                    >
                                        <Pencil />
                                    </Button>
                                )}
                                {onDelete && (
                                    <Button
                                        variant="ghost"
                                        size="icon-compact"
                                        onClick={() => onDelete(item.id)}
                                        aria-label={`Delete ${item.name}`}
                                    >
                                        <Trash2 />
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
