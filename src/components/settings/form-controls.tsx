"use client";

import { Check, ChevronLeft, Copy, Info, Lock } from "lucide-react";
import { Checkbox as CheckboxPrimitive, RadioGroup } from "radix-ui";
import type * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Size overrides for `FieldInput` (`ui/field`) where the 44px sign-in
 * field is too tall: 40px in dialogs, 38px inline in a settings row.
 * Phones keep 16px text so iOS doesn't zoom into the field.
 */
export const dialogInputClass = "h-10 px-3 sm:text-ui";
export const rowInputClass = "h-9.5 px-3.5 sm:text-ui";
/** Monospace value (keys, addresses) inside a `FieldInput`. */
export const monoInputClass = "font-mono sm:text-small";

/** A label with a quiet "Optional" after it, for `Field`. */
export function OptionalLabel({ children }: { children: React.ReactNode }) {
    return (
        <>
            {children}{" "}
            <span className="ml-1 font-normal text-muted-foreground">
                Optional
            </span>
        </>
    );
}

/**
 * Single choice from a short row of chips ("30 days", "90 days"). The
 * selected chip is ink. Radio semantics and arrow keys come from Radix.
 */
export function ChoiceChips<T extends string>({
    value,
    onValueChange,
    options,
    label,
    className,
    ...aria
}: {
    value: T;
    onValueChange: (value: T) => void;
    options: readonly { value: T; label: string }[];
    /** Accessible name of the group. */
    label: string;
    className?: string;
    "aria-describedby"?: string;
}) {
    return (
        <RadioGroup.Root
            value={value}
            onValueChange={(next) => onValueChange(next as T)}
            aria-label={label}
            orientation="horizontal"
            className={cn("flex flex-wrap gap-1.5", className)}
            {...aria}
        >
            {options.map((option) => (
                <RadioGroup.Item
                    key={option.value}
                    value={option.value}
                    className="motion-press squircle relative h-8 rounded-[var(--radius-small)] border border-border px-3 text-small leading-4.5 font-medium text-strong outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-strong data-[state=checked]:bg-strong data-[state=checked]:text-background dark:data-[state=checked]:text-ink data-[state=unchecked]:hover:bg-accent"
                >
                    {option.label}
                </RadioGroup.Item>
            ))}
        </RadioGroup.Root>
    );
}

/** 18px ink checkbox. Behaviour and focus come from Radix Checkbox. */
export function Checkbox({
    className,
    ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
    return (
        <CheckboxPrimitive.Root
            className={cn(
                "flex size-4.5 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-input bg-reader outline-none transition-colors duration-150 ease-[ease] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-strong data-[state=checked]:bg-strong data-[state=checked]:text-background dark:data-[state=checked]:text-ink",
                className,
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator>
                <Check className="size-3" strokeWidth={3} />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}

/**
 * Quiet note in a dialog ("What gets sent to Groq", "Read only"): icon,
 * one medium line, then plain text. Surface fill, no border.
 */
export function InfoNote({
    title,
    icon: Icon = Info,
    children,
    className,
}: {
    title: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "squircle flex gap-2.5 rounded-[var(--radius-control)] bg-quiet px-3.5 py-3",
                className,
            )}
        >
            <Icon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-subtle"
            />
            <div className="flex min-w-0 flex-col gap-0.5 text-small leading-4.5">
                <p className="font-medium text-strong">{title}</p>
                <div className="text-subtle">{children}</div>
            </div>
        </div>
    );
}

/**
 * A secret shown once (API key, webhook signing secret): the value in
 * mono, a lock line saying it won't come back, and an ink Copy button.
 */
export function SecretOnce({
    value,
    copiedMessage,
}: {
    value: string;
    /** Toast after copying, e.g. "Key copied". */
    copiedMessage: string;
}) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(copiedMessage);
        } catch {
            toast.error("Couldn't copy. Select the text and copy it instead");
        }
    };
    return (
        <div className="squircle flex flex-col gap-2.5 rounded-[var(--radius-control)] border border-hairline bg-surface p-3.5 dark:border-night-border dark:bg-night">
            <p
                data-testid="secret-value"
                className="font-mono text-ui leading-5.5 tracking-[0.01em] break-all text-strong select-all"
            >
                {value}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="flex items-center gap-2 text-small leading-4.5 text-subtle">
                    <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                    You won't see it again after you close this
                </p>
                <Button
                    type="button"
                    variant="ink"
                    size="dialog"
                    className="h-9 rounded-[var(--radius-small)] px-3.5"
                    onClick={copy}
                >
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
        </div>
    );
}

/** Read-only mono value in a field frame ("Authorization: Bearer op_…"). */
export function ReadOnlyCode({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <p
            className={cn(
                "squircle truncate rounded-[var(--radius-inner)] border border-border px-3 py-2.5 font-mono text-xs leading-4.5 text-foreground",
                className,
            )}
        >
            {children}
        </p>
    );
}

/**
 * Header of a settings dialog: optional back button, Funnel Display
 * title and one line under it. The close button comes from
 * `DialogContent`; the right padding keeps the title clear of it.
 */
export function DialogHeading({
    title,
    description,
    onBack,
    backLabel = "Back",
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    onBack?: () => void;
    backLabel?: string;
}) {
    return (
        <div className="flex items-start gap-1.5 pr-8">
            {onBack && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    className="-ml-1.5 mt-0.5 text-subtle hover:text-strong"
                    onClick={onBack}
                    aria-label={backLabel}
                >
                    <ChevronLeft />
                </Button>
            )}
            <DialogHeader className="min-w-0 gap-1.5">
                <DialogTitle>{title}</DialogTitle>
                {description && (
                    <DialogDescription className="text-ui leading-5">
                        {description}
                    </DialogDescription>
                )}
            </DialogHeader>
        </div>
    );
}

/**
 * Classes for `DialogContent` on the settings dialogs: 560px wide (pass
 * a `max-w` to change it), 28px side padding, 20px between blocks.
 */
export const settingsDialogClass =
    "max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto px-7 pt-7 pb-6 sm:max-w-140";
