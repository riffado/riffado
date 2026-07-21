"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/onboarding-dialog-base";
import {
    OnboardingStepAiProvider,
    OnboardingStepComplete,
    OnboardingStepPlaud,
    OnboardingStepWelcome,
} from "@/components/onboarding-steps";
import { Button } from "@/components/ui/button";

type OnboardingStep = "welcome" | "plaud" | "ai-provider" | "complete";

const STEP_ORDER: OnboardingStep[] = [
    "welcome",
    "plaud",
    "ai-provider",
    "complete",
];

interface OnboardingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete: () => void;
    /**
     * True when the user has not finished onboarding yet -- makes the
     * dialog non-dismissible (no close button, Escape and outside-click
     * are suppressed) so the flow can't be abandoned partway. False for
     * the voluntary "Re-run Onboarding" re-entry from Settings, which
     * stays dismissible like before.
     */
    mandatory?: boolean;
}

export function OnboardingDialog({
    open,
    onOpenChange,
    onComplete,
    mandatory = false,
}: OnboardingDialogProps) {
    const { refresh } = useRouter();
    const [step, setStep] = useState<OnboardingStep>("welcome");
    const [hasPlaudConnection, setHasPlaudConnection] = useState(false);
    const [hasOwnProvider, setHasOwnProvider] = useState(false);
    const [hasIncludedProvider, setHasIncludedProvider] = useState(false);

    // Probe whether the user already finished the Plaud connection in
    // a previous session, so re-entering the flow doesn't make them
    // re-paste a token. Same for the AI provider step below. Each runs
    // only while its step is active to avoid an unnecessary request on
    // mount.
    useEffect(() => {
        if (open && step === "plaud") {
            fetch("/api/plaud/connection")
                .then((res) => res.json())
                .then((data) => {
                    if (data.connected) {
                        setHasPlaudConnection(true);
                    }
                })
                .catch(() => {});
        }
    }, [open, step]);

    useEffect(() => {
        if (open && step === "ai-provider") {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data: { providers?: Array<{ managed?: boolean }> }) => {
                    const providers = data.providers ?? [];
                    // The included Mynah provider (managed) shouldn't count as
                    // the user having brought their own — it's complimentary.
                    setHasOwnProvider(providers.some((p) => !p.managed));
                    setHasIncludedProvider(providers.some((p) => p.managed));
                })
                .catch(() => {});
        }
    }, [open, step]);

    // Reset on dialog close so re-opening starts at the welcome step
    // and the cached "has X" flags get re-fetched.
    useEffect(() => {
        if (!open) {
            setStep("welcome");
            setHasPlaudConnection(false);
            setHasOwnProvider(false);
            setHasIncludedProvider(false);
        }
    }, [open]);

    const stepIndex = STEP_ORDER.indexOf(step);
    const prevStep: OnboardingStep | null =
        stepIndex > 0 ? STEP_ORDER[stepIndex - 1] : null;
    const nextStep: OnboardingStep | null =
        stepIndex < STEP_ORDER.length - 1 ? STEP_ORDER[stepIndex + 1] : null;
    const canSkip = step === "plaud" || step === "ai-provider";

    const handleComplete = async () => {
        try {
            await fetch("/api/settings/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ onboardingCompleted: true }),
            });
            onComplete();
            onOpenChange(false);
            refresh();
        } catch {
            toast.error("Failed to complete onboarding");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-2xl max-h-[90vh] overflow-y-auto sm:max-w-[600px]"
                hideCloseButton={mandatory}
                onEscapeKeyDown={(e) => {
                    if (mandatory) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                    if (mandatory) e.preventDefault();
                }}
                onInteractOutside={(e) => {
                    if (mandatory) e.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle className="text-2xl" hidden>
                        Welcome to Riffado
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {step === "welcome" && <OnboardingStepWelcome />}
                    {step === "plaud" && (
                        <OnboardingStepPlaud
                            hasPlaudConnection={hasPlaudConnection}
                            onReconnect={() => setHasPlaudConnection(false)}
                            onConnected={() => setHasPlaudConnection(true)}
                        />
                    )}
                    {step === "ai-provider" && (
                        <OnboardingStepAiProvider
                            hasOwnProvider={hasOwnProvider}
                            hasIncludedProvider={hasIncludedProvider}
                            onGoToSettings={() => {
                                onOpenChange(false);
                                window.location.href =
                                    "/dashboard?settings=providers";
                            }}
                        />
                    )}
                    {step === "complete" && (
                        <OnboardingStepComplete
                            hasIncludedProvider={hasIncludedProvider}
                        />
                    )}

                    <DialogFooter className="gap-2 sm:gap-3 relative">
                        <div className="flex gap-2 flex-1">
                            {prevStep && (
                                <Button
                                    variant="outline"
                                    onClick={() => setStep(prevStep)}
                                >
                                    <ArrowLeft className="size-4 mr-2" />
                                    Previous
                                </Button>
                            )}
                        </div>

                        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 mt-0.5">
                            {STEP_ORDER.map((stepName, index) => {
                                const completed = index < stepIndex;
                                const current = index === stepIndex;
                                return (
                                    <div
                                        key={stepName}
                                        className={`size-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                                            completed || current
                                                ? "bg-primary text-primary-foreground"
                                                : "border-2 border-muted-foreground/30 text-muted-foreground"
                                        }`}
                                    >
                                        {index + 1}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex gap-2 flex-1 justify-end">
                            {canSkip && nextStep && (
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep(nextStep)}
                                >
                                    Skip
                                </Button>
                            )}
                            {step === "complete" ? (
                                <Button onClick={handleComplete}>
                                    Get Started
                                    <ArrowRight className="size-4 ml-2" />
                                </Button>
                            ) : (
                                nextStep && (
                                    <Button onClick={() => setStep(nextStep)}>
                                        Next
                                        <ArrowRight className="size-4 ml-2" />
                                    </Button>
                                )
                            )}
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
