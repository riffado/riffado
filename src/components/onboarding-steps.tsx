"use client";

import { Bot, CheckCircle2, Mic, Sparkles } from "lucide-react";
import { PlaudConnectTabs } from "@/components/plaud-connect-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uiText } from "@/lib/i18n";

export function OnboardingStepWelcome() {
    return (
        <div className="space-y-4">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Mic className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    {uiText("Your AI-Powered Recording Hub")}
                </h3>
                <p className="text-muted-foreground">
                    {uiText(
                        "Riffado helps you manage, transcribe, and enhance your Plaud recordings with AI. Let's set up your account.",
                    )}
                </p>
            </div>

            <div className="grid gap-4">
                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Mic className="size-4" />
                            {uiText("Connect Your Account")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "Sign in with your Plaud email to sync recordings automatically",
                            )}
                        </p>
                    </CardContent>
                </Card>

                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Bot className="size-4" />
                            {uiText("Set Up AI Provider")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "Configure an AI provider for automatic transcriptions",
                            )}
                        </p>
                    </CardContent>
                </Card>

                <Card className="gap-0 py-4">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Sparkles className="size-4" />
                            {uiText("Start Recording")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "You're all set! Start recording and let AI do the work",
                            )}
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
        <div className="space-y-4">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Mic className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    {uiText("Connect Your Plaud Account")}
                </h3>
                <p className="text-muted-foreground">
                    {uiText(
                        "Sign in with your Plaud email to sync recordings automatically",
                    )}
                </p>
            </div>

            {hasPlaudConnection ? (
                <Card className="border-primary/50 bg-primary/5 py-3">
                    <CardContent className="px-4">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="size-5 text-primary" />
                            <div className="flex-1">
                                <p className="font-medium">
                                    {uiText("Device Connected")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uiText("Your Plaud account is connected")}
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onReconnect}
                            >
                                {uiText("Reconnect")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="gap-0 py-4">
                    <CardContent className="pt-6">
                        <PlaudConnectTabs onConnected={onConnected} />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export function OnboardingStepAiProvider({
    hasOwnProvider,
    hasIncludedProvider,
    onGoToSettings,
}: {
    hasOwnProvider: boolean;
    hasIncludedProvider: boolean;
    onGoToSettings: () => void;
}) {
    const includedOnly = hasIncludedProvider && !hasOwnProvider;
    return (
        <div className="space-y-4">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Bot className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    {includedOnly
                        ? uiText("Transcription Included")
                        : uiText("Set Up AI Provider")}
                </h3>
                <p className="text-muted-foreground">
                    {includedOnly
                        ? uiText(
                              "Mynah transcription comes with your plan. You're ready to go.",
                          )
                        : uiText(
                              "Configure an AI provider to enable automatic transcriptions",
                          )}
                </p>
            </div>

            {hasOwnProvider ? (
                <Card className="border-primary/50 bg-primary/5 py-3">
                    <CardContent>
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="size-5 text-primary" />
                            <div className="flex-1">
                                <p className="font-medium">
                                    {uiText("AI Provider Configured")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uiText(
                                        "You already have your own AI provider set up",
                                    )}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : includedOnly ? (
                <Card className="border-primary/50 bg-primary/5 gap-0 py-4">
                    <CardContent className="pt-6 space-y-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div className="flex-1">
                                <p className="font-medium">
                                    {uiText("Mynah transcription is included")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uiText(
                                        "Transcription works out of the box with your plan. Adding your own AI provider is optional. Use it for summaries or a different transcription engine alongside Mynah.",
                                    )}
                                </p>
                            </div>
                        </div>
                        <Button
                            onClick={onGoToSettings}
                            variant="outline"
                            className="w-full"
                        >
                            {uiText("Add your own provider (optional)")}
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <Card className="gap-0 py-4">
                    <CardContent className="pt-6 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {uiText(
                                "You can set up an AI provider later in Settings. This enables automatic transcription of your recordings.",
                            )}
                        </p>
                        <Button
                            onClick={onGoToSettings}
                            variant="outline"
                            className="w-full"
                        >
                            {uiText("Go to Settings")}
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export function OnboardingStepComplete({
    hasIncludedProvider,
}: {
    hasIncludedProvider: boolean;
}) {
    return (
        <div className="space-y-4">
            <div className="text-center space-y-2">
                <div className="size-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="size-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">
                    {uiText("You're All Set!")}
                </h3>
                <p className="text-muted-foreground">
                    {uiText("Start recording and let Riffado handle the rest")}
                </p>
            </div>

            <Card className="gap-0 py-4">
                <CardContent>
                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    {uiText("Recordings sync automatically")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uiText(
                                        "Your Plaud device will sync recordings in the background",
                                    )}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    {uiText("AI-powered transcriptions")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {hasIncludedProvider
                                        ? uiText(
                                              "Mynah transcription is ready with your plan",
                                          )
                                        : uiText(
                                              "Set up an AI provider to transcribe recordings automatically",
                                          )}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <CheckCircle2 className="size-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    {uiText("Customize your experience")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uiText(
                                        "Adjust settings anytime from the Settings menu",
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
