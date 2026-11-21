"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettingsDialog } from "@/components/settings-dialog";
import type { Provider } from "@/components/settings-sections/providers-section";

interface SettingsPageContentProps {
    initialProviders: Provider[];
    isHosted?: boolean;
}

export function SettingsPageContent({
    initialProviders,
    isHosted = false,
}: SettingsPageContentProps) {
    const { push } = useRouter();
    const [open, setOpen] = useState(true);
    const [providers, setProviders] = useState(initialProviders);

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
            providers={providers}
            onProvidersChange={setProviders}
            isHosted={isHosted}
        />
    );
}
