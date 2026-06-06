"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";

type Step = "connect" | "complete";

const GITHUB_REPO = "https://github.com/r0073d-l053r/mesynx";

export function OnboardingForm() {
    const [step, setStep] = useState<Step>("connect");
    const { push } = useRouter();

    return (
        <Panel className="w-full max-w-2xl space-y-6">
            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-8">
                <div className="flex items-center gap-2">
                    <LEDIndicator active={step === "connect"} status="active" />
                    <span className="text-sm">Connect</span>
                </div>
                <div className="flex items-center gap-2">
                    <LEDIndicator
                        active={step === "complete"}
                        status="active"
                    />
                    <span className="text-sm">Complete</span>
                </div>
            </div>

            {step === "connect" && (
                <div className="space-y-4">
                    <div>
                        <h2 className="text-xl font-semibold">
                            Connect Your Plaud Account
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Sign in with the email you use on{" "}
                            <a
                                href="https://plaud.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2"
                            >
                                plaud.ai
                            </a>
                            , or paste an existing token if you signed up via
                            Google or Apple.
                        </p>
                    </div>

                    <PlaudConnectTabs
                        variant="page"
                        onConnected={() => setStep("complete")}
                    />
                </div>
            )}

            {step === "complete" && (
                <div className="space-y-4 text-center">
                    <LEDIndicator
                        active
                        status="active"
                        size="lg"
                        pulse
                        className="mx-auto"
                    />
                    <div>
                        <h2 className="text-2xl font-semibold">
                            Setup Complete!
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Your recordings will start syncing automatically
                        </p>
                    </div>
                    <MetalButton
                        onClick={() => push("/dashboard")}
                        variant="cyan"
                        className="w-full"
                    >
                        Go to Dashboard
                    </MetalButton>
                </div>
            )}

            {/* ── How this works (collapsed by default) ── */}
            {step !== "complete" && (
                <details className="group">
                    <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors select-none">
                        How does this work?
                    </summary>
                    <Panel
                        variant="inset"
                        className="mt-2 space-y-2 text-xs text-muted-foreground leading-relaxed"
                    >
                        <p>
                            Mesynx AI talks to Plaud's own servers (
                            <span className="font-mono">api.plaud.ai</span>) the
                            same way the official Plaud app does. Your email or
                            token is forwarded directly and never stored.
                        </p>
                        <p>
                            After login, your access token is encrypted with
                            AES-256-GCM and stored only on this self-hosted
                            instance. No data leaves your server.
                        </p>
                        <p>
                            This is open source software. Every line is
                            available for inspection:{" "}
                            <a
                                href={GITHUB_REPO}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-muted-foreground/90 transition-colors"
                            >
                                GitHub&nbsp;→
                            </a>
                        </p>
                    </Panel>
                </details>
            )}
        </Panel>
    );
}
