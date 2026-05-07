import { PlaudClient, DEFAULT_PLAUD_API_BASE } from "@/lib/plaud/client";
import { resolveApiBase } from "@/lib/plaud/servers";
import type { CliConfig } from "./config";

/**
 * Create a PlaudClient from CLI config.
 * Unlike the web app's createPlaudClient, this doesn't need encryption —
 * the CLI stores the raw token in a file with 0600 permissions.
 */
export function createClient(config: CliConfig): PlaudClient {
    const apiBase =
        resolveApiBase(config.apiServer, config.customApiBase) ??
        DEFAULT_PLAUD_API_BASE;

    return new PlaudClient(config.bearerToken, apiBase);
}
