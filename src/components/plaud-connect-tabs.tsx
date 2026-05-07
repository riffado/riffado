"use client";

/**
 * Two-mode Plaud connect form, shared between the onboarding dialog and the
 * standalone /onboarding page.
 *
 * Mode "email" — the existing OTP flow (email → 6-digit code).
 *
 * Mode "token" — paste an access token grabbed from a logged-in
 * web.plaud.ai session. This exists for users whose Plaud account was
 * created via Google or Apple sign-in (issue #65): the OTP flow signs them
 * into a *different*, empty shadow account on Plaud's side, so the only
 * reliable connection method is reusing the token from a real web session.
 *
 * Both modes terminate in the same place — a connection row in
 * plaud_connections — so the parent only needs to know "did the user
 * connect?" via the `onConnected` callback.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseApiError } from "@/lib/api-errors";
import {
    DEFAULT_SERVER_KEY,
    PLAUD_SERVERS,
    type PlaudServerKey,
} from "@/lib/plaud/servers";

const CONNECTOR_CHROME_URL =
    "https://github.com/openplaud/connector#installation";

// Public API contract for the OpenPlaud Connector browser extension.
// Kept in sync with /Users/.../connector/src/page-bridge.ts — if this
// shape changes, bump `version` on both sides.
interface ConnectorBridge {
    version: number;
    connect(): Promise<{
        accessToken: string;
        apiBase: string;
        region: "global" | "euc1" | "apse1" | "unknown";
        capturedAt: number;
    }>;
}

declare global {
    interface Window {
        __openplaudConnector?: ConnectorBridge;
    }
}

type Mode = "connector" | "email" | "token";
type EmailStep = "email" | "code";

const RESEND_COOLDOWN_MS = 30_000;
const ISSUE_URL = "https://github.com/openplaud/openplaud/issues/65";

function regionLabel(base: string): string {
    if (base.includes("euc1")) return "EU (Frankfurt)";
    if (base.includes("apse1")) return "Asia Pacific (Singapore)";
    if (base.includes("api.plaud.ai")) return "Global";
    return base;
}

interface PlaudConnectTabsProps {
    /** Called after a successful connect (either mode). */
    onConnected: () => void;
    /** Compact mode pulls in margins/typography for the dialog surface. */
    variant?: "dialog" | "page";
}

