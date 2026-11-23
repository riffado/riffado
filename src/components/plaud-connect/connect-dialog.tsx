"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DotLoader } from "@/components/ui/dot-loader";
import type { PlaudServerKey } from "@/lib/plaud/servers";
import { cn } from "@/lib/utils";
import {
    announceConnected,
    type ConnectFailure,
    failureFromError,
    failureFromResponse,
    postJson,
} from "./connect-request";
import { type ConnectStep, ConnectSteps } from "./connect-steps";
import { CONNECTOR_INSTALL_URL, useConnectorDetected } from "./connector";
import {
    ConnectErrorNotice,
    ConnectHeader,
    inlineLinkClass,
} from "./dialog-parts";
import { EmailCodeView } from "./email-code-view";
import { PasteTokenView } from "./paste-token-view";
import { plaudServerPhrase } from "./server-label";

/** Which part of the connect dialog is showing. */
export type PlaudConnectView = "main" | "email" | "token";

/**
 * `connect`: first connection. `reconnect`: the same account signs in
 * again and the dialog names it. `switch`: the old account was unlinked
 * and another one signs in.
 */
export type PlaudConnectIntent = "connect" | "reconnect" | "switch";

/** Why a reconnect is offered, for the dialog's one line of context. */
export type PlaudReconnectReason = "signed-out" | "ending-soon";

/** The stored Plaud account, as `/api/plaud/connection` reports it. */
export interface PlaudAccountSummary {
    email: string | null;
    server?: PlaudServerKey;
    apiBase?: string;
}

/** How long a connector sign-in lasts, by connector version (AGENTS.md). */
export const CONNECTOR_DURATION_NOTE =
    "Up to 30 days with Connector 0.2.4 or newer; older versions about a day";

const SUB_VIEW_COPY = {
    email: {
        title: "Email code",
        description: "Plaud emails you a code. Works without the extension",
    },
    token: {
        title: "Paste a token",
        description: "For servers or browsers where the extension can't run",
    },
} as const;

interface PlaudConnectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Called once Plaud is connected, after the "Plaud account connected"
     * toast. The caller closes the dialog here.
     */
    onConnected: () => void;
    intent?: PlaudConnectIntent;
    /** View shown when the dialog opens. Defaults to the main view. */
    initialView?: PlaudConnectView;
    /**
     * The account to name on reconnect. Leave undefined and the dialog
     * reads it from `/api/plaud/connection` when it opens.
     */
    account?: PlaudAccountSummary | null;
    reason?: PlaudReconnectReason | null;
    /** Formatted end of the current sign-in, for the ending-soon line. */
    endsOn?: string | null;
}

/**
 * The one Connect Plaud dialog: Sign in with Plaud through the Riffado
 * Connector first, Email code and Paste a token as other ways inside the
 * same dialog. Used by first run, the reconnect banner and Settings.
 */
export function PlaudConnectDialog({
    open,
    onOpenChange,
    ...flowProps
}: PlaudConnectDialogProps) {
    // The dialogs are opened from buttons outside a DialogTrigger, so
    // Radix has nothing to return focus to on close.
    const returnFocus = useRef<HTMLElement | null>(null);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-120"
                onOpenAutoFocus={() => {
                    const active = document.activeElement;
                    returnFocus.current =
                        active instanceof HTMLElement &&
                        active !== document.body
                            ? active
                            : null;
                }}
                onCloseAutoFocus={(event) => {
                    const target = returnFocus.current;
                    returnFocus.current = null;
                    if (target?.isConnected) {
                        event.preventDefault();
                        target.focus({ preventScroll: true });
                    }
                }}
            >
                <ConnectFlow {...flowProps} />
            </DialogContent>
        </Dialog>
    );
}

function useStoredAccount(enabled: boolean): {
    account: PlaudAccountSummary | null;
    loading: boolean;
} {
    const [account, setAccount] = useState<PlaudAccountSummary | null>(null);
    const [loading, setLoading] = useState(enabled);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        fetch("/api/plaud/connection")
            .then((res) => (res.ok ? res.json() : null))
            .then(
                (
                    data: {
                        connected?: boolean;
                        plaudEmail?: string | null;
                        server?: PlaudServerKey;
                        apiBase?: string;
                    } | null,
                ) => {
                    if (cancelled || !data?.connected) return;
                    setAccount({
                        email: data.plaudEmail ?? null,
                        server: data.server,
                        apiBase: data.apiBase,
                    });
                },
            )
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled]);
    return { account, loading };
}

function reconnectBody(
    reason: PlaudReconnectReason | null | undefined,
    endsOn: string | null | undefined,
): string {
    if (reason === "signed-out") {
        return "Plaud ended the session Riffado was using. Sign in with the same account and syncing picks up where it stopped.";
    }
    if (reason === "ending-soon" && endsOn) {
        return `Your Plaud connection ends on ${endsOn}. Sign in with the same account to keep syncing.`;
    }
    return "Sign in with the same account to renew the connection. Syncing carries on as before.";
}

