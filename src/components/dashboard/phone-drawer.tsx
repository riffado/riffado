"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
    BookOpen,
    Bug,
    Code,
    Keyboard,
    LogOut,
    ScrollText,
    Search,
    Settings,
    Shield,
    X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
    type ComponentProps,
    type ReactNode,
    type RefObject,
    useRef,
    useState,
} from "react";
import { flushSync } from "react-dom";
import { AppVersionLine } from "@/components/app-links";
import {
    LibraryNavItem,
    RecordersSection,
} from "@/components/dashboard/library-sidebar";
import {
    AccountAvatar,
    accountInitials,
    useLogOut,
} from "@/components/dashboard/user-menu";
import { LogoWordmark } from "@/components/icons/logo";
import { ReportBugDialog } from "@/components/report-bug-dialog";
import { cn } from "@/lib/utils";
import { APP_SOURCE_URL } from "@/lib/version";
import type { RecorderDevice } from "@/types/device";
import "@/components/dashboard/phone-drawer.css";

/** A swipe this far left (share of the drawer's width) closes it. */
const CLOSE_DISTANCE = 0.4;
/** A flick faster than this (px/ms) closes it at any distance. */
const CLOSE_VELOCITY = 0.11;
/** Movement before a touch counts as a horizontal swipe or a scroll. */
const SLOP = 8;
/** Share of a pull to the right the drawer follows (it has nowhere to go). */
const RUBBER_BAND = 0.2;

interface Swipe {
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    offset: number;
    active: boolean;
}

/**
 * Swipe left to close. While the finger is down the sheet follows it 1:1
 * (rubber-banding to the right) and the scrim fades with it; on release
 * it closes past 40% or on a flick, otherwise it snaps back. Writes
 * `transform` and `opacity` directly so nothing re-renders per move.
 */
function useSwipeToClose(onClose: () => void) {
    const contentRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const swipe = useRef<Swipe | null>(null);
    const justSwiped = useRef(false);

    const snapBack = () => {
        const sheet = contentRef.current;
        const overlay = overlayRef.current;
        for (const el of [sheet, overlay]) {
            if (!el) continue;
            el.style.transition =
                "transform var(--duration-push-in) var(--ease-out), opacity var(--duration-push-in) var(--ease-out)";
            el.style.transform = "";
            el.style.opacity = "";
        }
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" || swipe.current) return;
        swipe.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startTime: e.timeStamp,
            offset: 0,
            active: false,
        };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const s = swipe.current;
        const sheet = contentRef.current;
        if (!s || !sheet || e.pointerId !== s.pointerId) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (!s.active) {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
            if (Math.abs(dy) >= Math.abs(dx) || dx > 0) {
                swipe.current = null;
                return;
            }
            s.active = true;
            try {
                sheet.setPointerCapture(e.pointerId);
            } catch {
                // The pointer already ended; the swipe still tracks moves.
            }
            for (const el of [sheet, overlayRef.current]) {
                if (!el) continue;
                for (const animation of el.getAnimations?.() ?? []) {
                    animation.commitStyles();
                    animation.cancel();
                }
                el.style.transition = "none";
            }
        }
        s.offset = dx < 0 ? dx : dx * RUBBER_BAND;
        sheet.style.transform = `translateX(${s.offset}px)`;
        const overlay = overlayRef.current;
        if (overlay) {
            const progress = Math.min(
                1,
                -Math.min(0, s.offset) / sheet.offsetWidth,
            );
            overlay.style.opacity = String(1 - progress);
        }
    };

    const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
        const s = swipe.current;
        if (!s || e.pointerId !== s.pointerId) return;
        swipe.current = null;
        if (!s.active) return;
        justSwiped.current = true;
        window.setTimeout(() => {
            justSwiped.current = false;
        }, 0);
        const width = contentRef.current?.offsetWidth ?? 1;
        const elapsed = Math.max(1, e.timeStamp - s.startTime);
        const velocity = -s.offset / elapsed;
        const passed = -s.offset > width * CLOSE_DISTANCE;
        if (e.type === "pointerup" && (passed || velocity > CLOSE_VELOCITY)) {
            onClose();
        } else {
            snapBack();
        }
    };

    const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!justSwiped.current) return;
        justSwiped.current = false;
        e.preventDefault();
        e.stopPropagation();
    };

    return {
        contentRef,
        overlayRef,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: onPointerEnd,
            onPointerCancel: onPointerEnd,
            onClickCapture,
        },
    };
}

