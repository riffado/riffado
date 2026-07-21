"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const OnboardingDialogRoot = DialogPrimitive.Root;

const OnboardingDialogPortal = DialogPrimitive.Portal;

function OnboardingDialogOverlay({
    className,
    ref,
    ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Overlay>>;
}) {
    return (
        <DialogPrimitive.Overlay
            ref={ref}
            className={cn(
                "fixed inset-0 z-[101] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:duration-200 data-[state=open]:duration-200",
                className,
            )}
            {...props}
        />
    );
}

function OnboardingDialogContent({
    className,
    children,
    ref,
    hideCloseButton = false,
    ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Content>>;
    /**
     * Hides the top-right close (X) button. Used for the mandatory,
     * first-run onboarding flow -- combined with blocking Escape/
     * outside-click in the caller, this makes the dialog non-dismissible
     * until the user completes it. Defaults to `false` so every other
     * (dismissible) usage is unaffected.
     */
    hideCloseButton?: boolean;
}) {
    return (
        <OnboardingDialogPortal>
            <OnboardingDialogOverlay />
            <DialogPrimitive.Content
                ref={ref}
                className={cn(
                    "fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100%-4rem)] w-full -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border bg-background p-6 shadow-lg shadow-black/5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:duration-200 data-[state=open]:duration-200 sm:max-w-[600px] sm:rounded-xl",
                    className,
                )}
                {...props}
            >
                {children}
                {!hideCloseButton && (
                    <DialogPrimitive.Close className="group absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none">
                        <X className="size-4 opacity-60 transition-opacity group-hover:opacity-100" />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Content>
        </OnboardingDialogPortal>
    );
}

function OnboardingDialogHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex flex-col space-y-1.5 text-center sm:text-left",
                className,
            )}
            {...props}
        />
    );
}

function OnboardingDialogFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3",
                className,
            )}
            {...props}
        />
    );
}

function OnboardingDialogTitle({
    className,
    ref,
    ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & {
    ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Title>>;
}) {
    return (
        <DialogPrimitive.Title
            ref={ref}
            className={cn("text-lg font-semibold tracking-tight", className)}
            {...props}
        />
    );
}

function OnboardingDialogDescription({
    className,
    ref,
    ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & {
    ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Description>>;
}) {
    return (
        <DialogPrimitive.Description
            ref={ref}
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export {
    OnboardingDialogRoot as Dialog,
    OnboardingDialogContent as DialogContent,
    OnboardingDialogDescription as DialogDescription,
    OnboardingDialogFooter as DialogFooter,
    OnboardingDialogHeader as DialogHeader,
    OnboardingDialogTitle as DialogTitle,
};
