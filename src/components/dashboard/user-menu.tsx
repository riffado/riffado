"use client";

import {
    Keyboard,
    LogOut,
    Monitor,
    Moon,
    Settings,
    Shield,
    Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UserMenuProps {
    isAdmin: boolean;
    initialTheme: "light" | "dark" | "system";
    userEmail: string | null;
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {children}
        </kbd>
    );
}

function emailInitial(email: string | null): string {
    if (!email) return "?";
    const trimmed = email.trim();
    if (!trimmed) return "?";
    return trimmed[0].toUpperCase();
}

export function UserMenu({
    isAdmin,
    initialTheme,
    userEmail,
    onOpenSettings,
    onOpenShortcuts,
}: UserMenuProps) {
    const t = useTranslations("userMenu");
    const { push, refresh } = useRouter();
    const { theme, setTheme } = useTheme(initialTheme);

    const themeOptions = [
        { value: "light" as const, label: t("themeLight"), icon: Sun },
        { value: "dark" as const, label: t("themeDark"), icon: Moon },
        { value: "system" as const, label: t("themeSystem"), icon: Monitor },
    ];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("settings")}
                    className="font-semibold"
                >
                    {emailInitial(userEmail)}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0">
                <div className="flex items-center gap-3 border-b p-3">
                    <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                        aria-hidden="true"
                    >
                        {emailInitial(userEmail)}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                            {userEmail || t("signOut")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {isAdmin ? t("adminDashboard") : ""}
                        </p>
                    </div>
                </div>

                <div className="p-1">
                    <DropdownMenuItem onSelect={onOpenSettings}>
                        <Settings />
                        <span className="flex-1">{t("settings")}</span>
                        <Kbd>,</Kbd>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onOpenShortcuts}>
                        <Keyboard />
                        <span className="flex-1">{t("keyboardShortcuts")}</span>
                        <Kbd>?</Kbd>
                    </DropdownMenuItem>
                    {isAdmin && (
                        <DropdownMenuItem onSelect={() => push("/admin")}>
                            <Shield />
                            <span className="flex-1">
                                {t("adminDashboard")}
                            </span>
                        </DropdownMenuItem>
                    )}
                </div>

                <div className="border-t px-3 py-2">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                        {t("theme")}
                    </div>
                    <div
                        role="radiogroup"
                        aria-label={t("theme")}
                        className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-0.5"
                    >
                        {themeOptions.map((opt) => {
                            const isActive = theme === opt.value;
                            return (
                                // biome-ignore lint/a11y/useSemanticElements: segmented control
                                <button
                                    key={opt.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={isActive}
                                    onClick={() => setTheme(opt.value)}
                                    className={cn(
                                        "inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                                        isActive
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    <opt.icon
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <DropdownMenuSeparator className="my-0" />

                {/* Sign out */}
                <div className="p-1">
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={async () => {
                            await signOut();
                            push("/");
                            refresh();
                        }}
                    >
                        <LogOut />
                        {t("signOut")}
                    </DropdownMenuItem>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