const itemClass =
    "squircle flex h-11 w-full shrink-0 items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-row leading-5 text-foreground outline-none select-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent [&_svg]:size-4.5 [&_svg]:shrink-0";

function DrawerButton({
    icon,
    children,
    className,
    ...props
}: ComponentProps<"button"> & { icon: ReactNode }) {
    return (
        <button type="button" className={cn(itemClass, className)} {...props}>
            {icon}
            {children}
        </button>
    );
}

function DrawerLink({
    icon,
    href,
    children,
    onClick,
}: {
    icon: ReactNode;
    href: string;
    children: ReactNode;
    onClick: () => void;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={itemClass}
            onClick={onClick}
        >
            {icon}
            {children}
        </a>
    );
}

interface PhoneDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The menu button; it opens the drawer and gets focus back when it closes. */
    trigger: ReactNode;
    /** Total recordings in the library. The count is hidden at zero. */
    recordingCount: number;
    devices: RecorderDevice[];
    /** True while Plaud has signed the user out (connection invalidated). */
    plaudNeedsReconnect: boolean;
    /** Focuses the list search. Omitted when there is nothing to search. */
    onSearch?: () => void;
    /** Clears search and filters so the full library shows. */
    onShowLibrary: () => void;
    onOpenSettings: () => void;
    /** Called on touch or focus of Settings so its data can load before the tap. */
    onSettingsIntent: () => void;
    onOpenShortcuts: () => void;
    isAdmin: boolean;
    isHosted: boolean;
    userEmail: string | null;
    userName: string | null;
    /** The menu button element; focus returns here when Report a bug closes. */
    returnFocusTo: RefObject<HTMLElement | null>;
}

/**
 * The phone and tablet menu (below `lg`): the desktop sidebar's Search,
 * Library and Recorders, Settings, then the account items the sidebar's
 * account menu holds, including the AGPL source offer. A left sheet on
 * Radix Dialog: focus is trapped and returned, Escape, a tap on the
 * scrim or a swipe left closes it.
 */
