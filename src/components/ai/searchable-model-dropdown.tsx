"use client";

import { ChevronDown, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ModelOption {
    id: string;
    name: string;
}

interface SearchableModelDropdownProps {
    models: ModelOption[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    /** Label shown on the trigger when nothing matches the current value. */
    placeholder?: string;
    /** Extra classes merged onto the trigger button (e.g. compact sizing). */
    triggerClassName?: string;
    /**
     * Fixed entry pinned to the top of the list — e.g. a "Provider default"
     * row mapped to the empty value. Hidden while the user is searching.
     */
    emptyOption?: { value: string; label: string };
    /**
     * When true, a search query that doesn't exactly match a model id offers a
     * row that commits the typed text verbatim as the model id (free-form
     * entry), and Enter accepts it. Lets users name a model the server didn't
     * advertise.
     */
    allowCustomText?: boolean;
    /**
     * Optional footer rendered under the list. Receives a `close` callback so
     * the caller can dismiss the popover after acting.
     */
    footer?: (close: () => void) => ReactNode;
}

const TRIGGER_BASE_CLASS =
    "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono";

const ITEM_BASE_CLASS =
    "w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors";

/**
 * A combobox for choosing a model: click to open, type to filter, and
 * (optionally) type a custom model id the server didn't list. Used both in the
 * provider settings dialog and the generate / re-generate panel so the two
 * stay visually and behaviourally identical.
 */
export function SearchableModelDropdown({
    models,
    value,
    onChange,
    disabled,
    placeholder = "Select a model",
    triggerClassName,
    emptyOption,
    allowCustomText,
    footer,
}: SearchableModelDropdownProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        }
        window.addEventListener("mousedown", handleClick);
        return () => window.removeEventListener("mousedown", handleClick);
    }, [open]);

    useEffect(() => {
        if (open) {
            setSearch("");
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const query = search.trim();
    const filtered = useMemo(() => {
        if (!query) return models;
        const q = query.toLowerCase();
        return models.filter((m) => m.name.toLowerCase().includes(q));
    }, [models, query]);

    const selectedLabel =
        (emptyOption && value === emptyOption.value && emptyOption.label) ||
        models.find((m) => m.id === value)?.name ||
        value ||
        placeholder;

    const commit = (next: string) => {
        onChange(next);
        setOpen(false);
    };

    // Offer "Use <query>" only when the typed text isn't already an exact id.
    const showCustomRow =
        !!allowCustomText &&
        query.length > 0 &&
        !models.some((m) => m.id === query);

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(!open)}
                className={cn(TRIGGER_BASE_CLASS, triggerClassName)}
            >
                <span className="truncate text-left flex-1">
                    {selectedLabel}
                </span>
                <ChevronDown className="size-4 opacity-50 shrink-0 ml-2" />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
                    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                        <Search className="size-3.5 text-muted-foreground shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                if (filtered.length > 0) commit(filtered[0].id);
                                else if (showCustomRow) commit(query);
                            }}
                            placeholder={`Search ${models.length} models...`}
                            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {!query && emptyOption && (
                            <button
                                type="button"
                                onClick={() => commit(emptyOption.value)}
                                className={cn(
                                    ITEM_BASE_CLASS,
                                    value === emptyOption.value &&
                                        "bg-accent/50 text-accent-foreground",
                                )}
                            >
                                {emptyOption.label}
                            </button>
                        )}
                        {filtered.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => commit(m.id)}
                                className={cn(
                                    ITEM_BASE_CLASS,
                                    "font-mono",
                                    m.id === value &&
                                        "bg-accent/50 text-accent-foreground",
                                )}
                            >
                                {m.name}
                            </button>
                        ))}
                        {showCustomRow && (
                            <button
                                type="button"
                                onClick={() => commit(query)}
                                className={cn(ITEM_BASE_CLASS, "font-mono")}
                            >
                                Use "{query}"
                            </button>
                        )}
                        {filtered.length === 0 && !showCustomRow && (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                {query
                                    ? `No models matching "${query}"`
                                    : "No models available"}
                            </div>
                        )}
                    </div>
                    {footer && (
                        <div className="border-t border-border/50 px-3 py-1.5">
                            {footer(() => setOpen(false))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
