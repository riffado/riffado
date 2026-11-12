"use client";

import { useState } from "react";
import { MetalButton } from "@/components/metal-button";

type TestState =
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "ok"; detail: string }
    | { kind: "fail"; detail: string };

interface ProviderTestButtonProps {
    provider: string;
    apiKey?: string;
    baseUrl: string;
    defaultModel: string;
    /**
     * Edit dialog: id of the stored credential. When the API-key field is
     * blank, the test runs against the stored key instead of being
     * disabled (keys are never re-shown, but testing them must work).
     */
    providerId?: string;
    disabled?: boolean;
}

/**
 * "Test provider" button for the Add/Edit provider dialogs, with the
 * result rendered as a colored badge next to it. Probes the CURRENT form
 * values via /api/settings/ai/providers/test — nothing is persisted.
 *
 * - Chat providers: mini chat ("Reply with OK").
 * - Transcription providers: 2s synthetic test audio through the same
 *   code path production transcription uses for that provider style.
 */
export function ProviderTestButton({
    provider,
    apiKey,
    baseUrl,
    defaultModel,
    providerId,
    disabled = false,
}: ProviderTestButtonProps) {
    const [state, setState] = useState<TestState>({ kind: "idle" });

    const handleTest = async () => {
        if (!provider || (!apiKey && !providerId)) return;
        setState({ kind: "testing" });
        try {
            const response = await fetch("/api/settings/ai/providers/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(providerId ? { providerId } : {}),
                    provider,
                    ...(apiKey ? { apiKey } : {}),
                    baseUrl: baseUrl || null,
                    defaultModel: defaultModel || null,
                }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data) {
                setState({
                    kind: "fail",
                    detail: data?.error || `Test failed (${response.status})`,
                });
                return;
            }
            setState(
                data.ok
                    ? {
                          kind: "ok",
                          detail: data.detail || "Connection OK",
                      }
                    : {
                          kind: "fail",
                          detail: data.detail || "Test failed",
                      },
            );
        } catch (error) {
            setState({
                kind: "fail",
                detail: error instanceof Error ? error.message : "Test failed",
            });
        }
    };

    const canTest =
        Boolean(provider) &&
        (Boolean(apiKey) || Boolean(providerId)) &&
        !disabled;

    return (
        <div className="flex items-center gap-2">
            <MetalButton
                type="button"
                onClick={handleTest}
                disabled={!canTest || state.kind === "testing"}
            >
                {state.kind === "testing" ? "Testing..." : "Test"}
            </MetalButton>
            {state.kind === "ok" && (
                <span
                    data-testid="provider-test-badge"
                    className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300"
                    title={state.detail}
                >
                    ✓ {state.detail}
                </span>
            )}
            {state.kind === "fail" && (
                <span
                    data-testid="provider-test-badge"
                    className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-300"
                    title={state.detail}
                >
                    ✗ {state.detail}
                </span>
            )}
        </div>
    );
}
