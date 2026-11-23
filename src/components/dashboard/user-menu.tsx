"use client";

import { Keyboard, LogOut, Settings, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useRef, useState } from "react";
import { AppLinksMenuItems, AppVersionLine } from "@/components/app-links";
import { ReportBugDialog } from "@/components/report-bug-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";

interface UserMenuProps {
    isAdmin: boolean;
    isHosted: boolean;
    userEmail: string | null;
    /** Display name from the session, when the account has one. */
    userName?: string | null;
    /**
     * `icon`: the phone and tablet header's square initial button, whose
     * menu also opens Settings (that header has no Settings button).
     * `sidebar`: avatar plus name, filling the sidebar's account row,
     * next to its own Settings button.
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
    isHosted,
    userEmail,
    userName = null,
    trigger = "icon",
    onOpenSettings,
    onSettingsIntent,
    onOpenShortcuts,
}: UserMenuProps) {
    const { push, refresh } = useRouter();
    const [reportOpen, setReportOpen] = useState(false);
    // Set by Report a bug; the dialog opens once the menu has closed and
    // handed focus back to its trigger, so the dialog returns it there.
    const reportPending = useRef(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const name = userName?.trim() || null;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    {trigger === "sidebar" ? (
                        <button
                            ref={triggerRef}
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
                            ref={triggerRef}
                            variant="outline"
                            size="icon"
                            aria-label="Account menu"
                            className="size-11 font-semibold"
                        >
                            {emailInitial(userEmail)}
                        </Button>
                    )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align={trigger === "sidebar" ? "start" : "end"}
                    side={trigger === "sidebar" ? "top" : "bottom"}
                    className="w-72 p-0"
                    onCloseAutoFocus={() => {
                        if (!reportPending.current) return;
                        reportPending.current = false;
                        queueMicrotask(() => setReportOpen(true));
                    }}
                >
                    <div className="flex items-center gap-3 border-b p-3 select-none">
                        <div
                            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                            aria-hidden="true"
                        >
                            {accountInitials(userName, userEmail)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                                {name ?? userEmail ?? "Account"}
                            </p>
                            {name && userEmail ? (
                                <p className="truncate text-xs text-muted-foreground">
                                    {userEmail}
                                </p>
                            ) : null}
                        </div>
                    </div>

                    <div className="p-1">
                        {trigger === "icon" ? (
                            <DropdownMenuItem
                                onSelect={onOpenSettings}
                                onPointerEnter={onSettingsIntent}
                                onFocus={onSettingsIntent}
                            >
                                <Settings />
                                <span className="flex-1">Settings</span>
                                <Kbd>,</Kbd>
                            </DropdownMenuItem>
                        ) : null}
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
                        <DropdownMenuSeparator />
                        <AppLinksMenuItems
                            onReportBug={() => {
                                reportPending.current = true;
                            }}
                        />
                        <DropdownMenuSeparator />
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

                    <AppVersionLine className="border-t px-3.5 py-2.5 select-none" />
                </DropdownMenuContent>
            </DropdownMenu>
            <ReportBugDialog
                isHosted={isHosted}
                open={reportOpen}
                onOpenChange={setReportOpen}
                returnFocusTo={triggerRef}
            />
        </>
    );
}
