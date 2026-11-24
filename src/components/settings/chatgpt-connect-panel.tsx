"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChatGptConnectPanelProps {
    /** Called after the connection is saved server-side. */
    onConnected: () => void;
    onCancel?: () => void;
    /** Reconnecting an existing connection (changes copy only). */
    reconnect?: boolean;
}

/**
 * "Sign in with ChatGPT" for self-hosted Riffado.
 *
 * OpenAI only redirects to http://127.0.0.1, which can't reach a server
 * on another machine. So the browser ends on a page that fails to load,
 * and the user pastes that page's address back here. The server
 * finishes the sign-in with the PKCE verifier it kept.
 */
export function ChatGptConnectPanel({
    onConnected,
    onCancel,
    reconnect = false,
}: ChatGptConnectPanelProps) {
    const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
    const [callbackUrl, setCallbackUrl] = useState("");
    const [isStarting, setIsStarting] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);

    const handleStart = async () => {
        // Open the tab synchronously so popup blockers allow it, then
        // point it at OpenAI once we have the URL.
        const tab = window.open("about:blank", "_blank");
        setIsStarting(true);
        try {
            const response = await fetch("/api/settings/ai/chatgpt/start", {
                method: "POST",
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || typeof data?.authorizeUrl !== "string") {
                throw new Error(
                    data?.error || "Couldn't start the ChatGPT sign-in",
                );
            }
            setAuthorizeUrl(data.authorizeUrl);
            setCallbackUrl("");
            if (tab) {
                tab.opener = null;
                tab.location.href = data.authorizeUrl;
            }
        } catch (error) {
            tab?.close();
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Couldn't start the ChatGPT sign-in",
            );
        } finally {
            setIsStarting(false);
        }
    };

    const handleComplete = async () => {
        if (!callbackUrl.trim()) {
            toast.error("Paste the URL from your browser first");
            return;
        }
        setIsCompleting(true);
        try {
            const response = await fetch("/api/settings/ai/chatgpt/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ callbackUrl: callbackUrl.trim() }),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || "ChatGPT sign-in failed");
            }
            const email = data?.provider?.accountEmail;
            toast.success(
                email ? `ChatGPT connected (${email})` : "ChatGPT connected",
            );
            setAuthorizeUrl(null);
            setCallbackUrl("");
            onConnected();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "ChatGPT sign-in failed",
            );
        } finally {
            setIsCompleting(false);
        }
    };

    const busy = isStarting || isCompleting;

    return (
        <div className="space-y-4">
            <Panel variant="inset" className="space-y-2 text-sm">
                <p>
                    Use your ChatGPT plan for summaries and titles instead of an
                    API key. Transcription still needs another provider.
                </p>
                <p className="text-xs text-muted-foreground">
                    Requests count toward your ChatGPT plan&apos;s usage. You
                    can cap or revoke Riffado&apos;s access in ChatGPT settings.
                </p>
            </Panel>

            <div className="space-y-2">
                <Label>Step 1</Label>
                <MetalButton
                    type="button"
                    variant="cyan"
                    onClick={handleStart}
                    disabled={busy}
                    className="w-full"
                >
                    {isStarting
                        ? "Opening ChatGPT..."
                        : reconnect
                          ? "Reconnect with ChatGPT"
                          : "Sign in with ChatGPT"}
                </MetalButton>
                {authorizeUrl && (
                    <a
                        href={authorizeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground underline"
                    >
                        <ExternalLink className="size-3" />
                        Tab didn&apos;t open? Open the ChatGPT sign-in page
                    </a>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="chatgptCallbackUrl">Step 2</Label>
                <p className="text-xs text-muted-foreground">
                    After you approve, the tab lands on a page that won&apos;t
                    load (an address starting with{" "}
                    <code className="font-mono">http://127.0.0.1</code>).
                    That&apos;s expected. Copy the full address from that tab
                    and paste it here.
                </p>
                <Input
                    id="chatgptCallbackUrl"
                    type="text"
                    placeholder="http://127.0.0.1:1455/auth/callback?code=..."
                    value={callbackUrl}
                    onChange={(e) => setCallbackUrl(e.target.value)}
                    disabled={busy || !authorizeUrl}
                    className="font-mono text-sm"
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>

            <div className="flex gap-2">
                {onCancel && (
                    <MetalButton
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="flex-1"
                    >
                        Cancel
                    </MetalButton>
                )}
                <MetalButton
                    type="button"
                    variant="cyan"
                    onClick={handleComplete}
                    disabled={busy || !authorizeUrl || !callbackUrl.trim()}
                    className="flex-1"
                >
                    {isCompleting ? "Connecting..." : "Connect"}
                </MetalButton>
            </div>
        </div>
    );
}
