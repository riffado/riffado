"use client";

import { useCallback, useRef, useState } from "react";
import type { Provider } from "@/components/settings-sections/providers-section";

const FRESH_FOR_MS = 30_000;

/**
 * Client-side copy of the user's AI providers for the Settings dialog.
 *
 * - `providers` is null until the first load finishes.
 * - `prefetch()` loads `/api/settings/ai/providers` unless a request is
 *   already in flight or the list was loaded in the last 30 seconds. Call
 *   it on intent (hover/focus of a Settings trigger) and when Settings opens.
 * - `replaceProviders()` stores a list the Providers section re-read after
 *   a change. Responses from requests started before it are dropped.
 */
export function useProviderList() {
    const [providers, setProviders] = useState<Provider[] | null>(null);
    const inFlight = useRef(false);
    const loadedAt = useRef(0);
    const generation = useRef(0);

    const prefetch = useCallback(() => {
        if (inFlight.current) return;
        if (Date.now() - loadedAt.current < FRESH_FOR_MS) return;
        inFlight.current = true;
        const requestGeneration = generation.current;
        fetch("/api/settings/ai/providers")
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<{ providers?: Provider[] }>;
            })
            .then((data) => {
                if (requestGeneration !== generation.current) return;
                loadedAt.current = Date.now();
                setProviders(data.providers ?? []);
            })
            .catch(() => {
                if (requestGeneration !== generation.current) return;
                setProviders((prev) => prev ?? []);
            })
            .finally(() => {
                inFlight.current = false;
            });
    }, []);

    const replaceProviders = useCallback((next: Provider[]) => {
        generation.current++;
        loadedAt.current = Date.now();
        setProviders(next);
    }, []);

    return { providers, prefetch, replaceProviders };
}
