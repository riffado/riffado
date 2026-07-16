"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    productNavLinks,
    resourceNavLinks,
} from "@/components/landing/nav-links";
import { MetalButton } from "@/components/metal-button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function isActiveLink(pathname: string, href: string) {
    if (href.startsWith("/#")) return false;
    if (href === "/docs") return pathname.startsWith("/docs");
    return pathname === href;
}

export function LandingNavMobile() {
    const pathname = usePathname();

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    type="button"
                    aria-label="Open navigation menu"
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-background hover:text-foreground md:hidden"
                >
                    <Menu aria-hidden="true" className="size-4" />
                </button>
            </DialogTrigger>
            <DialogContent className="inset-x-0 top-0 left-0 max-h-dvh w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-x-0 border-t-0 p-0 pt-[env(safe-area-inset-top)] shadow-lg motion-reduce:animate-none sm:max-w-none">
                <div className="flex h-16 items-center border-b border-border/60 px-4">
                    <DialogTitle className="text-base">Menu</DialogTitle>
                </div>

                <nav className="mx-auto flex w-full max-w-lg flex-col px-4 py-6">
                    <p className="px-2 font-mono text-xs font-semibold uppercase text-foreground/70">
                        Product
                    </p>
                    <div className="mt-2 grid gap-1">
                        {productNavLinks.map((item) => {
                            const Icon = item.icon;
                            const active = isActiveLink(pathname, item.href);
                            return (
                                <DialogClose asChild key={item.href}>
                                    <Link
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg px-2 py-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                                            active && "bg-accent",
                                        )}
                                    >
                                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
                                            <Icon
                                                aria-hidden="true"
                                                className="size-4"
                                            />
                                        </span>
                                        <span>
                                            <span className="block text-sm font-semibold text-foreground">
                                                {item.label}
                                            </span>
                                            <span className="mt-0.5 block text-pretty text-xs text-muted-foreground">
                                                {item.description}
                                            </span>
                                        </span>
                                    </Link>
                                </DialogClose>
                            );
                        })}
                    </div>

                    <div className="my-5 h-px bg-border/60" />

                    <p className="px-2 font-mono text-xs font-semibold uppercase text-foreground/70">
                        Resources
                    </p>
                    <div className="mt-2 grid gap-1">
                        {resourceNavLinks.map((item) => (
                            <DialogClose asChild key={item.href}>
                                <Link
                                    href={item.href}
                                    className={cn(
                                        "rounded-lg px-2 py-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                                        isActiveLink(pathname, item.href) &&
                                            "bg-accent",
                                    )}
                                >
                                    {item.label}
                                </Link>
                            </DialogClose>
                        ))}
                    </div>

                    <DialogClose asChild>
                        <MetalButton
                            asChild
                            className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            <Link href="/login">Login</Link>
                        </MetalButton>
                    </DialogClose>
                </nav>
            </DialogContent>
        </Dialog>
    );
}
