/**
 * The local storage base directory itself is missing (e.g. an unmounted
 * volume), as opposed to a single missing key.
 */
export class StorageRootMissingError extends Error {
    constructor(
        readonly baseDir: string,
        options?: { cause?: unknown },
    ) {
        super(`Local storage directory is missing: ${baseDir}`, options);
        this.name = "StorageRootMissingError";
    }
}

interface StorageErrorShape {
    name?: unknown;
    code?: unknown;
    cause?: unknown;
    $metadata?: { httpStatusCode?: unknown };
}

function storageErrorChain(error: unknown): StorageErrorShape[] {
    const chain: StorageErrorShape[] = [];
    let current = error;
    while (
        current !== null &&
        typeof current === "object" &&
        chain.length < 5
    ) {
        const shape = current as StorageErrorShape;
        chain.push(shape);
        current = shape.cause;
    }
    return chain;
}

/**
 * True when a storage call failed only because the object does not exist
 * (S3 NoSuchKey/NotFound/404, local ENOENT), judged along the `cause`
 * chain. False when the storage itself is unreachable (missing local base
 * directory or bucket), since the object may still exist there.
 */
export function isStorageObjectMissingError(error: unknown): boolean {
    const chain = storageErrorChain(error);
    if (
        chain.some(
            (shape) =>
                shape instanceof StorageRootMissingError ||
                shape.name === "NoSuchBucket",
        )
    ) {
        return false;
    }
    return chain.some(
        (shape) =>
            shape.name === "NoSuchKey" ||
            shape.name === "NotFound" ||
            shape.code === "ENOENT" ||
            shape.$metadata?.httpStatusCode === 404,
    );
}

/**
 * A copy of `error` (name and message only) with `storageKey` replaced,
 * for error tracking: storage keys embed user ids, and both storage and
 * database errors can echo the key in their message.
 */
export function redactStorageKey(error: unknown, storageKey: string): Error {
    const message = error instanceof Error ? error.message : String(error);
    const redacted = new Error(message.split(storageKey).join("<storage-key>"));
    redacted.name = error instanceof Error ? error.name : "Error";
    return redacted;
}
