"use client";

import { Bell, BellRing, Mail, Smartphone, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSectionHeader } from "@/components/settings/section-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { ToggleRow } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/use-settings";
import { requestNotificationPermission } from "@/lib/notifications/browser";

export function NotificationsSection() {
    const {
        isLoadingSettings,
        isSavingSettings,
        setIsLoadingSettings,
        debouncedSave,
    } = useSettings();

    const [browserNotifications, setBrowserNotifications] = useState(true);
    const [emailNotifications, setEmailNotifications] = useState(false);
    const [barkNotifications, setBarkNotifications] = useState(false);
    const [notificationSound, setNotificationSound] = useState(true);
    const [notificationEmail, setNotificationEmail] = useState<string>("");
    const [barkPushUrl, setBarkPushUrl] = useState<string>("");
    const [, setBarkPushUrlSet] = useState(false);
    const [userEmail, setUserEmail] = useState<string>("");
    const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
    const [testEmailStatus, setTestEmailStatus] = useState<{
        type: "success" | "error" | null;
        message: string;
    }>({ type: null, message: "" });

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch("/api/settings/user");
                if (response.ok) {
                    const data = await response.json();
                    setBrowserNotifications(data.browserNotifications ?? true);
                    setEmailNotifications(data.emailNotifications ?? false);
                    setBarkNotifications(data.barkNotifications ?? false);
                    setNotificationSound(data.notificationSound ?? true);
                    setUserEmail(data.userEmail ?? "");
                    setNotificationEmail(
                        data.notificationEmail || data.userEmail || "",
                    );
                    setBarkPushUrl(data.barkPushUrl || "");
                    setBarkPushUrlSet(data.barkPushUrlSet ?? false);
                }
            } catch (err) {
                console.error("Failed to fetch settings:", err);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        fetchSettings();
    }, [setIsLoadingSettings]);

    const handleChange = (updates: Record<string, unknown>) => {
        debouncedSave(updates);
    };

    const handleBrowserNotificationsChange = (checked: boolean) => {
        setBrowserNotifications(checked);
        handleChange({ browserNotifications: checked });

        if (checked) {
            // Best-effort permission request; ignore result here
            void requestNotificationPermission();
        }
    };

    const handleEmailNotificationsChange = (checked: boolean) => {
        setEmailNotifications(checked);
        if (checked && !notificationEmail && userEmail) {
            setNotificationEmail(userEmail);
            handleChange({
                emailNotifications: checked,
                notificationEmail: userEmail,
            });
        } else {
            handleChange({ emailNotifications: checked });
        }
    };

    const handleNotificationEmailChange = (email: string) => {
        setNotificationEmail(email);
        debouncedSave({ notificationEmail: email || undefined });
    };

    const handleBarkNotificationsChange = (checked: boolean) => {
        setBarkNotifications(checked);
        handleChange({ barkNotifications: checked });
    };

    const handleBarkPushUrlChange = (url: string) => {
        setBarkPushUrl(url);
        if (url) {
            setBarkPushUrlSet(true);
        } else {
            // If user clears the input, mark as unset
            setBarkPushUrlSet(false);
        }
        debouncedSave({ barkPushUrl: url || null });
    };

    const handleSendTestEmail = async () => {
        const emailToTest = notificationEmail || userEmail;
        if (!emailToTest) {
            setTestEmailStatus({
                type: "error",
                message: "Please enter an email address first",
            });
            return;
        }

        setIsSendingTestEmail(true);
        setTestEmailStatus({ type: null, message: "" });

        try {
            const response = await fetch("/api/settings/test-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email: emailToTest }),
            });

            const data = await response.json();

            if (response.ok) {
                setTestEmailStatus({
                    type: "success",
                    message: `Test email sent successfully to ${emailToTest}`,
                });
            } else {
                setTestEmailStatus({
                    type: "error",
                    message: data.error || "Failed to send test email",
                });
            }
        } catch (err) {
            console.error("Error sending test email:", err);
            setTestEmailStatus({
                type: "error",
                message: "Failed to send test email. Please try again.",
            });
        } finally {
            setIsSendingTestEmail(false);
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SettingsSectionHeader
                title="Notifications"
                description="Choose how and when Riffado lets you know about new recordings and sync events."
                icon={Bell}
            />

            <div className="space-y-3">
                {/* Browser */}
                <SettingsCard>
                    <ToggleRow
                        id="browser-notifications"
                        label={
                            <span className="inline-flex items-center gap-2">
                                <BellRing
                                    className="size-4 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                Browser notifications
                            </span>
                        }
                        description="Show browser notifications for new recordings and sync events."
                        checked={browserNotifications}
                        onCheckedChange={handleBrowserNotificationsChange}
                        disabled={isSavingSettings}
                    />
                </SettingsCard>

                {/* Email */}
                <SettingsCard>
                    <ToggleRow
                        id="email-notifications"
                        label={
                            <span className="inline-flex items-center gap-2">
                                <Mail
                                    className="size-4 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                Email notifications
                            </span>
                        }
                        description="Send email notifications for new recordings."
                        checked={emailNotifications}
                        onCheckedChange={handleEmailNotificationsChange}
                        disabled={isSavingSettings}
                    />

                    {emailNotifications && (
                        <div className="mt-3 space-y-2 border-t pt-3">
                            <Label htmlFor="notification-email">
                                Email address
                            </Label>
                            <Input
                                id="notification-email"
                                type="email"
                                value={notificationEmail}
                                onChange={(e) =>
                                    handleNotificationEmailChange(
                                        e.target.value,
                                    )
                                }
                                placeholder={userEmail || "your@email.com"}
                            />
                            <p className="text-xs text-muted-foreground">
                                {userEmail && notificationEmail === userEmail
                                    ? "Using your account email. You can change this to a different address if needed."
                                    : "Email address to receive notifications."}
                            </p>
                            <div className="flex items-center gap-2 pt-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSendTestEmail}
                                    disabled={
                                        isSendingTestEmail ||
                                        !(notificationEmail || userEmail)
                                    }
                                >
                                    <Mail className="size-4" />
                                    {isSendingTestEmail
                                        ? "Sending…"
                                        : "Send test email"}
                                </Button>
                                {testEmailStatus.type && (
                                    <p
                                        className={`text-xs ${
                                            testEmailStatus.type === "success"
                                                ? "text-green-600 dark:text-green-400"
                                                : "text-red-600 dark:text-red-400"
                                        }`}
                                    >
                                        {testEmailStatus.message}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </SettingsCard>

                {/* Bark */}
                <SettingsCard>
                    <ToggleRow
                        id="bark-notifications"
                        label={
                            <span className="inline-flex items-center gap-2">
                                <Smartphone
                                    className="size-4 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                Bark push notifications
                            </span>
                        }
                        description="Send push notifications via Bark for new recordings."
                        checked={barkNotifications}
                        onCheckedChange={handleBarkNotificationsChange}
                        disabled={isSavingSettings}
                    />

                    {barkNotifications && (
                        <div className="mt-3 space-y-2 border-t pt-3">
                            <Label htmlFor="bark-push-url">Bark push URL</Label>
                            <Input
                                id="bark-push-url"
                                type="url"
                                value={barkPushUrl}
                                onChange={(e) =>
                                    handleBarkPushUrlChange(e.target.value)
                                }
                                placeholder="https://api.day.app/your_key"
                            />
                            <p className="text-xs text-muted-foreground">
                                Copy the full push URL from the Bark app (e.g.,
                                https://api.day.app/your_key).
                            </p>
                        </div>
                    )}
                </SettingsCard>

                {/* Sound */}
                <SettingsCard>
                    <ToggleRow
                        id="notification-sound"
                        label={
                            <span className="inline-flex items-center gap-2">
                                <Volume2
                                    className="size-4 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                Notification sound
                            </span>
                        }
                        description="Play a sound when notifications are received."
                        checked={notificationSound}
                        onCheckedChange={(checked) => {
                            setNotificationSound(checked);
                            handleChange({ notificationSound: checked });
                        }}
                        disabled={isSavingSettings}
                    />
                </SettingsCard>
            </div>
        </div>
    );
}
