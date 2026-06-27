"use client";

import {
    createContext,
    type ReactNode,
    use,
    useCallback,
    useRef,
    useState,
} from "react";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * App-wide confirm dialog. Single instance, called imperatively via
 * `useConfirm()` so callers don't manage their own open/pending state.
 *
 * Usage:
 *
 *   const confirm = useConfirm();
 *   await confirm({
 *       title: "Delete this recording?",
 *       description: <>The audio file will be removed.</>,
 *       confirmLabel: "Delete",
 *       pendingLabel: "Deleting\u2026",
 *       destructive: true,
 *       onConfirm: async () => {
 *           await fetch(`/api/recordings/${id}`, { method: "DELETE" });
 *       },
 *   });
 *
 * Behavior:
 *  - Cancel / backdrop / Escape \u2192 dialog closes, `onConfirm` never\n *    runs, the promise resolves with `false`.
 *  - Confirm click \u2192 button switches to `pendingLabel`, inputs disable,
 *    `onConfirm` is awaited. On success the dialog closes and the
 *    promise resolves with `true`. On thrown error a toast surfaces
 *    the message (or `errorMessage` override), the dialog stays open
 *    so the user can retry or cancel, and the promise resolves with
 *    `false` once they finally dismiss it.
 *  - Re-entrancy: while one confirm is showing, calling `confirm()`
 *    again throws \u2014 we intentionally don't queue, since destructive
 *    actions stacking on each other is almost always a UI bug.
 */

interface ConfirmOptions {
    title: string;
    description?: ReactNode;
    /** Default: "Confirm" */
    confirmLabel?: string;
    /** Default: "Cancel" */
    cancelLabel?: string;
    /** Default: same as `confirmLabel` */
    pendingLabel?: string;
    /** Tints the confirm button red. Default false. */
    destructive?: boolean;
    /** Awaited before the dialog closes. Throw to keep the dialog open. */
    onConfirm: () => void | Promise<void>;
    /** Override the toast message on `onConfirm` failure. */
    errorMessage?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
    const fn = use(ConfirmContext);
    if (!fn) {
        throw new Error(
            "useConfirm() must be used inside <ConfirmDialogProvider>",
        );
    }
    return fn;
}

interface ActiveConfirm extends ConfirmOptions {
    resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<ActiveConfirm | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    // Ref guard so the imperative `confirm()` can reject re-entrancy
    // without having to read state (which is one render behind).
    const activeRef = useRef<ActiveConfirm | null>(null);

    const confirm = useCallback<ConfirmFn>((opts) => {
        if (activeRef.current) {
            return Promise.reject(
                new Error(
                    "ConfirmDialog: a confirm is already open. Resolve it before calling confirm() again.",
                ),
            );
        }
        return new Promise<boolean>((resolve) => {
            const entry = { ...opts, resolve };
            activeRef.current = entry;
            setActive(entry);
        });
    }, []);

    const closeWithResult = (result: boolean) => {
        const entry = activeRef.current;
        if (!entry) return;
        activeRef.current = null;
        setActive(null);
        setIsRunning(false);
        entry.resolve(result);
    };

    const handleConfirm = async () => {
        const entry = activeRef.current;
        if (!entry || isRunning) return;
        setIsRunning(true);
        try {
            await entry.onConfirm();
            closeWithResult(true);
        } catch (err) {
            toast.error(
                entry.errorMessage ??
                    (err instanceof Error ? err.message : "Action failed"),
            );
            // Stay open so the user can retry or cancel; just leave
            // the pending state.
            setIsRunning(false);
        }
    };

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <AlertDialog
                open={active !== null}
                onOpenChange={(open) => {
                    // Block dismissal while the action is in flight \u2014
                    // closing mid-request leaves the user unsure whether
                    // it ran.
                    if (open || isRunning) return;
                    closeWithResult(false);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {active?.title ?? ""}
                        </AlertDialogTitle>
                        {active?.description !== undefined && (
                            <AlertDialogDescription asChild>
                                <div>{active.description}</div>
                            </AlertDialogDescription>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isRunning}>
                            {active?.cancelLabel ?? "Cancel"}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isRunning}
                            onClick={(e) => {
                                // Default behavior closes the dialog on
                                // click; we want to gate that on the
                                // awaited action.
                                e.preventDefault();
                                void handleConfirm();
                            }}
                            className={cn(
                                active?.destructive &&
                                    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40",
                            )}
                        >
                            {isRunning
                                ? (active?.pendingLabel ??
                                  active?.confirmLabel ??
                                  "Confirm")
                                : (active?.confirmLabel ?? "Confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmContext.Provider>
    );
}
