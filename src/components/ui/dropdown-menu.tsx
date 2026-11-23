"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type * as React from "react";
import {
    menuItemClass,
    menuLabelClass,
    menuSeparatorClass,
    menuSurfaceClass,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

function DropdownMenu(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>,
) {
    return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
) {
    return (
        <DropdownMenuPrimitive.Trigger
            data-slot="dropdown-menu-trigger"
            {...props}
        />
    );
}

function DropdownMenuGroup(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>,
) {
    return (
        <DropdownMenuPrimitive.Group
            data-slot="dropdown-menu-group"
            {...props}
        />
    );
}

function DropdownMenuPortal(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>,
) {
    return (
        <DropdownMenuPrimitive.Portal
            data-slot="dropdown-menu-portal"
            {...props}
        />
    );
}

function DropdownMenuSub(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>,
) {
    return (
        <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
    );
}

function DropdownMenuRadioGroup(
    props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
    return (
        <DropdownMenuPrimitive.RadioGroup
            data-slot="dropdown-menu-radio-group"
            {...props}
        />
    );
}

function DropdownMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
}) {
    return (
        <DropdownMenuPrimitive.SubTrigger
            data-slot="dropdown-menu-sub-trigger"
            className={cn(
                menuItemClass,
                "data-[state=open]:bg-menu-highlight",
                inset && "pl-9",
                className,
            )}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto text-muted-foreground" />
        </DropdownMenuPrimitive.SubTrigger>
    );
}

function DropdownMenuSubContent({
    className,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.SubContent
                data-slot="dropdown-menu-sub-content"
                className={cn(
                    menuSurfaceClass,
                    "max-h-(--radix-dropdown-menu-content-available-height) min-w-40 origin-(--radix-dropdown-menu-content-transform-origin)",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}

function DropdownMenuContent({
    className,
    sideOffset = 4,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                data-slot="dropdown-menu-content"
                sideOffset={sideOffset}
                className={cn(
                    menuSurfaceClass,
                    "max-h-(--radix-dropdown-menu-content-available-height) min-w-40 origin-(--radix-dropdown-menu-content-transform-origin)",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}

/**
 * Menu row. `variant="destructive"` is kept for call sites but renders
 * in ink like every item: the confirm dialog carries the weight.
 */
function DropdownMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    return (
        <DropdownMenuPrimitive.Item
            data-slot="dropdown-menu-item"
            data-variant={variant}
            className={cn(menuItemClass, inset && "pl-9", className)}
            {...props}
        />
    );
}

function DropdownMenuCheckboxItem({
    className,
    children,
    checked,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
    return (
        <DropdownMenuPrimitive.CheckboxItem
            data-slot="dropdown-menu-checkbox-item"
            className={cn(menuItemClass, "pr-8", className)}
            checked={checked}
            {...props}
        >
            {children}
            <span className="absolute right-2.5 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="text-strong" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
        </DropdownMenuPrimitive.CheckboxItem>
    );
}

function DropdownMenuRadioItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
    return (
        <DropdownMenuPrimitive.RadioItem
            data-slot="dropdown-menu-radio-item"
            className={cn(menuItemClass, "pr-8", className)}
            {...props}
        >
            {children}
            <span className="absolute right-2.5 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="text-strong" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
        </DropdownMenuPrimitive.RadioItem>
    );
}

function DropdownMenuLabel({
    className,
    inset,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
}) {
    return (
        <DropdownMenuPrimitive.Label
            data-slot="dropdown-menu-label"
            className={cn(menuLabelClass, inset && "pl-9", className)}
            {...props}
        />
    );
}

function DropdownMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    return (
        <DropdownMenuPrimitive.Separator
            data-slot="dropdown-menu-separator"
            className={cn(menuSeparatorClass, className)}
            {...props}
        />
    );
}

function DropdownMenuShortcut({
    className,
    ...props
}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="dropdown-menu-shortcut"
            className={cn(
                "ml-auto text-xs tracking-widest text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

export {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
};
