/**
 * Shared look for every popover menu (dropdown, context menu, select),
 * so they read as one family. Paper: 01 Foundations > System > Menus &
 * dialogs. Each primitive adds its own Radix transform-origin variable.
 */

/** Card surface, 16px squircle, 6px padding, soft border and shadow. */
export const menuSurfaceClass =
    "motion-popover squircle z-50 overflow-x-hidden overflow-y-auto rounded-[var(--radius-menu)] border border-menu-border bg-menu-surface p-1.5 text-strong shadow-menu outline-none";

/** 36px row, 10px squircle, 16px subtle icon, 14px ink label. */
export const menuItemClass =
    "squircle relative flex h-9 w-full cursor-default items-center gap-2.5 rounded-[var(--radius-small)] px-2.5 text-ui text-strong outline-none select-none data-[highlighted]:bg-menu-highlight data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.8] [&_svg:not([class*='text-'])]:text-subtle";

/** Hairline between groups, inset from the item edges. */
export const menuSeparatorClass =
    "pointer-events-none mx-1 my-1 h-px bg-menu-border";

/** Quiet group heading. */
export const menuLabelClass =
    "px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground select-none";
