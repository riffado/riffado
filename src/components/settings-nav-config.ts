import {
    Bell,
    Bot,
    Download,
    FileText,
    HardDrive,
    KeyRound,
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
    name: string;
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
export const settingsNavGroups: { label: string; items: NavItem[] }[] = [
    {
        label: "AI",
        items: [
            { name: "Providers", id: "providers", icon: Bot },
            { name: "Transcription", id: "transcription", icon: FileText },
            { name: "Summary", id: "summary", icon: ListChecks },
        ],
    },
    {
        label: "Plaud",
        items: [
            { name: "Plaud Account", id: "plaud-account", icon: Mic },
            { name: "Sync", id: "sync", icon: RefreshCw },
        ],
    },
    {
        label: "Personalize",
        items: [
            { name: "Playback", id: "playback", icon: Play },
            { name: "Display", id: "display", icon: Monitor },
            { name: "Notifications", id: "notifications", icon: Bell },
        ],
    },
    {
        label: "Data",
        items: [
            { name: "Storage", id: "storage", icon: HardDrive },
            { name: "Export/Backup", id: "export", icon: Download },
        ],
    },
    {
        label: "Integrations",
        items: [
            { name: "API Keys", id: "api-keys", icon: KeyRound },
            { name: "Webhooks", id: "webhooks", icon: Webhook },
        ],
    },
    ...(process.env.NODE_ENV !== "production"
        ? [
              {
                  label: "Advanced",
                  items: [
                      {
                          name: "Developer Tools",
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
