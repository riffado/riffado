"use client";

import { useCallback, useState } from "react";
import { SettingsSelectTrigger } from "@/components/settings/settings-select";
import { Button } from "@/components/ui/button";
import { Field, FieldInput } from "@/components/ui/field";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select";
import {
    DEFAULT_SERVER_KEY,
    PLAUD_SERVERS,
    type PlaudServerKey,
} from "@/lib/plaud/servers";
import {
    announceConnected,
    type ConnectFailure,
    failureFromError,
    failureFromResponse,
    postJson,
} from "./connect-request";
import { ConnectErrorNotice, inlineLinkClass } from "./dialog-parts";

const WHY_ISSUE_URL = "https://github.com/riffado/riffado/issues/65";

function pasteGuideHosts(serverKey: PlaudServerKey): {
    webHost: string;
    webOrigin: string;
    apiHint: string;
} {
    if (serverKey === "cn") {
        return {
            webHost: "web.plaud.cn",
            webOrigin: "https://web.plaud.cn",
            apiHint: "api*.plaud.cn",
        };
    }
    return {
        webHost: "web.plaud.ai",
        webOrigin: "https://web.plaud.ai",
        apiHint: "api*.plaud.ai",
    };
}

interface PasteTokenViewProps {
    onConnected: () => void;
    onUseConnector: () => void;
    onUseEmail: () => void;
    /** Preselects the region, e.g. the stored account's server on reconnect. */
    defaultServer?: PlaudServerKey;
    defaultCustomApiBase?: string;
}

/**
 * Manual fallback: paste the `pld_ut` cookie from a signed-in Plaud web
 * session. The connect route rejects workspace tokens and explains why,
 * and its message shows above the button.
 */
