"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsNavLinks, productNavLinks } from "@/components/landing/nav-links";
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";

const topLevelLinkClassName =
    "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:bg-accent data-[active]:text-accent-foreground";

export function LandingNavMenu() {
    const pathname = usePathname();
    const productActive = pathname === "/for-professionals";

    return (
        <NavigationMenu className="hidden md:flex" delayDuration={80}>
            <NavigationMenuList>
                <NavigationMenuItem>
                    <NavigationMenuTrigger
                        className={cn(
                            productActive && "bg-accent text-accent-foreground",
                        )}
                    >
                        Product
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                        <div className="grid w-[42rem] grid-cols-[minmax(0,1fr)_14rem] p-2">
                            <div className="grid content-start items-start grid-cols-2 gap-1 p-1">
                                {productNavLinks.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <NavigationMenuLink
                                            asChild
                                            key={item.href}
                                        >
                                            <Link
                                                href={item.href}
                                                className="group/link flex gap-3 rounded-lg p-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                                            >
                                                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors group-hover/link:text-foreground">
                                                    <Icon
                                                        aria-hidden="true"
                                                        className="size-4"
                                                    />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block text-sm font-semibold text-foreground">
                                                        {item.label}
                                                    </span>
                                                    <span className="mt-1 block text-pretty text-xs leading-5 text-muted-foreground">
                                                        {item.description}
                                                    </span>
                                                </span>
                                            </Link>
                                        </NavigationMenuLink>
                                    );
                                })}
                            </div>

                            <div className="border-l border-border/60 bg-muted/30 p-3">
                                <p className="font-mono text-xs font-semibold uppercase text-foreground/70">
                                    Start here
                                </p>
                                <div className="mt-2 flex flex-col">
                                    {docsNavLinks.map((item) => (
                                        <NavigationMenuLink
                                            asChild
                                            key={item.href}
                                        >
                                            <Link
                                                href={item.href}
                                                className="rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                                            >
                                                <span className="block text-sm font-medium text-foreground">
                                                    {item.label}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                                    {item.description}
                                                </span>
                                            </Link>
                                        </NavigationMenuLink>
                                    ))}
                                </div>
                                <NavigationMenuLink asChild>
                                    <Link
                                        href="/docs"
                                        className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                                    >
                                        All documentation
                                        <ArrowRight
                                            aria-hidden="true"
                                            className="size-3.5"
                                        />
                                    </Link>
                                </NavigationMenuLink>
                            </div>
                        </div>
                    </NavigationMenuContent>
                </NavigationMenuItem>

                <NavigationMenuItem>
                    <NavigationMenuLink
                        asChild
                        active={pathname.startsWith("/docs")}
                    >
                        <Link href="/docs" className={topLevelLinkClassName}>
                            Docs
                        </Link>
                    </NavigationMenuLink>
                </NavigationMenuItem>

                <NavigationMenuItem>
                    <NavigationMenuLink
                        asChild
                        active={pathname === "/changelog"}
                    >
                        <Link
                            href="/changelog"
                            className={topLevelLinkClassName}
                        >
                            Changelog
                        </Link>
                    </NavigationMenuLink>
                </NavigationMenuItem>
            </NavigationMenuList>
        </NavigationMenu>
    );
}
