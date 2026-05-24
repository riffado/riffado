"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { Label } from "@/components/ui/label";

/**
 * Sidebar section for the UI language. Lives under the "Personalize"
 * group alongside Playback/Display/Notifications — UI language is a
 * presentation preference, not a Provider/Integration concern.
 *
 * Kept separate from the Summary section's `aiOutputLanguage` because
 * the two answer different questions:
 *   - LocaleSwitcher: what language do I read the app's UI in?
 *   - aiOutputLanguage: what language should AI-generated summaries be
 *     written in?
 * Operators routinely want them set differently (e.g. English UI for a
 * polyglot team, but summaries in the recording's source language).
 */
export function LanguageSection() {
    const t = useTranslations("settings.language");

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title={t("title")}
                description={t("description")}
                icon={Languages}
            />
            <div className="space-y-2">
                <Label>{t("label")}</Label>
                <LocaleSwitcher />
            </div>
        </div>
    );
}
