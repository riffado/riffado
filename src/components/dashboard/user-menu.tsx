"use client";

import { Keyboard, LogOut, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useRef, useState } from "react";
import { AppLinksMenuItems, AppVersionLine } from "@/components/app-links";
import { ReportBugDialog } from "@/components/report-bug-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UserMenuProps {
    isAdmin: boolean;
    isHosted: boolean;
    userEmail: string | null;
    /** Display name from the session, when the account has one. */
    userName?: string | null;
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

/** Sand circle with ink initials (DESIGN.md: account items). */
export function AccountAvatar({
    initials,
    size = "default",
}: {
    initials: string;
    size?: "default" | "large";
}) {
    return (
        <span
            className={cn(
                "flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-strong select-none",
                size === "large" ? "size-9 text-sm" : "size-7 text-xs",
            )}
            aria-hidden="true"
        >
            {initials}
        </span>
    );
}

/** Logs out, resets analytics and returns to the start page. */
export function useLogOut() {
    const { push, refresh } = useRouter();
    return async () => {
        if (posthog.__loaded) {
            posthog.capture("user_signed_out");
            posthog.reset();
        }
        await signOut();
        push("/");
        refresh();
    };
}

/**
 * The desktop sidebar's account row and menu: name and email, Keyboard
 * shortcuts, the about links and Log out. On phones the same items live
 * in the menu drawer.
 */
export function UserMenu({
    isAdmin,
    isHosted,
    userEmail,
    userName = null,
    onOpenShortcuts,
}: UserMenuProps) {
    const { push } = useRouter();
    const logOut = useLogOut();
    const [reportOpen, setReportOpen] = useState(false);
    // Set by Report a bug; the dialog opens once the menu has closed and
    // handed focus back to its trigger, so the dialog returns it there.
    const reportPending = useRef(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const name = userName?.trim() || null;
    const initials = accountInitials(userName, userEmail);

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        ref={triggerRef}
                        type="button"
                        aria-label="Account menu"
                        className="squircle flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-inner)] px-1.5 py-1 text-left outline-none select-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent"
                    >
                        <AccountAvatar initials={initials} />
                        <span className="truncate text-ui font-medium text-foreground">
                            {userName || userEmail || "Account"}
                        </span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-72 p-0"
                    onCloseAutoFocus={() => {
                        if (!reportPending.current) return;
                        reportPending.current = false;
                        queueMicrotask(() => setReportOpen(true));
                    }}
                >
                    <div className="flex items-center gap-3 border-b p-3 select-none">
                        <AccountAvatar initials={initials} size="large" />
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
                            onSelect={logOut}
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
