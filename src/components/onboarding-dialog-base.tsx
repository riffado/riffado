"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { touchTargetClass } from "@/components/ui/button";
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
                "motion-overlay fixed inset-0 z-[101] bg-black/50",
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
                    "motion-dialog squircle fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[var(--radius-card)] bg-dialog-surface p-6 text-strong shadow-dialog outline-none sm:max-w-[600px]",
                    className,
                )}
                {...props}
            >
                {children}
                {!hideCloseButton && (
                    <DialogPrimitive.Close
                        className={cn(
                            "motion-press squircle absolute top-4 right-4 flex size-7 items-center justify-center rounded-[var(--radius-small)] text-subtle outline-none hover:bg-accent hover:text-strong focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none",
                            touchTargetClass,
                        )}
                    >
                        <X className="size-4" />
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
            className={cn("flex flex-col gap-2 text-left", className)}
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
            className={cn(
                "font-display text-section-title font-semibold text-strong",
                className,
            )}
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
            className={cn("text-dialog-body text-subtle", className)}
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
