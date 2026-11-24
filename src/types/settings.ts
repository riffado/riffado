/**
 * Settings types
 */

/**
 * The individual settings sections. Each one is still a self-contained
 * component; several of them share a page (see `SettingsPage`). Their ids
 * stay valid as URL hashes (`/settings#providers`) and resolve to the page
 * that contains them.
 */
export type SettingsSection =
    | "providers"
    | "api-keys"
    | "webhooks"
    | "transcription"
    | "summary"
    | "storage"
    | "sync"
    | "plaud-account"
    | "playback"
    | "display"
    | "notifications"
    | "export"
    | "billing"
    | "dev";

/** A destination in the settings navigation: one full page. */
export type SettingsPage =
    | "plan"
    | "account"
    | "recorders"
    | "transcription"
    | "ai"
    | "storage"
    | "api"
    | "export"
    | "preferences"
    | "dev";