export function PlaudConnectTabs({
    onConnected,
    variant = "dialog",
}: PlaudConnectTabsProps) {
    // Detect the OpenPlaud Connector extension. The page-bridge defines
    // window.__openplaudConnector at document_start, but if the extension
    // gets installed *while* the page is open we never see it; we re-poll
    // a few times for resilience and then give up.
    const [hasConnector, setHasConnector] = useState<boolean>(false);
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            if (cancelled) return;
            const v = window.__openplaudConnector?.version;
            if (typeof v === "number" && v >= 1) setHasConnector(true);
        };
        check();
        const id = window.setInterval(check, 750);
        const stop = window.setTimeout(() => window.clearInterval(id), 10_000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
            window.clearTimeout(stop);
        };
    }, []);

    const [mode, setMode] = useState<Mode>("connector");

    const tabs: { key: Mode; label: string }[] = [
        { key: "connector", label: "Sign in with Plaud" },
        { key: "email", label: "Email code" },
        { key: "token", label: "Paste token" },
    ];

    return (
        <div className="space-y-4">
            <div
                role="tablist"
                aria-label="Plaud connection method"
                className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted/50 border"
            >
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={mode === t.key}
                        onClick={() => setMode(t.key)}
                        className={`px-3 py-1.5 text-sm rounded transition-colors ${
                            mode === t.key
                                ? "bg-background shadow-sm font-medium"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {mode === "connector" && (
                <ConnectorPane
                    onConnected={onConnected}
                    hasConnector={hasConnector}
                    onUseEmail={() => setMode("email")}
                    onUseToken={() => setMode("token")}
                />
            )}
            {mode === "email" && (
                <EmailCodePane
                    onConnected={onConnected}
                    onSwitchToToken={() => setMode("token")}
                    variant={variant}
                />
            )}
            {mode === "token" && (
                <PasteTokenPane onConnected={onConnected} variant={variant} />
            )}
        </div>
    );
}

// ── Connector (browser extension) pane ─────────────────────────────────

interface ConnectorPaneProps {
    onConnected: () => void;
    hasConnector: boolean;
    onUseEmail: () => void;
    onUseToken: () => void;
}

function ConnectorPane({
    onConnected,
    hasConnector,
    onUseEmail,
    onUseToken,
}: ConnectorPaneProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleConnect = useCallback(async () => {
        const bridge = window.__openplaudConnector;
        if (!bridge) {
            toast.error("Connector extension not detected");
            return;
        }
        setIsLoading(true);
        try {
            const payload = await bridge.connect();
            const res = await fetch("/api/plaud/auth/connect-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accessToken: payload.accessToken,
                    apiBase: payload.apiBase,
                    source: "connector",
                }),
            });
            if (!res.ok) {
                const err = await parseApiError(res);
                throw new Error(err.error || "Failed to connect Plaud");
            }
            toast.success("Plaud account connected");
            onConnected();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to connect",
            );
        } finally {
            setIsLoading(false);
        }
    }, [onConnected]);

    if (!hasConnector) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Easiest path: install the{" "}
                    <span className="font-medium">OpenPlaud Connector</span>{" "}
                    browser extension. Sign in to Plaud the way you normally do
                    (Google, Apple, or email) and the connector hands the
                    session back here — no copy-pasting.
                </p>
                <Button asChild className="w-full">
                    <a
                        href={CONNECTOR_CHROME_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Install OpenPlaud Connector
                    </a>
                </Button>
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    Already installed? Reload this page so OpenPlaud can detect
                    it. Or use the{" "}
                    <button
                        type="button"
                        onClick={onUseEmail}
                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
                    >
                        email code
                    </button>{" "}
                    /{" "}
                    <button
                        type="button"
                        onClick={onUseToken}
                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
                    >
                        paste token
                    </button>{" "}
                    methods instead.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
                Click below to sign in to Plaud in a new tab — use Google,
                Apple, or email/password as you normally would. The connector
                will return you here automatically.
            </p>
            <Button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full"
            >
                {isLoading
                    ? "Waiting for plaud.ai sign-in…"
                    : "Continue with Plaud"}
            </Button>
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
                Stuck?{" "}
                <button
                    type="button"
                    onClick={onUseEmail}
                    className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
                >
                    Use email code
                </button>{" "}
                or{" "}
                <button
                    type="button"
                    onClick={onUseToken}
                    className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground"
                >
                    paste token
                </button>
                .
            </p>
        </div>
    );
}

// \u2500\u2500 Email code (OTP) pane \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface EmailCodePaneProps {
    onConnected: () => void;
    onSwitchToToken: () => void;
    variant: "dialog" | "page";
}

function EmailCodePane({
    onConnected,
    onSwitchToToken,
    variant: _variant,
}: EmailCodePaneProps) {
    const [step, setStep] = useState<EmailStep>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [apiBase, setApiBase] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [lastSentAt, setLastSentAt] = useState(0);

    const handleSendCode = useCallback(async () => {
        const trimmed = email.trim();
        if (!trimmed) {
            toast.error("Please enter your Plaud email");
            return;
        }
        const now = Date.now();
        if (now - lastSentAt < RESEND_COOLDOWN_MS) {
            const secs = Math.ceil(
                (RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000,
            );
            toast.error(`Please wait ${secs}s before resending`);
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch("/api/plaud/auth/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: trimmed }),
            });
            if (!res.ok) {
                const err = await parseApiError(res);
                throw new Error(err.error || "Failed to send code");
            }
            const data = await res.json();
            setOtpToken(data.otpToken);
            setApiBase(data.apiBase);
            setLastSentAt(Date.now());
            setStep("code");
            toast.success("Verification code sent — check your email");
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to send code",
            );
        } finally {
            setIsLoading(false);
        }
    }, [email, lastSentAt]);

    const handleVerify = useCallback(async () => {
        const trimmed = code.trim();
        if (!trimmed) {
            toast.error("Please enter the verification code");
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch("/api/plaud/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: trimmed,
                    otpToken,
                    apiBase,
                    email,
                }),
            });
            if (!res.ok) {
                const err = await parseApiError(res);
                throw new Error(err.error || "Verification failed");
            }
            toast.success("Plaud account connected");
            onConnected();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Verification failed",
            );
        } finally {
            setIsLoading(false);
        }
    }, [code, otpToken, apiBase, email, onConnected]);

    if (step === "email") {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="plaud-email">Plaud Email</Label>
                    <Input
                        id="plaud-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                        disabled={isLoading}
                        autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                        The email you use to sign in at plaud.ai. We'll send a
                        verification code via Plaud's servers.
                    </p>
                </div>

                <Button
                    onClick={handleSendCode}
                    disabled={isLoading || !email.trim()}
                    className="w-full"
                >
                    {isLoading
                        ? "Sending code via plaud.ai…"
                        : "Send Verification Code"}
                </Button>

                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    Signed up to Plaud with{" "}
                    <span className="font-medium">Google or Apple</span>? The
                    email-code flow may sign you into a different (empty) Plaud
                    account.{" "}
                    <button
                        type="button"
                        onClick={onSwitchToToken}
                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                    >
                        Use the paste-token method instead.
                    </button>{" "}
                    <a
                        href={ISSUE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                    >
                        #65&nbsp;→
                    </a>
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="otp-code">Verification Code</Label>
                <Input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    disabled={isLoading}
                    className="font-mono text-lg tracking-[0.3em] text-center"
                    autoFocus
                    autoComplete="one-time-code"
                />
                <p className="text-xs text-muted-foreground">
                    Code sent to <span className="font-mono">{email}</span>
                    {apiBase && <span> · Region: {regionLabel(apiBase)}</span>}
                </p>
            </div>

            <Button
                onClick={handleVerify}
                disabled={isLoading || !code.trim()}
                className="w-full"
            >
                {isLoading ? "Verifying with plaud.ai…" : "Connect Account"}
            </Button>

            <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                <button
                    type="button"
                    onClick={() => {
                        setStep("email");
                        setCode("");
                    }}
                    className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors"
                >
                    ← Different email
                </button>
                <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isLoading}
                    className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground transition-colors disabled:opacity-50"
                >
                    Resend code
                </button>
            </div>
        </div>
    );
}

// \u2500\u2500 Paste token pane \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface PasteTokenPaneProps {
    onConnected: () => void;
    variant: "dialog" | "page";
}

function PasteTokenPane({
    onConnected,
    variant: _variant,
}: PasteTokenPaneProps) {
    const [token, setToken] = useState("");
    const [serverKey, setServerKey] =
        useState<PlaudServerKey>(DEFAULT_SERVER_KEY);
    const [customApiBase, setCustomApiBase] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const apiBase =
        serverKey === "custom"
            ? customApiBase.trim()
            : PLAUD_SERVERS[serverKey].apiBase;

    const handleSubmit = useCallback(async () => {
        const trimmed = token.trim().replace(/^Bearer\s+/i, "");
        if (!trimmed) {
            toast.error("Paste your Plaud access token first");
            return;
        }
        if (serverKey === "custom" && !apiBase) {
            toast.error("Enter your custom Plaud API URL");
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch("/api/plaud/auth/connect-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accessToken: trimmed,
                    apiBase,
                    source: "paste",
                }),
            });
            if (!res.ok) {
                const err = await parseApiError(res);
                throw new Error(err.error || "Failed to connect Plaud");
            }
            toast.success("Plaud account connected");
            onConnected();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to connect Plaud",
            );
        } finally {
            setIsLoading(false);
        }
    }, [token, apiBase, serverKey, onConnected]);

    return (
        <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
                For accounts created via Google or Apple sign-in. Paste the
                access token from a logged-in web.plaud.ai session and we'll
                connect it directly.{" "}
                <a
                    href={ISSUE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors"
                >
                    Why? · #65&nbsp;→
                </a>
            </p>

            <div className="space-y-2">
                <Label htmlFor="plaud-region">Plaud region</Label>
                <select
                    id="plaud-region"
                    value={serverKey}
                    onChange={(e) =>
                        setServerKey(e.target.value as PlaudServerKey)
                    }
                    disabled={isLoading}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    {(Object.keys(PLAUD_SERVERS) as PlaudServerKey[]).map(
                        (key) => (
                            <option key={key} value={key}>
                                {PLAUD_SERVERS[key].label}
                            </option>
                        ),
                    )}
                </select>
                {serverKey === "custom" && (
                    <Input
                        type="url"
                        placeholder="https://api-xxx.plaud.ai"
                        value={customApiBase}
                        onChange={(e) => setCustomApiBase(e.target.value)}
                        disabled={isLoading}
                        className="font-mono text-xs"
                    />
                )}
                <p className="text-xs text-muted-foreground">
                    Look at the host of any{" "}
                    <span className="font-mono">api*.plaud.ai</span> request in
                    your devtools Network tab to find the region.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="plaud-access-token">Access token</Label>
                <textarea
                    id="plaud-access-token"
                    placeholder="eyJhbGciOi…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={isLoading}
                    rows={4}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono break-all resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                />
            </div>

            <Button
                onClick={handleSubmit}
                disabled={isLoading || !token.trim()}
                className="w-full"
            >
                {isLoading ? "Validating with plaud.ai…" : "Connect with token"}
            </Button>

            <details className="group">
                <summary className="text-xs text-muted-foreground/80 cursor-pointer hover:text-muted-foreground transition-colors select-none">
                    How do I find my access token?
                </summary>
                <ol className="mt-2 ml-4 space-y-1.5 text-xs text-muted-foreground list-decimal leading-relaxed">
                    <li>
                        Open{" "}
                        <a
                            href="https://web.plaud.ai"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-dotted underline-offset-2"
                        >
                            web.plaud.ai
                        </a>{" "}
                        in another tab and sign in (Google, Apple, or email).
                    </li>
                    <li>
                        Open browser devtools (F12 / Cmd+Option+I) →{" "}
                        <span className="font-medium">Network</span> tab.
                    </li>
                    <li>
                        Refresh web.plaud.ai. Click any request to a host
                        starting with <span className="font-mono">api</span>
                        <span className="font-mono">.plaud.ai</span> or{" "}
                        <span className="font-mono">api-euc1.plaud.ai</span>{" "}
                        etc.
                    </li>
                    <li>
                        Under <span className="font-medium">Headers</span> →{" "}
                        <span className="font-medium">Request Headers</span>,
                        find <span className="font-mono">Authorization</span>.
                        Copy the value <em>after</em>{" "}
                        <span className="font-mono">Bearer</span> and paste it
                        above.
                    </li>
                    <li>
                        Pick the matching region from the dropdown — e.g. if the
                        host was{" "}
                        <span className="font-mono">api-euc1.plaud.ai</span>,
                        choose EU.
                    </li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground/80 leading-relaxed">
                    The token lives ~300 days. It is encrypted (AES-256-GCM)
                    before storage on this instance.
                </p>
            </details>
        </div>
    );
}