export function PhoneDrawer({
    open,
    onOpenChange,
    trigger,
    recordingCount,
    devices,
    plaudNeedsReconnect,
    onSearch,
    onShowLibrary,
    onOpenSettings,
    onSettingsIntent,
    onOpenShortcuts,
    isAdmin,
    isHosted,
    userEmail,
    userName,
    returnFocusTo,
}: PhoneDrawerProps) {
    const { push } = useRouter();
    const logOut = useLogOut();
    const [reportOpen, setReportOpen] = useState(false);
    const close = () => onOpenChange(false);
    const { contentRef, overlayRef, handlers } = useSwipeToClose(close);
    // Runs once the drawer has closed and handed focus back to the menu
    // button, so a dialog it opens returns focus there too.
    const afterClose = useRef<(() => void) | null>(null);
    // Search moves focus to the list itself, not back to the menu button.
    const keepFocus = useRef(false);

    const closeThen = (fn: () => void) => {
        afterClose.current = fn;
        close();
    };

    const name = userName?.trim() || null;

    return (
        <>
            <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
                <DialogPrimitive.Trigger asChild>
                    {trigger}
                </DialogPrimitive.Trigger>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay
                        ref={overlayRef}
                        className="phone-drawer-overlay fixed inset-0 z-50 bg-ink/32"
                    />
                    <DialogPrimitive.Content
                        ref={contentRef}
                        aria-describedby={undefined}
                        className="phone-drawer fixed inset-y-0 left-0 z-50 flex w-79 max-w-[calc(100%-3.5rem)] flex-col overflow-y-auto overscroll-contain bg-surface px-3 pt-[max(env(safe-area-inset-top),0.25rem)] pb-[max(env(safe-area-inset-bottom),1rem)] shadow-[0_0_0_1px_rgb(20_20_19/0.06),12px_0_40px_rgb(20_20_19/0.16)] outline-none"
                        onCloseAutoFocus={(e) => {
                            if (keepFocus.current) {
                                keepFocus.current = false;
                                e.preventDefault();
                                return;
                            }
                            const fn = afterClose.current;
                            if (!fn) return;
                            afterClose.current = null;
                            queueMicrotask(fn);
                        }}
                        {...handlers}
                    >
                        <DialogPrimitive.Title className="sr-only">
                            Menu
                        </DialogPrimitive.Title>
                        <div className="flex h-13 shrink-0 items-center justify-between pl-2.5">
                            <LogoWordmark className="h-5 w-auto text-strong" />
                            <DialogPrimitive.Close
                                aria-label="Close menu"
                                className="motion-press squircle flex size-11 items-center justify-center rounded-[var(--radius-control)] text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            >
                                <X className="size-5" aria-hidden="true" />
                            </DialogPrimitive.Close>
                        </div>

                        <div className="flex shrink-0 flex-col gap-5 pt-3 pb-6">
                            {onSearch ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Close before focusing, inside the
                                        // tap, so phones raise the keyboard.
                                        keepFocus.current = true;
                                        flushSync(close);
                                        onSearch();
                                    }}
                                    className="squircle flex h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] border border-border bg-card px-3 text-left text-row leading-5 text-muted-foreground outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    <Search
                                        className="size-4.5 shrink-0 text-foreground"
                                        aria-hidden="true"
                                    />
                                    Search
                                </button>
                            ) : null}

                            <nav aria-label="Library" className="flex flex-col">
                                <LibraryNavItem
                                    variant="drawer"
                                    recordingCount={recordingCount}
                                    onClick={() => {
                                        onShowLibrary();
                                        close();
                                    }}
                                />
                            </nav>

                            <RecordersSection
                                variant="drawer"
                                devices={devices}
                                plaudNeedsReconnect={plaudNeedsReconnect}
                            />

                            <DrawerButton
                                icon={<Settings aria-hidden="true" />}
                                className="font-medium"
                                onClick={() => {
                                    close();
                                    onOpenSettings();
                                }}
                                onPointerDown={onSettingsIntent}
                                onFocus={onSettingsIntent}
                            >
                                Settings
                            </DrawerButton>
                        </div>

                        <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t border-border pt-2.5">
                            <div className="flex min-w-0 items-center gap-2 pt-2 pr-3 pb-2.5 pl-2">
                                <AccountAvatar
                                    initials={accountInitials(
                                        userName,
                                        userEmail,
                                    )}
                                />
                                <div className="flex min-w-0 flex-col gap-px select-none">
                                    <p className="truncate text-row leading-5 font-medium text-strong">
                                        {name ?? userEmail ?? "Account"}
                                    </p>
                                    {name && userEmail ? (
                                        <p className="truncate text-small leading-4 text-muted-foreground">
                                            {userEmail}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                            <DrawerButton
                                icon={<Keyboard aria-hidden="true" />}
                                className="max-md:hidden"
                                onClick={() => closeThen(onOpenShortcuts)}
                            >
                                Keyboard shortcuts
                            </DrawerButton>
                            {isAdmin ? (
                                <DrawerButton
                                    icon={<Shield aria-hidden="true" />}
                                    onClick={() => {
                                        close();
                                        push("/admin");
                                    }}
                                >
                                    Admin dashboard
                                </DrawerButton>
                            ) : null}
                            <DrawerLink
                                href="/docs"
                                icon={<BookOpen aria-hidden="true" />}
                                onClick={close}
                            >
                                Docs
                            </DrawerLink>
                            <DrawerLink
                                href="/changelog"
                                icon={<ScrollText aria-hidden="true" />}
                                onClick={close}
                            >
                                Changelog
                            </DrawerLink>
                            <DrawerButton
                                icon={<Bug aria-hidden="true" />}
                                onClick={() =>
                                    closeThen(() => setReportOpen(true))
                                }
                            >
                                Report a bug
                            </DrawerButton>
                            <DrawerLink
                                href={APP_SOURCE_URL}
                                icon={<Code aria-hidden="true" />}
                                onClick={close}
                            >
                                Source code
                            </DrawerLink>
                            <DrawerButton
                                icon={<LogOut aria-hidden="true" />}
                                onClick={() => void logOut()}
                            >
                                Log out
                            </DrawerButton>
                            <AppVersionLine className="px-3 pt-2 select-none" />
                        </div>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
            <ReportBugDialog
                isHosted={isHosted}
                open={reportOpen}
                onOpenChange={setReportOpen}
                returnFocusTo={returnFocusTo}
            />
        </>
    );
}
