// `__CLI_VERSION__` is replaced at build time by tsup (see tsup.config.ts).
// In dev / tests (when running source directly without bundling), the
// fallback marks the build as a working copy.
declare const __CLI_VERSION__: string | undefined;

export const VERSION: string =
    typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

export const USER_AGENT = `riffado-cli/${VERSION}`;
