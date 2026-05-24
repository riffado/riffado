"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { setLocale } from "@/i18n/actions";
import { SUPPORTED_LOCALES } from "@/i18n/locales";

/**
 * Standalone locale switcher used by the Settings → Language section.
 * On selection the chosen locale is persisted as a cookie via a Server
 * Action and the layout revalidates, so every component using
 * `useTranslations()` re-renders with the new bundle on next paint.
 *
 * Kept deliberately presentational; routing/state belongs in the
 * action, not here.
 */
export function LocaleSwitcher() {
    const current = useLocale();
    const t = useTranslations("common");
    const [pending, startTransition] = useTransition();

    return (
        <div className="flex items-center gap-2">
            <Languages
                className="size-4 text-muted-foreground"
                aria-hidden="true"
            />
            <Select
                value={current}
                onValueChange={(value) => {
                    startTransition(() => {
                        void setLocale(value);
                    });
                }}
                disabled={pending}
            >
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t("language")} />
                </SelectTrigger>
                <SelectContent>
                    {SUPPORTED_LOCALES.map((locale) => (
                        <SelectItem key={locale.code} value={locale.code}>
                            {locale.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
