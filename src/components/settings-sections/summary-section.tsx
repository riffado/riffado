"use client";

import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SummaryPromptManager } from "@/components/settings-sections/summary-prompt-manager";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-settings";
import { AI_OUTPUT_LANGUAGES } from "@/lib/ai/summary-presets";

export function SummarySection() {
    const { isSavingSettings } = useSettings();
    const [outputLanguage, setOutputLanguage] = useState<string>("auto");

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    if (typeof data.aiOutputLanguage === "string") {
                        setOutputLanguage(data.aiOutputLanguage);
                    } else {
                        setOutputLanguage("auto");
                    }
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            }
        };
        fetchSettings();
    }, []);

    const handleLanguageChange = async (value: string) => {
        const previous = outputLanguage;
        setOutputLanguage(value);

        try {
            // Persist `null` for `auto` so the column reflects "no preference".
            const response = await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    aiOutputLanguage: value === "auto" ? null : value,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to save settings");
            }
        } catch {
            setOutputLanguage(previous);
            toast.error("Failed to save settings. Changes reverted.");
        }
    };

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title="Summary"
                description="Prompt presets and provider used when generating recording summaries."
                icon={ListChecks}
            />
            <SummaryPromptManager />
            <div className="space-y-2 pt-4 border-t">
                <Label htmlFor="ai-output-language">AI output language</Label>
                <Select
                    value={outputLanguage}
                    onValueChange={handleLanguageChange}
                    disabled={isSavingSettings}
                >
                    <SelectTrigger id="ai-output-language" className="w-full">
                        <SelectValue>
                            {AI_OUTPUT_LANGUAGES.find(
                                (l) => l.code === outputLanguage,
                            )?.label ?? "Auto (match transcript)"}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        {AI_OUTPUT_LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                                {lang.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Applies to AI-generated summaries and titles. Auto lets the
                    model match the transcript's language.
                </p>
            </div>
        </div>
    );
}
