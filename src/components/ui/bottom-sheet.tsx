"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A modal sheet that slides up from the bottom of the screen.
 * Uses the same Radix Dialog primitive as the app's existing Dialog,
 * but with bottom-anchored positioning and swipe-friendly sizing.
 */

export const BottomSheet = DialogPrimitive.Root;
export const BottomSheetTrigger = DialogPrimitive.Trigger;
export const BottomSheetClose = DialogPrimitive.Close;

function BottomSheetPortal({ children }: { children: React.ReactNode }) {
    return <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>;
}

function BottomSheetOverlay({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
    return (
        <DialogPrimitive.Overlay
            className={cn(
                "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                className,
            )}
            {...props}
        />
    );
}

function BottomSheetContent({
    className,
    children,
    title,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    title?: string;
}) {
    return (
        <BottomSheetPortal>
            <BottomSheetOverlay />
            <DialogPrimitive.Content
                className={cn(
                    "fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-background pb-safe shadow-xl",
                    "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full",
                    "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-full",
                    "duration-200",
                    className,
                )}
                {...props}
            >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
                </div>

                {title && (
                    <div className="flex items-center justify-between px-5 pb-3 pt-1">
                        <DialogPrimitive.Title className="text-sm font-semibold text-foreground/70">
                            {title}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                            <X className="size-4" />
                        </DialogPrimitive.Close>
                    </div>
                )}

                {!title && (
                    <DialogPrimitive.Title className="sr-only">
                        Actions
                    </DialogPrimitive.Title>
                )}
                <DialogPrimitive.Description className="sr-only">
                    Choose an action
                </DialogPrimitive.Description>

                {children}
            </DialogPrimitive.Content>
        </BottomSheetPortal>
    );
}

function BottomSheetAction({
    className,
    variant = "default",
    children,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "destructive";
}) {
    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors hover:bg-accent active:bg-accent/80",
                variant === "destructive" &&
                    "text-destructive hover:bg-destructive/10",
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}

function BottomSheetSeparator() {
    return <div className="mx-5 my-1 h-px bg-border/50" />;
}

export { BottomSheetContent, BottomSheetAction, BottomSheetSeparator };
