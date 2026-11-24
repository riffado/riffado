"use client";

import { Check, ChevronRight } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import type * as React from "react";
import {
    menuItemClass,
    menuLabelClass,
    menuSeparatorClass,
    menuSurfaceClass,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

/**
 * Right-click menu. Same look and API shape as `dropdown-menu`; Radix
 * opens it at the cursor, on long-press, and with Shift+F10 or the menu
 * key on a focused trigger.
 */
function ContextMenu(
    props: React.ComponentProps<typeof ContextMenuPrimitive.Root>,
) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(
    props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>,
) {
    return (
        <ContextMenuPrimitive.Trigger
            data-slot="context-menu-trigger"
            {...props}
        />
    );
}

function ContextMenuGroup(
    props: React.ComponentProps<typeof ContextMenuPrimitive.Group>,
) {
    return (
        <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
    );
}

function ContextMenuPortal(
    props: React.ComponentProps<typeof ContextMenuPrimitive.Portal>,
) {
    return (
        <ContextMenuPrimitive.Portal
            data-slot="context-menu-portal"
            {...props}
        />
    );
}

function ContextMenuSub(
    props: React.ComponentProps<typeof ContextMenuPrimitive.Sub>,
) {
    return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuRadioGroup(
    props: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>,
) {
    return (
        <ContextMenuPrimitive.RadioGroup
            data-slot="context-menu-radio-group"
            {...props}
        />
    );
}

function ContextMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.SubTrigger
            data-slot="context-menu-sub-trigger"
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
        </ContextMenuPrimitive.SubTrigger>
    );
}

function ContextMenuSubContent({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.SubContent
                data-slot="context-menu-sub-content"
                className={cn(
                    menuSurfaceClass,
                    "max-h-(--radix-context-menu-content-available-height) min-w-40 origin-(--radix-context-menu-content-transform-origin)",
                    className,
                )}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    );
}

function ContextMenuContent({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
                data-slot="context-menu-content"
                className={cn(
                    menuSurfaceClass,
                    "max-h-(--radix-context-menu-content-available-height) min-w-40 origin-(--radix-context-menu-content-transform-origin)",
                    className,
                )}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    );
}

/**
 * Menu row. `variant="destructive"` renders in ink like every item, as
 * in `DropdownMenuItem`.
 */
function ContextMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-variant={variant}
            className={cn(menuItemClass, inset && "pl-9", className)}
            {...props}
        />
    );
}

function ContextMenuCheckboxItem({
    className,
    children,
    checked,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
    return (
        <ContextMenuPrimitive.CheckboxItem
            data-slot="context-menu-checkbox-item"
            className={cn(menuItemClass, "pr-8", className)}
            checked={checked}
            {...props}
        >
            {children}
            <span className="absolute right-2.5 flex size-4 items-center justify-center">
                <ContextMenuPrimitive.ItemIndicator>
                    <Check className="text-strong" />
                </ContextMenuPrimitive.ItemIndicator>
            </span>
        </ContextMenuPrimitive.CheckboxItem>
    );
}

function ContextMenuRadioItem({
    className,
    children,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
    return (
        <ContextMenuPrimitive.RadioItem
            data-slot="context-menu-radio-item"
            className={cn(menuItemClass, "pr-8", className)}
            {...props}
        >
            {children}
            <span className="absolute right-2.5 flex size-4 items-center justify-center">
                <ContextMenuPrimitive.ItemIndicator>
                    <Check className="text-strong" />
                </ContextMenuPrimitive.ItemIndicator>
            </span>
        </ContextMenuPrimitive.RadioItem>
    );
}

function ContextMenuLabel({
    className,
    inset,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.Label
            data-slot="context-menu-label"
            className={cn(menuLabelClass, inset && "pl-9", className)}
            {...props}
        />
    );
}

function ContextMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
    return (
        <ContextMenuPrimitive.Separator
            data-slot="context-menu-separator"
            className={cn(menuSeparatorClass, className)}
            {...props}
        />
    );
}

function ContextMenuShortcut({
    className,
    ...props
}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="context-menu-shortcut"
            className={cn(
                "ml-auto text-xs tracking-widest text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

export {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuPortal,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
};