export function PasteTokenView({
    onConnected,
    onUseConnector,
    onUseEmail,
    defaultServer = DEFAULT_SERVER_KEY,
    defaultCustomApiBase = "",
}: PasteTokenViewProps) {
    const [token, setToken] = useState("");
    const [serverKey, setServerKey] = useState<PlaudServerKey>(defaultServer);
    const [customApiBase, setCustomApiBase] = useState(defaultCustomApiBase);
    const [isLoading, setIsLoading] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [customError, setCustomError] = useState<string | null>(null);
    const [failure, setFailure] = useState<ConnectFailure | null>(null);

    const apiBase =
        serverKey === "custom"
            ? customApiBase.trim()
            : PLAUD_SERVERS[serverKey].apiBase;
    const { webHost, webOrigin, apiHint } = pasteGuideHosts(serverKey);
    const isChina = serverKey === "cn";

    const submit = useCallback(async () => {
        const trimmed = token.trim().replace(/^Bearer\s+/i, "");
        const missingToken = !trimmed;
        const missingCustom = serverKey === "custom" && !apiBase;
        setTokenError(
            missingToken ? "Paste your Plaud access token first" : null,
        );
        setCustomError(
            missingCustom ? "Enter your custom Plaud API URL" : null,
        );
        if (missingToken || missingCustom) return;
        setFailure(null);
        setIsLoading(true);
        try {
            const res = await postJson("/api/plaud/auth/connect-token", {
                accessToken: trimmed,
                apiBase,
                source: "paste",
            });
            if (!res.ok) {
                setFailure(
                    await failureFromResponse(
                        res,
                        "Couldn't connect with this token",
                        "connect Plaud via pasted access token",
                    ),
                );
                return;
            }
            await announceConnected(res);
            onConnected();
        } catch (err) {
            setFailure(
                failureFromError(err, "Couldn't connect with this token"),
            );
        } finally {
            setIsLoading(false);
        }
    }, [token, apiBase, serverKey, onConnected]);

    return (
        <form
            noValidate
            className="flex flex-col gap-5 px-6 pt-6 pb-6"
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            {isChina ? (
                <p className="text-small text-subtle">
                    The Riffado Connector doesn't cover China (plaud.cn)
                    accounts, so paste a token from {webHost}.
                </p>
            ) : (
                <div className="squircle flex flex-col gap-1 rounded-[var(--radius-inner)] bg-quiet px-3.5 py-3">
                    <p className="text-small font-medium text-strong">
                        Sign in with Plaud or the email code lasts longer
                    </p>
                    <p className="text-small text-subtle">
                        A token copied from the Plaud web app lasts about a day.
                        Sign in with Plaud lasts up to 30 days with Connector
                        0.2.4 or newer, about a day with older versions. The
                        email code lasts 30 days, but only for Plaud accounts
                        that sign in with email and password.{" "}
                        <button
                            type="button"
                            onClick={onUseConnector}
                            className={inlineLinkClass}
                        >
                            Sign in with Plaud
                        </button>{" "}
                        or{" "}
                        <button
                            type="button"
                            onClick={onUseEmail}
                            className={inlineLinkClass}
                        >
                            use the email code
                        </button>
                    </p>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <Field
                    id="plaud-region"
                    label="Plaud region"
                    hint={
                        <>
                            Find it in the host of any{" "}
                            <span className="font-mono">{apiHint}</span> request
                            in your browser's Network tab
                        </>
                    }
                >
                    <Select
                        value={serverKey}
                        onValueChange={(value) => {
                            setServerKey(value as PlaudServerKey);
                            setCustomError(null);
                        }}
                        disabled={isLoading}
                    >
                        <SettingsSelectTrigger
                            id="plaud-region"
                            className="h-11 w-full data-[size=default]:h-11"
                            aria-describedby="plaud-region-message"
                        >
                            <SelectValue />
                        </SettingsSelectTrigger>
                        <SelectContent>
                            {(
                                Object.keys(PLAUD_SERVERS) as PlaudServerKey[]
                            ).map((key) => (
                                <SelectItem key={key} value={key}>
                                    {PLAUD_SERVERS[key].label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                {serverKey === "custom" && (
                    <Field
                        id="plaud-custom-api"
                        label="Custom API URL"
                        error={customError}
                    >
                        <FieldInput
                            type="url"
                            placeholder="https://api-xxx.plaud.ai"
                            value={customApiBase}
                            onChange={(e) => {
                                setCustomApiBase(e.target.value);
                                setCustomError(null);
                            }}
                            disabled={isLoading}
                            className="font-mono sm:text-small"
                        />
                    </Field>
                )}
            </div>

            <Field
                id="plaud-access-token"
                label="Access token"
                hint={
                    isChina
                        ? `Copy it from a signed-in ${webHost} session`
                        : `Copy it from a signed-in ${webHost} session. Tokens are encrypted before they're stored`
                }
                error={tokenError}
            >
                <textarea
                    id="plaud-access-token"
                    placeholder="eyJhbGciOi…"
                    value={token}
                    onChange={(e) => {
                        setToken(e.target.value);
                        setTokenError(null);
                    }}
                    disabled={isLoading}
                    rows={4}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="squircle w-full resize-y rounded-[var(--radius-inner)] border border-input bg-field px-3.5 py-3 font-mono text-small break-all text-strong outline-none transition-[border-color,box-shadow] duration-(--duration-press) ease-[ease] placeholder:text-muted-foreground focus:border-strong focus:ring-[3px] focus:ring-strong/10 disabled:opacity-50 aria-invalid:border-terracotta aria-invalid:ring-[3px] aria-invalid:ring-terracotta/16"
                    aria-describedby="plaud-access-token-message"
                    aria-invalid={tokenError ? true : undefined}
                />
            </Field>

            <details className="group text-small text-subtle">
                <summary className="w-fit cursor-pointer rounded-sm outline-none select-none hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    How do I get my token?
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                    <ol className="ml-4 flex list-decimal flex-col gap-1">
                        <li>
                            Open{" "}
                            <a
                                href={webOrigin}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={inlineLinkClass}
                            >
                                {webHost}
                            </a>{" "}
                            and sign in (Google, Apple or email).
                        </li>
                        <li>
                            Open DevTools (F12), then{" "}
                            <span className="font-medium">Application</span>,{" "}
                            <span className="font-medium">Cookies</span>,{" "}
                            <span className="font-mono">{webOrigin}</span>.
                        </li>
                        <li>
                            Copy the value of{" "}
                            <span className="font-mono">pld_ut</span> (it starts
                            with <span className="font-mono">eyJ</span>) and
                            paste it above. Pick the region matching the{" "}
                            <span className="font-mono">{apiHint}</span> host in
                            the Network tab.
                        </li>
                    </ol>
                    {isChina ? (
                        <p>
                            These steps match web.plaud.ai. They haven't been
                            verified for China accounts, so the cookie name and
                            how long the token lasts may differ on {webHost}.
                        </p>
                    ) : (
                        <p>
                            This token lasts 24 hours. After that, syncing stops
                            until you reconnect.
                        </p>
                    )}
                    <p>
                        Don't copy the Authorization header from a{" "}
                        <span className="font-mono">/device/list</span> or{" "}
                        <span className="font-mono">/file/simple/web</span>{" "}
                        request. That's a workspace token Riffado can't use.{" "}
                        <a
                            href={WHY_ISSUE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={inlineLinkClass}
                        >
                            Why? #65
                        </a>
                    </p>
                </div>
            </details>

            <div className="flex flex-col gap-3">
                <ConnectErrorNotice failure={failure} />
                <Button
                    type="submit"
                    variant="ink"
                    size="control"
                    disabled={isLoading}
                    className="w-full"
                >
                    {isLoading ? "Checking token…" : "Connect with token"}
                </Button>
            </div>
        </form>
    );
}
