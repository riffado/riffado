"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Provider, SettingsDialog } from "@/components/settings-dialog";

const EMPTY_PROVIDERS: Provider[] = [];

interface SettingsPageContentProps {
    initialProviders?: Provider[];
    isHosted?: boolean;
}

export function SettingsPageContent({
    initialProviders = EMPTY_PROVIDERS,
    isHosted = false,
}: SettingsPageContentProps) {
    const { push } = useRouter();
    const [open, setOpen] = useState(true);

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            // Navigate back to dashboard when dialog closes
            push("/dashboard");
        }
    };

    return (
        <SettingsDialog
            open={open}
            onOpenChange={handleOpenChange}
            initialProviders={initialProviders}
            isHosted={isHosted}
        />
    );
}
