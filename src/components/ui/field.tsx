"use client";

import {
    type ComponentProps,
    createContext,
    type ReactNode,
    use,
    useId,
} from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

interface FieldContextValue {
    inputId: string;
    messageId: string;
    hasMessage: boolean;
    invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldProps {
    label: ReactNode;
    /** Sits at the end of the label row, e.g. a "Forgot password?" link. */
    labelAside?: ReactNode;
    /** Quiet help under the input. Replaced in place by `error`. */
    hint?: ReactNode;
    /** Why the value was rejected. Marks the input invalid. */
    error?: ReactNode;
    /** Id for the input; generated when omitted. */
    id?: string;
    className?: string;
    /** A `FieldInput` (or another control that reads the field context). */
    children: ReactNode;
}

/**
 * A labelled form field from the design system (05 Forms & feedback):
 * label, 44px input, then a hint that the error replaces in place. The
 * hint or error is tied to the input with `aria-describedby`, and an
 * error sets `aria-invalid`.
 */
export function Field({
    label,
    labelAside,
    hint,
    error,
    id,
    className,
    children,
}: FieldProps) {
    const generatedId = useId();
    const inputId = id ?? `field-${generatedId}`;
    const messageId = `${inputId}-message`;
    const invalid = Boolean(error);
    const message = error ?? hint;

    return (
        <FieldContext
            value={{
                inputId,
                messageId,
                hasMessage: Boolean(message),
                invalid,
            }}
        >
            <div
                className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
                    className,
                )}
            >
                <label
                    htmlFor={inputId}
                    className="col-start-1 row-start-1 text-sm leading-5 font-medium text-strong select-none"
                >
                    {label}
                </label>
                <div className="col-span-2 row-start-2">{children}</div>
                {labelAside ? (
                    // After the input in the DOM so Tab goes from the input
                    // to the next field first; shown at the end of the label row.
                    <div className="col-start-2 row-start-1 flex justify-self-end">
                        {labelAside}
                    </div>
                ) : null}
                {error ? (
                    <FieldError id={messageId} className="col-span-2">
                        {error}
                    </FieldError>
                ) : hint ? (
                    <p
                        id={messageId}
                        className="col-span-2 text-small text-muted-foreground"
                    >
                        {hint}
                    </p>
                ) : null}
            </div>
        </FieldContext>
    );
}

/**
 * The system text input. Inside a `Field` it takes the field's id,
 * description and invalid state; outside one it is a plain input.
 */
export function FieldInput({ className, ...props }: ComponentProps<"input">) {
    const field = use(FieldContext);
    return (
        <input
            id={field?.inputId}
            aria-describedby={field?.hasMessage ? field.messageId : undefined}
            aria-invalid={field?.invalid || undefined}
            data-slot="field-input"
            className={cn(
                "squircle h-11 w-full min-w-0 rounded-[var(--radius-inner)] border border-input bg-field px-3.5 text-base leading-5 text-strong outline-none sm:text-row sm:leading-5",
                "transition-[border-color,box-shadow] duration-(--duration-press) ease-[ease]",
                "placeholder:text-muted-foreground",
                "focus:border-strong focus:ring-[3px] focus:ring-strong/10",
                "aria-invalid:border-terracotta aria-invalid:ring-[3px] aria-invalid:ring-terracotta/16 aria-invalid:focus:border-terracotta aria-invalid:focus:ring-terracotta/16",
                "disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            {...props}
        />
    );
}

/**
 * An error line: terracotta status dot and the reason. Used under a field
 * (via `Field`) and, with `role="alert"`, for errors that belong to the
 * whole form, placed above its submit button.
 */
export function FieldError({
    className,
    children,
    ...props
}: ComponentProps<"p">) {
    return (
        <p
            className={cn(
                "flex items-start gap-2 text-small text-foreground",
                className,
            )}
            {...props}
        >
            <StatusDot tone="attention" className="mt-1.5" />
            <span className="min-w-0">{children}</span>
        </p>
    );
}
