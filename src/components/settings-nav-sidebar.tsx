"use client";

import { Settings as SettingsIcon } from "lucide-react";
import {
    settingsNav,
    settingsNavGroups,
} from "@/components/settings-nav-config";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SettingsSection } from "@/types/settings";

interface Props {
    activeSection: SettingsSection;
    keyboardSelectedIndex: number;
    onSectionChange: (section: SettingsSection) => void;
}

/**
 * Desktop sidebar navigation. Hidden below md (the mobile picker
 * lives in the dialog header). Grouped layout for visual scanning,
 * but the underlying nav is a single flat list -- the parent's
 * keyboard handler indexes the flat order via `settingsNav`.
 */
export function SettingsNavSidebar({
    activeSection,
    keyboardSelectedIndex,
    onSectionChange,
}: Props) {
    return (
        // Sidebar needs an explicit height to match <main>'s h-[600px],
        // otherwise SidebarContent's overflow-y-auto has no bound to
        // scroll against: DialogContent uses max-h (a constraint, not
        // a definite height) so the sidebar's h-full would resolve to
        // its content height and grow rather than scroll once we cross
        // ~13 nav items.
        <Sidebar className="hidden md:flex md:h-[600px]">
            {/*
              Header sits outside SidebarContent so it doesn't scroll
              away with the nav. Match the main panel <header>'s h-16
              exactly so the two bottom borders line up.
            */}
            <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SettingsIcon className="size-5" />
                <h2 className="text-lg font-semibold">Settings</h2>
            </div>
            <SidebarContent className="min-h-0">
                {/*
                  Use a real <nav> for the navigation landmark instead
                  of overloading SidebarMenu (which renders <ul>) with
                  role="navigation". Each group below has its own <ul>
                  via SidebarMenu, so <li> items always sit under a
                  proper list parent -- fixing the previous ul > div >
                  li nesting which is invalid HTML and confuses screen
                  readers.
                */}
                <nav aria-label="Settings sections" className="space-y-4">
                    {settingsNavGroups.map((group) => (
                        <SidebarGroup key={group.label} className="space-y-1">
                            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                {group.label}
                            </div>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {group.items.map((item) => {
                                        // Resolve the item's flat
                                        // index so keyboard nav (which
                                        // still indexes a flat list)
                                        // stays in sync with what's
                                        // rendered.
                                        const flatIndex = settingsNav.findIndex(
                                            (n) => n.id === item.id,
                                        );
                                        return (
                                            <SidebarMenuItem key={item.id}>
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
                                                        onSectionChange(item.id)
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
                                                            ? "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 data-[active=true]:bg-red-500/10 data-[active=true]:text-red-700 dark:data-[active=true]:text-red-300"
                                                            : undefined
                                                    }
                                                >
                                                    <item.icon
                                                        className="size-4"
                                                        aria-hidden="true"
                                                    />
                                                    <span>{item.name}</span>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        );
                                    })}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    ))}
                </nav>
            </SidebarContent>
        </Sidebar>
    );
}
