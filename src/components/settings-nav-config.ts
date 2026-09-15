import {
    Bell,
    Bot,
    CreditCard,
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
import { uiText } from "@/lib/i18n";
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
const baseSettingsNavGroups: { label: string; items: NavItem[] }[] = [
    {
        label: "AI",
        items: [
            { name: uiText("Providers"), id: "providers", icon: Bot },
            {
                name: uiText("Transcription"),
                id: "transcription",
                icon: FileText,
            },
            { name: uiText("Summary"), id: "summary", icon: ListChecks },
        ],
    },
    {
        label: "Plaud",
        items: [
            { name: uiText("Plaud Account"), id: "plaud-account", icon: Mic },
            { name: uiText("Sync"), id: "sync", icon: RefreshCw },
        ],
    },
    {
        label: uiText("Personalize"),
        items: [
            { name: uiText("Playback"), id: "playback", icon: Play },
            { name: uiText("Display"), id: "display", icon: Monitor },
            { name: uiText("Notifications"), id: "notifications", icon: Bell },
        ],
    },
    {
        label: uiText("Data"),
        items: [
            { name: uiText("Storage"), id: "storage", icon: HardDrive },
            { name: uiText("Export/Backup"), id: "export", icon: Download },
        ],
    },
    {
        label: uiText("Integrations"),
        items: [
            { name: uiText("API Keys"), id: "api-keys", icon: KeyRound },
            { name: uiText("Webhooks"), id: "webhooks", icon: Webhook },
        ],
    },
    ...(process.env.NODE_ENV !== "production"
        ? [
              {
                  label: uiText("Advanced"),
                  items: [
                      {
                          name: uiText("Developer Tools"),
                          id: "dev" as SettingsSection,
                          icon: Wrench,
                      },
                  ],
              },
          ]
        : []),
];

/**
 * Build the settings nav. `isHosted` toggles the Billing group, which
 * is meaningless on self-host.
 */
export function buildSettingsNavGroups(opts: {
    isHosted: boolean;
}): { label: string; items: NavItem[] }[] {
    return [
        ...(opts.isHosted
            ? [
                  {
                      label: uiText("Account"),
                      items: [
                          {
                              name: uiText("Billing"),
                              id: "billing" as SettingsSection,
                              icon: CreditCard,
                          },
                      ],
                  },
              ]
            : []),
        ...baseSettingsNavGroups,
    ];
}

/**
 * Flat list keyed by `isHosted`. Keep this the single source of truth
 * for keyboard nav / hash routing / localStorage. Changing the group
 * structure must not break index-based iteration.
 */
export function buildSettingsNav(opts: { isHosted: boolean }): NavItem[] {
    return buildSettingsNavGroups(opts).flatMap((g) => g.items);
}

export const SETTINGS_STORAGE_KEY = "settings-last-section";
