import {
    Activity,
    ArrowDownToLine,
    CodeXml,
    FileText,
    Gauge,
    type LucideIcon,
    Server,
    SlidersHorizontal,
    Smartphone,
    UserRound,
    Wrench,
} from "lucide-react";
import type { SettingsPage, SettingsSection } from "@/types/settings";

export type NavItem = {
    id: SettingsPage;
    /** Label in the settings sidebar. */
    name: string;
    /** Page title, shown at the top of the content column. */
    title: string;
    /** One line under the page title. No trailing period. */
    description: string;
    icon: LucideIcon;
};

const PLAN_ITEM: NavItem = {
    id: "plan",
    name: "Plan & usage",
    title: "Plan & usage",
    description: "Your plan, and how much of it you've used",
    icon: Gauge,
};

const ACCOUNT_ITEM: NavItem = {
    id: "account",
    name: "Account",
    title: "Account",
    description: "Your name, the email you sign in with, and your password",
    icon: UserRound,
};

const BASE_ITEMS: NavItem[] = [
    {
        id: "recorders",
        name: "Recorders",
        title: "Recorders",
        description:
            "Where your recordings come from, and how often Riffado checks for new ones",
        icon: Smartphone,
    },
    {
        id: "transcription",
        name: "Transcription",
        title: "Transcription",
        description: "Turns audio into text. Summaries have their own setting",
        icon: Activity,
    },
    {
        id: "ai",
        name: "AI for summaries",
        title: "AI for summaries",
        description:
            "Choose the model that writes summaries and titles. Transcription has its own setting",
        icon: FileText,
    },
    {
        id: "storage",
        name: "Server & storage",
        title: "Server & storage",
        description: "Where your audio files are kept, and for how long",
        icon: Server,
    },
    {
        id: "api",
        name: "API & webhooks",
        title: "API & webhooks",
        description:
            "Let scripts and other apps read your recordings, or get told when something is ready",
        icon: CodeXml,
    },
    {
        id: "export",
        name: "Export & backup",
        title: "Export & backup",
        description: "Take your recordings, transcripts and summaries with you",
        icon: ArrowDownToLine,
    },
    {
        id: "preferences",
        name: "Preferences",
        title: "Preferences",
        description: "How the player, lists and notifications behave",
        icon: SlidersHorizontal,
    },
];

const DEV_ITEM: NavItem = {
    id: "dev",
    name: "Developer tools",
    title: "Developer tools",
    description: "Diagnostics that only appear in development builds",
    icon: Wrench,
};

/**
 * The settings navigation, in display order. `isHosted` adds Plan & usage
 * (billing has no meaning on self-host); Account follows it on both;
 * development builds add Developer tools. Keyboard navigation, hash
 * routing and the last-page memory all work on this flat list.
 */
export function buildSettingsNav(opts: { isHosted: boolean }): NavItem[] {
    return [
        ...(opts.isHosted ? [PLAN_ITEM] : []),
        ACCOUNT_ITEM,
        ...BASE_ITEMS,
        ...(process.env.NODE_ENV !== "production" ? [DEV_ITEM] : []),
    ];
}

/**
 * Where each section lives: its page, and the id of the block on that page
 * to scroll to when the section was linked directly (old hashes such as
 * `#sync` or `#webhooks`). `anchor` is omitted when the section is the
 * whole page.
 */
export const SECTION_LOCATION: Record<
    SettingsSection,
    { page: SettingsPage; anchor?: string }
> = {
    billing: { page: "plan" },
    "plaud-account": { page: "recorders", anchor: "settings-plaud-account" },
    sync: { page: "recorders", anchor: "settings-sync" },
    transcription: { page: "transcription" },
    providers: { page: "ai", anchor: "settings-providers" },
    summary: { page: "ai", anchor: "settings-summary" },
    storage: { page: "storage" },
    "api-keys": { page: "api", anchor: "settings-api-keys" },
    webhooks: { page: "api", anchor: "settings-webhooks" },
    export: { page: "export" },
    playback: { page: "preferences", anchor: "settings-playback" },
    display: { page: "preferences", anchor: "settings-display" },
    notifications: { page: "preferences", anchor: "settings-notifications" },
    dev: { page: "dev" },
};

/**
 * Resolve a URL hash (without `#`) to a page in `nav`: either a page id or
 * an old section id. Returns null for anything that isn't reachable here,
 * such as `billing` on self-host.
 */
export function resolveSettingsHash(
    hash: string,
    nav: NavItem[],
): { page: SettingsPage; anchor?: string } | null {
    const direct = nav.find((item) => item.id === hash);
    if (direct) return { page: direct.id };
    if (Object.hasOwn(SECTION_LOCATION, hash)) {
        const location = SECTION_LOCATION[hash as SettingsSection];
        if (nav.some((item) => item.id === location.page)) return location;
    }
    return null;
}

export const SETTINGS_STORAGE_KEY = "settings-last-section";
