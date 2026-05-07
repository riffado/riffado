"use client";

import {
    Bell,
    Bot,
    Download,
    FileText,
    HardDrive,
    ListChecks,
    Monitor,
    Play,
    RefreshCw,
    Settings as SettingsIcon,
    Wrench,
} from "lucide-react";
import * as React from "react";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

const settingsNav = [
    { name: "AI", id: "providers" as SettingsSection, icon: Bot },
    {
        name: "Transcription",
        id: "transcription" as SettingsSection,
        icon: FileText,
    },
    {
        name: "Summary",
        id: "summary" as SettingsSection,
        icon: ListChecks,
    },
    { name: "Sync", id: "sync" as SettingsSection, icon: RefreshCw },
    { name: "Playback", id: "playback" as SettingsSection, icon: Play },
    { name: "Display", id: "display" as SettingsSection, icon: Monitor },
    {
        name: "Notifications",
        id: "notifications" as SettingsSection,
        icon: Bell,
    },
    { name: "Export/Backup", id: "export" as SettingsSection, icon: Download },
    { name: "Storage", id: "storage" as SettingsSection, icon: HardDrive },
    ...(process.env.NODE_ENV !== "production"
        ? [
              {
                  name: "Developer Tools",
                  id: "dev" as SettingsSection,
                  icon: Wrench,
              },
          ]
        : []),
];

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
                    <Sidebar className="hidden md:flex">
                        <SidebarContent>
                            <div className="flex items-center gap-2 px-4 py-4 border-b">
                                <SettingsIcon className="w-5 h-5" />
                                <h2 className="font-semibold text-lg">
                                    Settings
                                </h2>
                            </div>
                            <SidebarGroup>
                                <SidebarGroupContent>
                                    <SidebarMenu
                                        role="navigation"
                                        aria-label="Settings sections"
                                    >
                                        {settingsNav.map((item, index) => (
                                            <SidebarMenuItem key={item.id}>
                                                <SidebarMenuButton
                                                    data-settings-nav={
                                                        index === 0
                                                            ? "first"
                                                            : undefined
                                                    }
                                                    isActive={
                                                        activeSection ===
                                                        item.id
                                                    }
                                                    data-keyboard-selected={
                                                        keyboardSelectedIndex ===
                                                        index
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
                                                        item.id === "dev"
                                                            ? "transition-all duration-200 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 data-[active=true]:bg-red-500/10 data-[active=true]:text-red-700 dark:data-[active=true]:text-red-300"
                                                            : "transition-all duration-200"
                                                    }
                                                >
                                                    <item.icon
                                                        className="w-4 h-4"
                                                        aria-hidden="true"
                                                    />
                                                    <span>{item.name}</span>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </SidebarContent>
                    </Sidebar>

                    <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
                        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                            <div className="flex items-center gap-2 flex-1">
                                <Breadcrumb>
                                    <BreadcrumbList>
                                        <BreadcrumbItem className="hidden md:block">
                                            <BreadcrumbPage>
                                                Settings
                                            </BreadcrumbPage>
                                        </BreadcrumbItem>
                                        <BreadcrumbSeparator className="hidden md:block" />
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>
                                                {activeNavItem?.name ||
                                                    "Settings"}
                                            </BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </BreadcrumbList>
                                </Breadcrumb>
                            </div>
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
