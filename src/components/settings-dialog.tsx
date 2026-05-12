"use client";

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
    Settings as SettingsIcon,
    Webhook,
    Wrench,
} from "lucide-react";
import * as React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
} from "@/components/ui/sidebar";
import { SettingsContent } from "./settings-content";

export interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
}

interface SettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialProviders?: Provider[];
    onReRunOnboarding?: () => void;
    isHosted?: boolean;
}

import type { SettingsSection } from "@/types/settings";

type NavItem = {
    name: string;
    id: SettingsSection;
    icon: typeof Bot;
};

// Grouped navigation. The grouping is presentational only; iteration
// code below flattens via `settingsNav` so keyboard nav, hash routing,
// and localStorage continue to operate on a flat indexed list.
const settingsNavGroups: { label: string; items: NavItem[] }[] = [
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

// Flat list derived from the groups — keep this the single source of
// truth for keyboard nav / hash routing / localStorage. Changing the
// group structure above must not break index-based iteration.
const settingsNav: NavItem[] = settingsNavGroups.flatMap((g) => g.items);

const STORAGE_KEY = "settings-last-section";

export function SettingsDialog({
    open,
    onOpenChange,
    initialProviders = [],
    onReRunOnboarding,
    isHosted = false,
}: SettingsDialogProps) {
    const [activeSection, setActiveSection] =
        React.useState<SettingsSection>("providers");
    const [keyboardSelectedIndex, setKeyboardSelectedIndex] =
        React.useState<number>(0);

    const activeNavItem = settingsNav.find((item) => item.id === activeSection);

    React.useEffect(() => {
        if (typeof window === "undefined") return;

        const hash = window.location.hash.slice(1);
        const validSection = settingsNav.find((item) => item.id === hash)?.id as
            | SettingsSection
            | undefined;

        if (validSection) {
            setActiveSection(validSection);
            setKeyboardSelectedIndex(
                settingsNav.findIndex((item) => item.id === validSection),
            );
        } else {
            const lastSection = localStorage.getItem(STORAGE_KEY);
            if (lastSection) {
                const validLastSection = settingsNav.find(
                    (item) => item.id === lastSection,
                )?.id as SettingsSection | undefined;
                if (validLastSection) {
                    setActiveSection(validLastSection);
                    setKeyboardSelectedIndex(
                        settingsNav.findIndex(
                            (item) => item.id === validLastSection,
                        ),
                    );
                }
            }
        }
    }, []);

    React.useEffect(() => {
        if (typeof window === "undefined") return;
        window.location.hash = activeSection;
        localStorage.setItem(STORAGE_KEY, activeSection);
    }, [activeSection]);

    React.useEffect(() => {
        if (open) {
            const timer = setTimeout(() => {
                const firstButton = document.querySelector(
                    '[data-settings-nav="first"]',
                ) as HTMLButtonElement | null;
                firstButton?.focus();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [open]);

    const handleKeyDown = React.useCallback(
        (e: KeyboardEvent) => {
            if (!open) return;

            if (e.key === "Escape") {
                onOpenChange(false);
                return;
            }

            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
            ) {
                return;
            }

            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    setKeyboardSelectedIndex((prev) => {
                        const next = Math.min(prev + 1, settingsNav.length - 1);
                        return next;
                    });
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    setKeyboardSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                }
                case "Enter":
                case " ": {
                    e.preventDefault();
                    const selectedItem = settingsNav[keyboardSelectedIndex];
                    if (selectedItem) {
                        setActiveSection(selectedItem.id);
                    }
                    break;
                }
            }
        },
        [open, keyboardSelectedIndex, onOpenChange],
    );

    React.useEffect(() => {
        if (open) {
            window.addEventListener("keydown", handleKeyDown);
            return () => window.removeEventListener("keydown", handleKeyDown);
        }
    }, [open, handleKeyDown]);

    React.useEffect(() => {
        const index = settingsNav.findIndex(
            (item) => item.id === activeSection,
        );
        if (index !== -1) {
            setKeyboardSelectedIndex(index);
        }
    }, [activeSection]);

    const handleSectionChange = React.useCallback(
        (section: SettingsSection) => {
            setActiveSection(section);
        },
        [],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
                <DialogTitle className="sr-only">Settings</DialogTitle>
                <DialogDescription className="sr-only">
                    Customize your settings here. Use arrow keys to navigate
                    sections, Enter or Space to select, and Escape to close.
                </DialogDescription>
                <SidebarProvider className="items-start">
                    {/*
                      Sidebar needs an explicit height to match <main>'s
                      h-[600px], otherwise SidebarContent's overflow-y-auto
                      has no bound to scroll against: DialogContent uses
                      max-h (a constraint, not a definite height) so the
                      sidebar's h-full would resolve to its content height
                      and grow rather than scroll once we cross ~13 nav items.
                    */}
                    <Sidebar className="hidden md:flex md:h-[600px]">
                        {/*
                          Header sits outside SidebarContent so it doesn't
                          scroll away with the nav. min-h-0 on SidebarContent
                          is the flex-scroll incantation: without it, a
                          flex-1 child can refuse to shrink below its
                          content height even with overflow-y-auto.
                        */}
                        {/*
                          Match the main panel <header>'s h-16 exactly
                          so the two bottom borders line up. Previously
                          this used py-4 which resolved to ~56px,
                          leaving an 8px step between the sidebar and
                          breadcrumb rules.
                        */}
                        <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                            <SettingsIcon className="size-5" />
                            <h2 className="text-lg font-semibold">Settings</h2>
                        </div>
                        <SidebarContent className="min-h-0">
                            <SidebarMenu
                                role="navigation"
                                aria-label="Settings sections"
                                className="space-y-4"
                            >
                                {settingsNavGroups.map((group) => (
                                    <SidebarGroup
                                        key={group.label}
                                        className="space-y-1"
                                    >
                                        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                            {group.label}
                                        </div>
                                        <SidebarGroupContent>
                                            {group.items.map((item) => {
                                                // Resolve the item's flat
                                                // index so keyboard nav
                                                // (which still indexes a
                                                // flat list) stays in
                                                // sync with what's
                                                // rendered.
                                                const flatIndex =
                                                    settingsNav.findIndex(
                                                        (n) => n.id === item.id,
                                                    );
                                                return (
                                                    <SidebarMenuItem
                                                        key={item.id}
                                                    >
                                                        <SidebarMenuButton
                                                            data-settings-nav={
                                                                flatIndex === 0
                                                                    ? "first"
                                                                    : undefined
                                                            }
                                                            isActive={
                                                                activeSection ===
                                                                item.id
                                                            }
                                                            data-keyboard-selected={
                                                                keyboardSelectedIndex ===
                                                                flatIndex
                                                            }
                                                            onClick={() =>
                                                                handleSectionChange(
                                                                    item.id,
                                                                )
                                                            }
                                                            aria-label={`${item.name} settings`}
                                                            aria-current={
                                                                activeSection ===
                                                                item.id
                                                                    ? "page"
                                                                    : undefined
                                                            }
                                                            className={
                                                                item.id ===
                                                                "dev"
                                                                    ? "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 data-[active=true]:bg-red-500/10 data-[active=true]:text-red-700 dark:data-[active=true]:text-red-300"
                                                                    : undefined
                                                            }
                                                        >
                                                            <item.icon
                                                                className="size-4"
                                                                aria-hidden="true"
                                                            />
                                                            <span>
                                                                {item.name}
                                                            </span>
                                                        </SidebarMenuButton>
                                                    </SidebarMenuItem>
                                                );
                                            })}
                                        </SidebarGroupContent>
                                    </SidebarGroup>
                                ))}
                            </SidebarMenu>
                        </SidebarContent>
                    </Sidebar>

                    <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
                        {/*
                          Desktop: header bar is intentionally empty
                          — the sidebar's active item plus the section
                          h2 inside each pane communicate "where am I";
                          a third breadcrumb on top was redundant. The
                          h-16 + border-b stays so the rule lines up
                          with the sidebar's "Settings" header.
                          Mobile: the section picker lives here because
                          the sidebar is hidden below md.
                        */}
                        <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b px-4 md:justify-end">
                            {/*
                              Desktop: the sidebar's selected item is the
                              source of truth for "where am I" — a header
                              label here would just duplicate the section's
                              own SectionHeader and the highlighted nav row.
                              The h-16 + border-b shell stays so the rule
                              lines up with the sidebar's "Settings" header.
                              Mobile: the section picker fills this slot
                              since the sidebar is hidden below md.
                            */}
                            <div className="md:hidden">
                                <Select
                                    value={activeSection}
                                    onValueChange={(value) =>
                                        handleSectionChange(
                                            value as SettingsSection,
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        className="w-[180px]"
                                        aria-label="Select settings section"
                                    >
                                        <SelectValue>
                                            {activeNavItem?.name || "Settings"}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {settingsNav.map((item) => (
                                            <SelectItem
                                                key={item.id}
                                                value={item.id}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <item.icon className="w-4 h-4" />
                                                    <span>{item.name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </header>

                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-6">
                            <div
                                key={activeSection}
                                className="animate-in fade-in-0 duration-200"
                            >
                                <SettingsContent
                                    activeSection={activeSection}
                                    initialProviders={initialProviders}
                                    onReRunOnboarding={onReRunOnboarding}
                                    isHosted={isHosted}
                                />
                            </div>
                        </div>
                    </main>
                </SidebarProvider>
            </DialogContent>
        </Dialog>
    );
}
