"use client";

import { useTheme } from "next-themes";
import {
    type Ref,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {
    CAPTCHA_RESPONSE_HEADER,
    type TurnstileAction,
} from "@/lib/turnstile-shared";

const SCRIPT_SRC =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const DEFAULT_TOKEN_WAIT_MS = 8_000;

interface TurnstileRenderOptions {
    sitekey: string;
    action?: string;
    theme?: "auto" | "light" | "dark";
    size?: "normal" | "flexible" | "compact";
    appearance?: "always" | "execute" | "interaction-only";
    callback?: (token: string) => void;
    "expired-callback"?: () => void;
    "error-callback"?: (errorCode: string) => void;
    "timeout-callback"?: () => void;
}

interface TurnstileApi {
    render: (
        container: HTMLElement,
        options: TurnstileRenderOptions,
    ) => string | undefined;
    reset: (widgetId: string) => void;
    remove: (widgetId: string) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.onload = () => {
            if (window.turnstile) {
                resolve(window.turnstile);
            } else {
                scriptPromise = null;
                reject(new Error("Turnstile script loaded without its API"));
            }
        };
        script.onerror = () => {
            scriptPromise = null;
            script.remove();
            reject(new Error("Failed to load the Turnstile script"));
        };
        document.head.appendChild(script);
    });
    return scriptPromise;
}

/** Toast copy when no Turnstile token arrives before submit gives up waiting. */
export const CAPTCHA_PENDING_MESSAGE =
    "The security check didn't finish. Complete it if shown, then try again.";

/**
 * Fetch options that attach a Turnstile token to a Better Auth client call.
 * Returns undefined when there is no token (Turnstile disabled).
 */
export function captchaFetchOptions(
    token: string | null,
): { headers: Record<string, string> } | undefined {
    if (!token) return undefined;
    return { headers: { [CAPTCHA_RESPONSE_HEADER]: token } };
}

/** Imperative handle for {@link TurnstileWidget}. */
export interface TurnstileWidgetHandle {
    /**
     * Resolves with the current token, waiting up to `timeoutMs` for the
     * check to finish. Resolves null on timeout or when the check failed.
     */
    getToken: (timeoutMs?: number) => Promise<string | null>;
    /** Discards the current token and requests a fresh one. Tokens are single-use. */
    reset: () => void;
}

interface TurnstileWidgetProps {
    siteKey: string;
    action: TurnstileAction;
    ref?: Ref<TurnstileWidgetHandle>;
}

type WidgetStatus = "loading" | "ready" | "error" | "load-failed";

/**
 * Cloudflare Turnstile widget rendered in `interaction-only` mode: invisible
 * for most visitors, expands only when Cloudflare needs an interaction.
 * Read the token through the ref handle at submit time.
 */
export function TurnstileWidget({
    siteKey,
    action,
    ref,
}: TurnstileWidgetProps) {
    const { resolvedTheme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);
    const waitersRef = useRef<Array<(token: string | null) => void>>([]);
    const failedRef = useRef(false);
    const [status, setStatus] = useState<WidgetStatus>("loading");

    const theme =
        resolvedTheme === "dark" || resolvedTheme === "light"
            ? resolvedTheme
            : null;

    useImperativeHandle(
        ref,
        () => ({
            getToken: (timeoutMs = DEFAULT_TOKEN_WAIT_MS) => {
                if (tokenRef.current) return Promise.resolve(tokenRef.current);
                if (failedRef.current) return Promise.resolve(null);
                return new Promise<string | null>((resolve) => {
                    const waiter = (token: string | null) => {
                        clearTimeout(timer);
                        resolve(token);
                    };
                    const timer = setTimeout(() => {
                        waitersRef.current = waitersRef.current.filter(
                            (w) => w !== waiter,
                        );
                        resolve(null);
                    }, timeoutMs);
                    waitersRef.current.push(waiter);
                });
            },
            reset: () => {
                tokenRef.current = null;
                const widgetId = widgetIdRef.current;
                if (widgetId && window.turnstile) {
                    failedRef.current = false;
                    setStatus("loading");
                    window.turnstile.reset(widgetId);
                }
            },
        }),
        [],
    );

    useEffect(() => {
        if (!theme) return;
        let cancelled = false;

        const settle = (token: string | null) => {
            tokenRef.current = token;
            failedRef.current = token === null;
            const waiters = waitersRef.current;
            waitersRef.current = [];
            for (const waiter of waiters) waiter(token);
        };

        loadTurnstile()
            .then((api) => {
                const container = containerRef.current;
                if (cancelled || !container) return;
                widgetIdRef.current =
                    api.render(container, {
                        sitekey: siteKey,
                        action,
                        theme,
                        size: "flexible",
                        appearance: "interaction-only",
                        callback: (token) => {
                            setStatus("ready");
                            settle(token);
                        },
                        "expired-callback": () => {
                            tokenRef.current = null;
                        },
                        "error-callback": () => {
                            setStatus("error");
                            settle(null);
                        },
                        "timeout-callback": () => {
                            tokenRef.current = null;
                        },
                    }) ?? null;
            })
            .catch(() => {
                if (cancelled) return;
                setStatus("load-failed");
                settle(null);
            });

        return () => {
            cancelled = true;
            tokenRef.current = null;
            failedRef.current = false;
            const widgetId = widgetIdRef.current;
            widgetIdRef.current = null;
            if (widgetId && window.turnstile) {
                window.turnstile.remove(widgetId);
            }
        };
    }, [siteKey, action, theme]);

    return (
        <div>
            <div ref={containerRef} />
            {status === "load-failed" ? (
                <p className="text-xs text-destructive" role="alert">
                    The security check could not load. Allow
                    challenges.cloudflare.com in your content blocker, then
                    reload the page.
                </p>
            ) : status === "error" ? (
                <p className="text-xs text-destructive" role="alert">
                    The security check could not complete. Reload the page to
                    try again.
                </p>
            ) : null}
        </div>
    );
}
