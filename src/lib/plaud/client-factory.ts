import { decrypt } from "@/lib/encryption";
import { DEFAULT_PLAUD_API_BASE, PlaudClient } from "./client";

/** Build a `PlaudClient` from an encrypted bearer token. */
export async function createPlaudClient(
    encryptedToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
    workspaceId?: string | null,
): Promise<PlaudClient> {
    const bearerToken = decrypt(encryptedToken);
    return new PlaudClient(bearerToken, apiBase, workspaceId ?? undefined);
}
