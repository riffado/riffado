"use client";

import { settingsNav } from "@/components/settings-nav-config";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { SettingsSection } from "@/types/settings";

interface Props {
    activeSection: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
}

/**
 * Section picker shown in the dialog header below md. Replaces the
 * sidebar (hidden at that breakpoint) so users on small screens
 * still have a way to switch sections without a separate route.
 */
export function SettingsNavMobile({ activeSection, onSectionChange }: Props) {
    const activeNavItem = settingsNav.find((item) => item.id === activeSection);

    return (
        <div className="md:hidden">
            <Select
                value={activeSection}
                onValueChange={(value) =>
                    onSectionChange(value as SettingsSection)
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
                        <SelectItem key={item.id} value={item.id}>
                            <div className="flex items-center gap-2">
                                <item.icon className="size-4" />
                                <span>{item.name}</span>
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
