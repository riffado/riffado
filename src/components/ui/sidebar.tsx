"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SidebarContext = React.createContext<{
    open?: boolean;
}>({});

function SidebarProvider({
    children,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <SidebarContext.Provider value={{ open: true }}>
            <div className={cn("flex h-full w-full", className)} {...props}>
                {children}
            </div>
        </SidebarContext.Provider>
    );
}

function Sidebar({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex h-full w-64 flex-col border-r bg-muted/40",
                className,
            )}
            {...props}
        />
    );
}

function SidebarContent({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex flex-1 flex-col gap-2 overflow-y-auto p-4",
                className,
            )}
            {...props}
        />
    );
}

function SidebarGroup({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("space-y-1", className)} {...props} />;
}

function SidebarGroupContent({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("space-y-1", className)} {...props} />;
}

function SidebarMenu({
    className,
    ...props
}: React.HTMLAttributes<HTMLUListElement>) {
    return <ul className={cn("space-y-1", className)} {...props} />;
}

function SidebarMenuItem({
    className,
    ...props
}: React.HTMLAttributes<HTMLLIElement>) {
    return <li className={cn("", className)} {...props} />;
}

function SidebarMenuButton({
    className,
    isActive,
    asChild = false,
    children,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    isActive?: boolean;
    asChild?: boolean;
}) {
    const Comp = asChild ? React.Fragment : "button";
    const buttonProps = asChild ? {} : props;

    return (
        <Comp
            className={cn(
                // focus-visible (not focus) so the ring is only shown for
                // keyboard navigation; mouse users don't get a stuck
                // outline after clicking. The ring uses theme tokens so
                // it inherits dark mode + custom themes automatically.
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                className,
            )}
            {...buttonProps}
        >
            {children}
        </Comp>
    );
}

export {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarProvider,
};
