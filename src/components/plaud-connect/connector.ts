"use client";

import { useEffect, useState } from "react";

/** Where the Riffado Connector extension is installed from. */
export const CONNECTOR_INSTALL_URL =
    "https://github.com/riffado/connector#installation";

/** What the connector hands back after a Plaud sign-in. */
export interface ConnectorPayload {
    accessToken: string;
    /** Plaud refresh token (`pld_urt`). Omitted by older connector versions. */
    refreshToken?: string;
    apiBase: string;
    region: "global" | "euc1" | "apse1" | "unknown";
    capturedAt: number;
}

/** API contract for the Riffado Connector extension; bump `version` on both sides. */
export interface ConnectorBridge {
    version: number;
    connect(): Promise<ConnectorPayload>;
}

declare global {
    interface Window {
        __riffadoConnector?: ConnectorBridge;
    }
}

const POLL_MS = 750;
const POLL_FOR_MS = 10_000;

function bridgeReady(): boolean {
    const version = window.__riffadoConnector?.version;
    return typeof version === "number" && version >= 1;
}

/**
 * True once the Riffado Connector has injected its bridge into the page.
 * Polls for a few seconds after mount (the content script can land after
 * hydration) and checks again whenever the tab regains focus.
 */
export function useConnectorDetected(): boolean {
    const [detected, setDetected] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            if (!cancelled && bridgeReady()) setDetected(true);
        };
        check();
        const poll = window.setInterval(check, POLL_MS);
        const stop = window.setTimeout(
            () => window.clearInterval(poll),
            POLL_FOR_MS,
        );
        const onVisible = () => {
            if (document.visibilityState === "visible") check();
        };
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            cancelled = true;
            window.clearInterval(poll);
            window.clearTimeout(stop);
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);
    return detected;
}
