import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uiText } from "@/lib/i18n";

export function useSettings() {
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    const saveSettings = async (updates: Record<string, unknown>) => {
        try {
            setIsSavingSettings(true);
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            toast.error(uiText("Failed to save settings"));
            throw new Error("Failed to save settings");
        } finally {
            setIsSavingSettings(false);
        }
    };

    const debouncedSave = (updates: Record<string, unknown>, delay = 500) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
            saveSettings(updates).catch(() => {});
        }, delay);
    };

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    return {
        isLoadingSettings,
        setIsLoadingSettings,
        isSavingSettings,
        saveSettings,
        debouncedSave,
    };
}
