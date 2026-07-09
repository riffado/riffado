"use client";

import { useCallback } from "react";
import { SettingsNavMobile } from "@/components/settings-nav-mobile";
import { SettingsNavSidebar } from "@/components/settings-nav-sidebar";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import type { SettingsSection } from "@/types/settings";
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

const EMPTY_PROVIDERS: Provider[] = [];

export function SettingsDialog({
    open,
    onOpenChange,
    initialProviders = EMPTY_PROVIDERS,
    onReRunOnboarding,
    isHosted = false,
}: SettingsDialogProps) {
    const onClose = useCallback(() => onOpenChange(false), [onOpenChange]);
    const { activeSection, setActiveSection, keyboardSelectedIndex } =
        useSettingsNav(open, onClose, isHosted);

    const handleSectionChange = useCallback(
        (section: SettingsSection) => setActiveSection(section),
        [setActiveSection],
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
                    <SettingsNavSidebar
                        activeSection={activeSection}
                        keyboardSelectedIndex={keyboardSelectedIndex}
                        onSectionChange={handleSectionChange}
                        isHosted={isHosted}
                    />

                    <main className="flex h-[600px] flex-1 flex-col overflow-hidden">
                        {/*
                          Desktop: header bar is intentionally empty -- the
                          sidebar's active item plus the section h2 inside
                          each pane communicate "where am I"; a third
                          breadcrumb on top was redundant. The h-16 +
                          border-b stays so the rule lines up with the
                          sidebar's "Settings" header.
                          Mobile: the section picker lives here because the
                          sidebar is hidden below md.
                        */}
                        <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b px-4 md:justify-end">
                            <SettingsNavMobile
                                activeSection={activeSection}
                                onSectionChange={handleSectionChange}
                                isHosted={isHosted}
                            />
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
