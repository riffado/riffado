"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsPageHeader } from "@/components/settings/section-header";
import { SettingsContent } from "@/components/settings-content";
import { buildSettingsNav } from "@/components/settings-nav-config";
import { SettingsNavMobile } from "@/components/settings-nav-mobile";
import { SettingsNavSidebar } from "@/components/settings-nav-sidebar";
import type { Provider } from "@/components/settings-sections/providers-section";
import { touchTargetClass } from "@/components/ui/button";
import { useSettingsNav } from "@/hooks/use-settings-nav";
import { libraryLocation } from "@/lib/library-location";
import { cn } from "@/lib/utils";
import type { RecorderDevice } from "@/types/device";
import type { SettingsPage } from "@/types/settings";

interface SettingsPageContentProps {
    /** The user's providers, read on the server so the first paint is complete. */
    initialProviders: Provider[];
    isHosted?: boolean;
    /** Recorders linked to the Plaud account. Server-supplied. */
    devices: RecorderDevice[];
    /** Last successful Plaud sync (ISO string), or null. Server-supplied. */
    plaudLastSyncAt: string | null;
    /** True when the account has a Plaud connection row. Server-supplied. */
    hasPlaudConnection: boolean;
}

/**
 * The full-page Settings layout: settings sidebar in place of the library
 * sidebar (lg and up), or a list screen that pushes into a page (below
 * lg), and the active page's content column.
 */
