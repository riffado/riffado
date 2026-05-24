import {
    Bell,
    Bot,
    Download,
    FileText,
    HardDrive,
    KeyRound,
    Languages,
    ListChecks,
    Mic,
    Monitor,
    Play,
    RefreshCw,
    Webhook,
    Wrench,
} from "lucide-react";
import type { SettingsSection } from "@/types/settings";

export type NavItem = {
    /**
     * English fallback label. Still used by tests, command-palette
     * suggestion strings, and any callsite that hasn't migrated to
     * `useTranslations`. Rendering paths (sidebar + mobile picker) now
     * prefer `i18nKey` and translate it.
     */
    name: string;
    /** Translation key under `settings.sections.<key>`. */
    i18nKey: string;
    id: SettingsSection;
    icon: typeof Bot;
};

/**
 * Grouped navigation. The grouping is presentational only; iteration
 * code flattens via `settingsNav` so keyboard nav, hash routing, and
 * localStorage continue to operate on a flat indexed list.
 *
 * Lives at module scope so the array reference is stable across
 * renders (would otherwise bust memoization on every dialog mount).
 */
export const settingsNavGroups: {
    label: string;
    i18nKey: string;
    items: NavItem[];
}[] = [
    {
        label: "AI",
        i18nKey: "ai",
        items: [
            {
                name: "Providers",
                i18nKey: "aiProviders",
                id: "providers",
                icon: Bot,
            },
            {
                name: "Transcription",
                i18nKey: "transcription",
                id: "transcription",
                icon: FileText,
            },
            {
                name: "Summary",
                i18nKey: "summary",
                id: "summary",
                icon: ListChecks,
            },
        ],
    },
    {
        label: "Plaud",
        i18nKey: "plaud",
        items: [
            {
                name: "Plaud Account",
                i18nKey: "plaudAccount",
                id: "plaud-account",
                icon: Mic,
            },
            {
                name: "Sync",
                i18nKey: "sync",
                id: "sync",
                icon: RefreshCw,
            },
        ],
    },
    {
        label: "Personalize",
        i18nKey: "personalize",
        items: [
            {
                name: "Playback",
                i18nKey: "playback",
                id: "playback",
                icon: Play,
            },
            {
                name: "Display",
                i18nKey: "display",
                id: "display",
                icon: Monitor,
            },
            {
                name: "Language",
                i18nKey: "language",
                id: "language",
                icon: Languages,
            },
            {
                name: "Notifications",
                i18nKey: "notifications",
                id: "notifications",
                icon: Bell,
            },
        ],
    },
    {
        label: "Data",
        i18nKey: "data",
        items: [
            {
                name: "Storage",
                i18nKey: "storage",
                id: "storage",
                icon: HardDrive,
            },
            {
                name: "Export/Backup",
                i18nKey: "exportBackup",
                id: "export",
                icon: Download,
            },
        ],
    },
    {
        label: "Integrations",
        i18nKey: "integrations",
        items: [
            {
                name: "API Keys",
                i18nKey: "apiKeys",
                id: "api-keys",
                icon: KeyRound,
            },
            {
                name: "Webhooks",
                i18nKey: "webhooks",
                id: "webhooks",
                icon: Webhook,
            },
        ],
    },
    ...(process.env.NODE_ENV !== "production"
        ? [
              {
                  label: "Advanced",
                  i18nKey: "advanced",
                  items: [
                      {
                          name: "Developer Tools",
                          i18nKey: "developerTools",
                          id: "dev" as SettingsSection,
                          icon: Wrench,
                      },
                  ],
              },
          ]
        : []),
];

/**
 * Flat list derived from the groups -- keep this the single source of
 * truth for keyboard nav / hash routing / localStorage. Changing the
 * group structure above must not break index-based iteration.
 */
export const settingsNav: NavItem[] = settingsNavGroups.flatMap((g) => g.items);

export const SETTINGS_STORAGE_KEY = "settings-last-section";
