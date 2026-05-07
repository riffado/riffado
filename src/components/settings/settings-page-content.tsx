"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Provider, SettingsDialog } from "@/components/settings-dialog";

interface SettingsPageContentProps {
    initialProviders?: Provider[];
    isHosted?: boolean;
}

export function SettingsPageContent({
    initialProviders = [],
    isHosted = false,
}: SettingsPageContentProps) {
    const router = useRouter();
    const [open, setOpen] = useState(true);

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            // Navigate back to dashboard when dialog closes
            router.push("/dashboard");
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
