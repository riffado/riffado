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
