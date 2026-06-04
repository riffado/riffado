"use client";

import { Bot, CheckCircle2, Mic, Sparkles } from "lucide-react";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OnboardingStepWelcome() {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mic className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    Your AI-Powered Recording Hub
                </h3>
                <p className="text-muted-foreground">
                    Mesynx AI helps you manage, transcribe, and enhance your
                    Plaud recordings with AI. Let's set up your account.
                </p>
            </div>

            <div className="grid gap-4">
                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Mic className="size-4" />
                            Connect Your Account
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Sign in with your Plaud email to sync recordings
                            automatically
                        </p>
                    </CardContent>
                </Card>

                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Bot className="size-4" />
                            Set Up AI Provider
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Configure an AI provider for automatic
                            transcriptions
                        </p>
                    </CardContent>
                </Card>

                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Sparkles className="size-4" />
                            Start Recording
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            You're all set! Start recording and let AI do the
                            work
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export function OnboardingStepPlaud({
    hasPlaudConnection,
    onReconnect,
    onConnected,
}: {
    hasPlaudConnection: boolean;
    onReconnect: () => void;
    onConnected: () => void;
}) {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mic className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    Connect Your Plaud Account
                </h3>
                <p className="text-muted-foreground">
                    Sign in with your Plaud email to sync recordings
                    automatically
                </p>
            </div>

            {hasPlaudConnection ? (
                <Card className="border-primary/50 bg-primary/5 py-3">
                    <CardContent className="px-4">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="size-5 text-primary" />
                            <div className="flex-1">
                                <p className="font-medium">Device Connected</p>
                                <p className="text-sm text-muted-foreground">
                                    Your Plaud account is connected
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onReconnect}
                            >
                                Reconnect
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="gap-0 py-4">
                    <CardContent className="pt-6">
                        <PlaudConnectTabs
                            variant="dialog"
                            onConnected={onConnected}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export function OnboardingStepAiProvider({
    hasAiProvider,
    onGoToSettings,
}: {
    hasAiProvider: boolean;
    onGoToSettings: () => void;
}) {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Bot className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Set Up AI Provider</h3>
                <p className="text-muted-foreground">
                    Configure an AI provider to enable automatic transcriptions
                </p>
            </div>

            {hasAiProvider ? (
                <Card className="border-primary/50 bg-primary/5 py-3">
                    <CardContent>
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="size-5 text-primary" />
                            <div className="flex-1">
                                <p className="font-medium">
                                    AI Provider Configured
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    You already have an AI provider set up
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="gap-0 py-4">
                    <CardContent className="pt-6 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            You can set up an AI provider later in Settings.
                            This enables automatic transcription of your
                            recordings.
                        </p>
                        <Button
                            onClick={onGoToSettings}
                            variant="outline"
                            className="w-full"
                        >
                            Go to Settings
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export function OnboardingStepComplete() {
    return (
        <div className="space-y-6">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">You're All Set!</h3>
                <p className="text-muted-foreground">
                    Start recording and let Mesynx AI handle the rest
                </p>
            </div>

            <Card className="gap-0 py-4">
                <CardContent>
                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    Recordings sync automatically
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Your Plaud device will sync recordings in
                                    the background
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    AI-powered transcriptions
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Set up an AI provider to transcribe
                                    recordings automatically
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    Customize your experience
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Adjust settings anytime from the Settings
                                    menu
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
