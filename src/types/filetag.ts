/**
 * Client-facing shape of a Plaud directory ("filetag"). `name` is
 * plaintext (decrypted server-side); `isLocalOnly` marks directories
 * that exist only in Riffado (no Plaud-side tag id).
 */
export interface Filetag {
    id: string;
    name: string;
    icon: string;
    color: string;
    isLocalOnly: boolean;
}

/** Per-directory recording counts keyed by local filetag id. */
export interface FiletagCounts {
    [filetagId: string]: number;
}