function ConnectFlow({
    onConnected,
    intent = "connect",
    initialView = "main",
    account: accountProp,
    reason,
    endsOn,
}: Omit<PlaudConnectDialogProps, "open" | "onOpenChange">) {
    const hasConnector = useConnectorDetected();
    const fetched = useStoredAccount(
        intent === "reconnect" && accountProp === undefined,
    );
    const account = accountProp === undefined ? fetched.account : accountProp;
    const accountLoading = accountProp === undefined && fetched.loading;

    const [view, setView] = useState<PlaudConnectView>(initialView);
    const [direction, setDirection] = useState<"forward" | "back" | null>(null);
    const [waiting, setWaiting] = useState(false);
    const [failure, setFailure] = useState<ConnectFailure | null>(null);
    const [installOpened, setInstallOpened] = useState(false);

    const backRef = useRef<HTMLButtonElement>(null);
    const emailRowRef = useRef<HTMLButtonElement>(null);
    const tokenRowRef = useRef<HTMLButtonElement>(null);
    const primaryRef = useRef<HTMLElement>(null);
    const statusRef = useRef<HTMLOutputElement>(null);
    const returnFocus = useRef<"email" | "token" | "primary">("primary");

    /**
     * Back to main returns focus to the row that opened the view, unless
     * the view asked for the primary action ("Use Sign in with Plaud").
     */
    const showView = useCallback(
        (next: PlaudConnectView, focusPrimary = false) => {
            if (next === view) return;
            if (next === "main") {
                returnFocus.current =
                    focusPrimary || view === "main" ? "primary" : view;
            }
            setDirection(next === "main" ? "back" : "forward");
            setView(next);
        },
        [view],
    );

    useEffect(() => {
        if (direction === null) return;
        if (view === "token") {
            backRef.current?.focus();
        } else if (view === "main") {
            const target =
                returnFocus.current === "email"
                    ? emailRowRef.current
                    : returnFocus.current === "token"
                      ? tokenRowRef.current
                      : primaryRef.current;
            target?.focus();
        }
    }, [view, direction]);

    const wasWaiting = useRef(false);
    useEffect(() => {
        if (waiting) {
            statusRef.current?.focus();
        } else if (
            wasWaiting.current &&
            (document.activeElement === document.body ||
                document.activeElement?.getAttribute("role") === "dialog")
        ) {
            primaryRef.current?.focus();
        }
        wasWaiting.current = waiting;
    }, [waiting]);

    const connectWithConnector = useCallback(async () => {
        const bridge = window.__riffadoConnector;
        if (!bridge) {
            setFailure({
                message:
                    "Riffado Connector isn't answering. Reload this page and try again",
            });
            return;
        }
        setFailure(null);
        setWaiting(true);
        try {
            const payload = await bridge.connect();
            const res = await postJson("/api/plaud/auth/connect-token", {
                accessToken: payload.accessToken,
                ...(typeof payload.refreshToken === "string" &&
                payload.refreshToken
                    ? { refreshToken: payload.refreshToken }
                    : {}),
                apiBase: payload.apiBase,
                source: "connector",
            });
            if (!res.ok) {
                setFailure(
                    await failureFromResponse(
                        res,
                        "Couldn't connect Plaud",
                        "connect Plaud via connector extension",
                    ),
                );
                return;
            }
            await announceConnected(res);
            onConnected();
        } catch (err) {
            setFailure(failureFromError(err, "Couldn't connect Plaud"));
        } finally {
            setWaiting(false);
        }
    }, [onConnected]);

    const animation = cn(
        direction !== null &&
            "animate-in fade-in duration-(--duration-push-in) ease-(--ease-out) motion-reduce:slide-in-from-left-0 motion-reduce:slide-in-from-right-0",
        direction === "forward" && "slide-in-from-right-6",
        direction === "back" && "slide-in-from-left-6",
    );

    if (view !== "main") {
        const copy = SUB_VIEW_COPY[view];
        return (
            <div key={view} className={animation}>
                <ConnectHeader
                    title={copy.title}
                    description={copy.description}
                    onBack={() => showView("main")}
                    backRef={backRef}
                />
                {view === "email" ? (
                    <EmailCodeView
                        onConnected={onConnected}
                        onUseConnector={() => showView("main", true)}
                        defaultEmail={
                            intent === "reconnect" ? account?.email : null
                        }
                    />
                ) : (
                    <PasteTokenView
                        onConnected={onConnected}
                        onUseConnector={() => showView("main", true)}
                        onUseEmail={() => showView("email")}
                        defaultServer={
                            intent === "reconnect" ? account?.server : undefined
                        }
                        defaultCustomApiBase={
                            intent === "reconnect"
                                ? account?.apiBase
                                : undefined
                        }
                    />
                )}
            </div>
        );
    }

    let title: string;
    let description: React.ReactNode;
    if (intent === "reconnect") {
        title = "Sign in to Plaud again";
        const server = plaudServerPhrase(account?.server, account?.apiBase);
        const parts = [account?.email, server].filter(Boolean);
        description = accountLoading ? (
            <span
                aria-hidden="true"
                className="inline-block h-3.5 w-56 max-w-full animate-pulse rounded-full bg-surface align-middle"
            />
        ) : parts.length > 0 ? (
            parts.join(" · ")
        ) : (
            "Use the same Plaud account as before"
        );
    } else if (intent === "switch") {
        title = "Sign in to another Plaud account";
        description = "Your recordings stay. New ones come from this account";
    } else {
        title = "Connect your Plaud account";
        description = "New recordings sync here from your Plaud account";
    }

    const steps: ConnectStep[] = hasConnector
        ? [
              { title: "Riffado Connector added", state: "done" },
              {
                  title: "Sign in to Plaud as you usually do",
                  description:
                      "Google, Apple or email. Riffado never sees your password",
                  state: waiting ? "working" : "todo",
              },
              {
                  title: "Come back here, connected",
                  description: CONNECTOR_DURATION_NOTE,
                  state: "todo",
              },
          ]
        : [
              {
                  title: "Add Riffado Connector to your browser",
                  description:
                      "A small extension for Chrome. It passes your Plaud sign-in to Riffado",
                  state: "todo",
              },
              {
                  title: "Sign in to Plaud as you usually do",
                  description:
                      "Google, Apple or email. Riffado never sees your password",
                  state: "todo",
              },
              {
                  title: "Come back here, connected",
                  description: "Your recordings start syncing right away",
                  state: "todo",
              },
          ];

    let note: React.ReactNode;
    if (!hasConnector) {
        note = installOpened ? (
            <>
                Added it?{" "}
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className={inlineLinkClass}
                >
                    Reload this page
                </button>{" "}
                so Riffado can find it
            </>
        ) : (
            "Stays connected for up to 30 days. We'll ask you to sign in again after that"
        );
    } else if (waiting) {
        note =
            "Finish signing in on the plaud.ai tab. This dialog updates by itself";
    } else if (intent === "reconnect") {
        note = `Opens plaud.ai in a new tab. ${CONNECTOR_DURATION_NOTE}`;
    } else {
        note = "Opens plaud.ai in a new tab";
    }

    return (
        <div key={view} className={animation}>
            <ConnectHeader title={title} description={description} />

            {intent === "reconnect" ? (
                <p className="px-6 pt-5 text-dialog-body text-foreground">
                    {reconnectBody(reason, endsOn)}
                </p>
            ) : (
                <ConnectSteps steps={steps} className="px-6 pt-6" />
            )}

            <div className="flex flex-col gap-2.5 p-6">
                <ConnectErrorNotice failure={failure} className="mb-1" />
                {!hasConnector ? (
                    <Button
                        asChild
                        variant="ink"
                        size="control"
                        className="w-full"
                    >
                        <a
                            ref={(node) => {
                                primaryRef.current = node;
                            }}
                            href={CONNECTOR_INSTALL_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setInstallOpened(true)}
                        >
                            Add Riffado Connector
                        </a>
                    </Button>
                ) : waiting ? (
                    <output
                        ref={statusRef}
                        tabIndex={-1}
                        className="squircle flex h-11 w-full items-center justify-center gap-2.5 rounded-[var(--radius-control)] bg-accent text-[15px] font-semibold text-strong outline-none dark:bg-night-border"
                    >
                        <DotLoader />
                        Waiting for plaud.ai sign-in…
                    </output>
                ) : (
                    <Button
                        ref={(node) => {
                            primaryRef.current = node;
                        }}
                        type="button"
                        variant="ink"
                        size="control"
                        onClick={() => void connectWithConnector()}
                        className="w-full"
                    >
                        Continue with Plaud
                        {intent === "reconnect" && (
                            <ArrowUpRight
                                aria-hidden="true"
                                className="size-3.5"
                            />
                        )}
                    </Button>
                )}
                <p className="text-center text-xs text-balance text-muted-foreground">
                    {note}
                </p>
            </div>

            <div className="flex flex-col border-t border-hairline bg-dialog-footer pt-2 pb-3">
                <p className="px-6 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                    Other ways to connect
                </p>
                <OtherWayRow
                    ref={emailRowRef}
                    title={SUB_VIEW_COPY.email.title}
                    description={SUB_VIEW_COPY.email.description}
                    onClick={() => showView("email")}
                />
                <OtherWayRow
                    ref={tokenRowRef}
                    title={SUB_VIEW_COPY.token.title}
                    description={SUB_VIEW_COPY.token.description}
                    onClick={() => showView("token")}
                />
            </div>
        </div>
    );
}

function OtherWayRow({
    ref,
    title,
    description,
    onClick,
}: {
    ref: React.Ref<HTMLButtonElement>;
    title: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3 px-6 py-3 text-left outline-none transition-colors duration-150 select-none hover:bg-accent focus-visible:bg-accent dark:hover:bg-night-raised dark:focus-visible:bg-night-raised"
        >
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-ui font-medium text-strong">{title}</span>
                <span className="text-small leading-4.5 text-subtle">
                    {description}
                </span>
            </span>
            <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
            />
        </button>
    );
}
