"use client";

import { ChevronDown } from "lucide-react";
import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function NavigationMenu({
    className,
    children,
    viewport = true,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
    viewport?: boolean;
}) {
    return (
        <NavigationMenuPrimitive.Root
            data-slot="navigation-menu"
            data-viewport={viewport}
            className={cn(
                "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
                className,
            )}
            {...props}
        >
            {children}
            {viewport ? <NavigationMenuViewport /> : null}
        </NavigationMenuPrimitive.Root>
    );
}

function NavigationMenuList({
    className,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
    return (
        <NavigationMenuPrimitive.List
            data-slot="navigation-menu-list"
            className={cn(
                "group flex flex-1 list-none items-center justify-center gap-1",
                className,
            )}
            {...props}
        />
    );
}

function NavigationMenuItem({
    className,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
    return (
        <NavigationMenuPrimitive.Item
            data-slot="navigation-menu-item"
            className={cn("relative", className)}
            {...props}
        />
    );
}

const navigationMenuTriggerClassName =
    "group inline-flex h-9 items-center justify-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

function NavigationMenuTrigger({
    className,
    children,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
    return (
        <NavigationMenuPrimitive.Trigger
            data-slot="navigation-menu-trigger"
            className={cn(navigationMenuTriggerClassName, className)}
            {...props}
        >
            {children}
            <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
        </NavigationMenuPrimitive.Trigger>
    );
}

function NavigationMenuContent({
    className,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
    return (
        <NavigationMenuPrimitive.Content
            data-slot="navigation-menu-content"
            className={cn(
                "top-0 left-0 w-full p-1 outline-none md:absolute md:w-auto data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in data-[motion^=from-]:zoom-in-95 data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out data-[motion^=to-]:zoom-out-95 motion-reduce:animate-none",
                className,
            )}
            {...props}
        />
    );
}

function NavigationMenuLink({
    className,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
    return (
        <NavigationMenuPrimitive.Link
            data-slot="navigation-menu-link"
            className={cn("outline-none", className)}
            {...props}
        />
    );
}

function NavigationMenuViewport({
    className,
    ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
    return (
        <div className="absolute top-full left-1/2 z-50 flex -translate-x-1/2 justify-center pt-3">
            <NavigationMenuPrimitive.Viewport
                data-slot="navigation-menu-viewport"
                className={cn(
                    "relative h-(--radix-navigation-menu-viewport-height) w-(--radix-navigation-menu-viewport-width) origin-top overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg transition-[width,height] duration-200 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 motion-reduce:animate-none motion-reduce:transition-none",
                    className,
                )}
                {...props}
            />
        </div>
    );
}

export {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    NavigationMenuViewport,
    navigationMenuTriggerClassName,
};
