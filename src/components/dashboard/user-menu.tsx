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
import posthog from "posthog-js";
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
    /** Display name from the session, when the account has one. */
    userName?: string | null;
    /**
     * `icon`: the header's square initial button. `sidebar`: avatar plus
     * name, filling the sidebar's account row.
     */
    trigger?: "icon" | "sidebar";
    onOpenSettings: () => void;
    /** Called on hover or focus of the Settings item so its data can load before the click. */
    onSettingsIntent: () => void;
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

/** Up to two initials from the display name, else the email's first letter. */
export function accountInitials(
    name: string | null | undefined,
    email: string | null,
): string {
    const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return emailInitial(email);
    const first = words[0][0] ?? "";
    const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
    return `${first}${last}`.toUpperCase();
}

function AccountAvatar({ initials }: { initials: string }) {
    return (
        <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-terracotta-wash text-xs font-semibold text-terracotta"
            aria-hidden="true"
        >
            {initials}
        </span>
    );
}

export function UserMenu({
    isAdmin,
    initialTheme,
    userEmail,
    userName = null,
    trigger = "icon",
    onOpenSettings,
    onSettingsIntent,
    onOpenShortcuts,
}: UserMenuProps) {
    const { push, refresh } = useRouter();
    const { theme, setTheme } = useTheme(initialTheme);

    const themeOptions = [
        { value: "light" as const, label: "Light", icon: Sun },
        { value: "dark" as const, label: "Dark", icon: Moon },
        { value: "system" as const, label: "Auto", icon: Monitor },
    ];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger === "sidebar" ? (
                    <button
                        type="button"
                        aria-label="Account menu"
                        className="squircle flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-inner)] px-1.5 py-1 text-left outline-none select-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent"
                    >
                        <AccountAvatar
                            initials={accountInitials(userName, userEmail)}
                        />
                        <span className="truncate text-ui font-medium text-foreground">
                            {userName || userEmail || "Account"}
                        </span>
                    </button>
                ) : (
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label="Account menu"
                        className="font-semibold"
                    >
                        {emailInitial(userEmail)}
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align={trigger === "sidebar" ? "start" : "end"}
                side={trigger === "sidebar" ? "top" : "bottom"}
                className="w-72 p-0"
            >
                <div className="flex items-center gap-3 border-b p-3">
                    <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                        aria-hidden="true"
                    >
                        {emailInitial(userEmail)}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                            {userEmail || "Signed in"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {isAdmin ? "Admin" : "Signed in"}
                        </p>
                    </div>
                </div>

                <div className="p-1">
                    <DropdownMenuItem
                        onSelect={onOpenSettings}
                        onPointerEnter={onSettingsIntent}
                        onFocus={onSettingsIntent}
                    >
                        <Settings />
                        <span className="flex-1">Settings</span>
                        <Kbd>,</Kbd>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onOpenShortcuts}>
                        <Keyboard />
                        <span className="flex-1">Keyboard shortcuts</span>
                        <Kbd>?</Kbd>
                    </DropdownMenuItem>
                    {isAdmin && (
                        <DropdownMenuItem onSelect={() => push("/admin")}>
                            <Shield />
                            <span className="flex-1">Admin dashboard</span>
                        </DropdownMenuItem>
                    )}
                </div>

                <div className="border-t px-3 py-2">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                        Theme
                    </div>
                    <div
                        role="radiogroup"
                        aria-label="Theme"
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
                            if (posthog.__loaded) {
                                posthog.capture("user_signed_out");
                                posthog.reset();
                            }
                            await signOut();
                            push("/");
                            refresh();
                        }}
                    >
                        <LogOut />
                        Log out
                    </DropdownMenuItem>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