export function SettingsPageContent({
    initialProviders,
    isHosted = false,
    devices,
    plaudLastSyncAt,
    hasPlaudConnection,
}: SettingsPageContentProps) {
    const router = useRouter();
    const nav = useMemo(() => buildSettingsNav({ isHosted }), [isHosted]);
    const [providers, setProviders] = useState(initialProviders);
    const [mobileView, setMobileView] = useState<"list" | "page">("list");
    const [pushed, setPushed] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    // True when leaving through the Library link or Escape, which fetch
    // the dashboard fresh anyway.
    const leavingToLibraryRef = useRef(false);

    const exitToLibrary = useCallback(() => {
        leavingToLibraryRef.current = true;
        router.push(libraryLocation());
    }, [router]);

    const {
        activePage,
        setActivePage,
        anchor,
        clearAnchor,
        openedFromHash,
        onNavKeyDown,
    } = useSettingsNav({ nav, onExit: exitToLibrary });

    useEffect(() => {
        router.prefetch(libraryLocation());
    }, [router]);

    // The browser back button restores the Library from the client router
    // cache, which predates anything changed here. Refresh it as Settings
    // goes away. Skipped while still on /settings (React's dev double
    // mount) and when the Library link already fetched it.
    useEffect(() => {
        return () => {
            if (leavingToLibraryRef.current) return;
            if (window.location.pathname === "/settings") return;
            router.refresh();
        };
    }, [router]);

    // A link to a specific page (`/settings#sync`) opens that page on
    // phones too, instead of the list.
    useEffect(() => {
        if (openedFromHash) setMobileView("page");
    }, [openedFromHash]);

    const selectPage = useCallback(
        (page: SettingsPage) => {
            setActivePage(page);
            setPushed(true);
            setMobileView("page");
            contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
            window.scrollTo({ top: 0, behavior: "instant" });
        },
        [setActivePage],
    );

    // Old section links land on their block inside the merged page. The
    // sections load their own data, so the block can move as they fill
    // in; scroll again shortly after unless the user has started
    // scrolling.
    useEffect(() => {
        if (!anchor || !activePage) return;
        setMobileView("page");
        let userScrolled = false;
        const stop = () => {
            userScrolled = true;
        };
        const options = { passive: true, capture: true } as const;
        window.addEventListener("wheel", stop, options);
        window.addEventListener("touchmove", stop, options);
        window.addEventListener("keydown", stop, options);
        const scroll = () => {
            if (userScrolled) return;
            document
                .getElementById(anchor)
                ?.scrollIntoView({ block: "start", behavior: "instant" });
        };
        const frame = requestAnimationFrame(scroll);
        const early = setTimeout(scroll, 300);
        const late = setTimeout(() => {
            scroll();
            clearAnchor();
        }, 900);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(early);
            clearTimeout(late);
            window.removeEventListener("wheel", stop, options);
            window.removeEventListener("touchmove", stop, options);
            window.removeEventListener("keydown", stop, options);
        };
    }, [anchor, activePage, clearAnchor]);

    // Plaud connection changes alter server data the Library renders.
    // `refresh()` re-reads this page (recorders, last sync) and drops the
    // client router cache, so the Library is fetched fresh, including
    // on browser back. A reconnect also starts a sync, as the dashboard
    // did when Settings was a dialog over it.
    const handlePlaudReconnected = useCallback(() => {
        router.refresh();
        void fetch("/api/plaud/sync", { method: "POST" })
            .catch(() => {})
            .finally(() => router.refresh());
    }, [router]);

    const handlePlaudDisconnected = useCallback(() => {
        router.refresh();
    }, [router]);

    const current = nav.find((item) => item.id === activePage) ?? null;

    return (
        <div className="flex-1 bg-reader lg:flex lg:h-dvh">
            <SettingsNavSidebar
                className="hidden lg:flex"
                nav={nav}
                activePage={activePage}
                onSelect={selectPage}
                onNavKeyDown={onNavKeyDown}
                onLeave={() => {
                    leavingToLibraryRef.current = true;
                }}
                isHosted={isHosted}
            />

            <div
                className={cn(
                    "lg:hidden",
                    mobileView === "page" && "hidden",
                    pushed &&
                        "transition-[opacity,translate] duration-(--duration-push-in) ease-(--ease-out) starting:-translate-x-6 starting:opacity-0 motion-reduce:starting:translate-x-0",
                )}
            >
                <SettingsNavMobile
                    nav={nav}
                    onSelect={selectPage}
                    onNavKeyDown={onNavKeyDown}
                    onLeave={() => {
                        leavingToLibraryRef.current = true;
                    }}
                    isHosted={isHosted}
                />
            </div>

            <div
                ref={contentRef}
                className={cn(
                    "min-w-0 flex-1 lg:overflow-y-auto",
                    mobileView === "list" && "max-lg:hidden",
                    pushed &&
                        "max-lg:transition-[opacity,translate] max-lg:duration-(--duration-push-in) max-lg:ease-(--ease-out) max-lg:starting:translate-x-6 max-lg:starting:opacity-0 max-lg:motion-reduce:starting:translate-x-0",
                )}
            >
                <div className="flex max-w-240 flex-col gap-11 px-5 pt-5.5 pb-16 sm:px-10 lg:px-24 lg:pt-14">
                    <button
                        type="button"
                        onClick={() => {
                            setPushed(true);
                            setMobileView("list");
                        }}
                        className={cn(
                            "squircle relative -mb-5 flex h-7 w-fit items-center gap-1.5 rounded-[var(--radius-small)] pr-2 pl-1.5 text-ui font-medium text-subtle outline-none select-none hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden",
                            touchTargetClass,
                        )}
                    >
                        <ChevronLeft className="size-4.5" aria-hidden="true" />
                        Settings
                    </button>
                    {current && (
                        <>
                            <SettingsPageHeader
                                title={current.title}
                                description={current.description}
                            />
                            <SettingsContent
                                key={current.id}
                                page={current.id}
                                providers={providers}
                                onProvidersChange={setProviders}
                                isHosted={isHosted}
                                devices={devices}
                                plaudLastSyncAt={plaudLastSyncAt}
                                hasPlaudConnection={hasPlaudConnection}
                                onPlaudReconnected={handlePlaudReconnected}
                                onPlaudDisconnected={handlePlaudDisconnected}
                                onReRunOnboarding={() =>
                                    setOnboardingOpen(true)
                                }
                            />
                        </>
                    )}
                </div>
            </div>

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    router.push("/dashboard");
                }}
            />
        </div>
    );
}
