"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    getAllSummaryPrompts,
    getDefaultSummaryPromptConfig,
    type SummaryPromptConfiguration,
} from "@/lib/ai/summary-presets";

export interface SummaryPromptOption {
    id: string;
    name: string;
    isPreset: boolean;
}

/** The summary styles a user can pick, and which one Summarize uses. */
export interface SummaryPrompts {
    /** Built-in presets first, then the user's own prompts. */
    options: SummaryPromptOption[];
    /** Prompt a plain Summarize uses: the saved default until one is picked. */
    selectedId: string;
    /** Makes `id` the prompt Summarize uses for the rest of the session. */
    select: (id: string) => void;
}

function toOptions(config: SummaryPromptConfiguration): SummaryPromptOption[] {
    return getAllSummaryPrompts(config).map((p) => ({
        id: p.id,
        name: p.name,
        isPreset: p.isPreset,
    }));
}

/**
 * Loads the user's saved default prompt and custom prompts once
 * (`/api/settings/user`). Pass `enabled: false` when a parent already
 * owns a `SummaryPrompts` and this instance only exists to satisfy the
 * rules of hooks.
 */
export function useSummaryPrompts({
    enabled = true,
}: {
    enabled?: boolean;
} = {}): SummaryPrompts {
    const [selectedId, setSelectedId] = useState("general");
    const [options, setOptions] = useState<SummaryPromptOption[]>(() =>
        toOptions(getDefaultSummaryPromptConfig()),
    );
    // Set the moment the user makes an explicit choice, so a settings
    // fetch that resolves afterwards can't revert it to the saved default.
    const userSelectedRef = useRef(false);

    const select = useCallback((id: string) => {
        userSelectedRef.current = true;
        setSelectedId(id);
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        fetch("/api/settings/user", { signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const config = data?.summaryPrompt as
                    | SummaryPromptConfiguration
                    | null
                    | undefined;
                if (!config) return;
                if (config.selectedPrompt && !userSelectedRef.current) {
                    setSelectedId(config.selectedPrompt);
                }
                setOptions(toOptions(config));
            })
            .catch(() => {});
        return () => controller.abort();
    }, [enabled]);

    return useMemo(
        () => ({ options, selectedId, select }),
        [options, selectedId, select],
    );
}
