"use client";

import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settings/section-header";
import {
    SettingsRow,
    SettingsRows,
    SettingsRowsSkeleton,
    ToggleRow,
} from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/use-settings";
import { requestNotificationPermission } from "@/lib/notifications/browser";
import { setToastSound } from "@/lib/toast";

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
    const [marketingEmailConsent, setMarketingEmailConsent] = useState(false);
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
                    setToastSound(data.notificationSound ?? true);
                    setMarketingEmailConsent(
                        data.marketingEmailConsent ?? false,
                    );
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

    return (
        <SettingsGroup
            title="Notifications"
            description="How Riffado tells you about new recordings and syncs"
        >
            {isLoadingSettings ? (
                <SettingsRowsSkeleton rows={5} />
            ) : (
                <SettingsRows>
                    <ToggleRow
                        id="browser-notifications"
                        label="Browser notifications"
                        description="For new recordings and sync events"
                        checked={browserNotifications}
                        onCheckedChange={handleBrowserNotificationsChange}
                        disabled={isSavingSettings}
                    />
                    <ToggleRow
                        id="email-notifications"
                        label="Email notifications"
                        description="An email for new recordings"
                        checked={emailNotifications}
                        onCheckedChange={handleEmailNotificationsChange}
                        disabled={isSavingSettings}
                    />
                    {emailNotifications && (
                        <SettingsRow
                            label="Email address"
                            description={
                                userEmail && notificationEmail === userEmail
                                    ? "Your account email. You can use another address"
                                    : "Where notifications go"
                            }
                            controlId="notification-email"
                            control={
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
                                    className="squircle h-9.5 w-64 rounded-[var(--radius-control)] border-border max-sm:w-full"
                                />
                            }
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                <Button
                                    type="button"
                                    variant="quiet"
                                    size="compact"
                                    onClick={handleSendTestEmail}
                                    disabled={
                                        isSendingTestEmail ||
                                        !(notificationEmail || userEmail)
                                    }
                                >
                                    <Mail />
                                    {isSendingTestEmail
                                        ? "Sending…"
                                        : "Send test email"}
                                </Button>
                                {testEmailStatus.type && (
                                    <p
                                        className={`text-small leading-4 ${
                                            testEmailStatus.type === "success"
                                                ? "text-subtle"
                                                : "text-destructive"
                                        }`}
                                    >
                                        {testEmailStatus.message}
                                    </p>
                                )}
                            </div>
                        </SettingsRow>
                    )}
                    <ToggleRow
                        id="bark-notifications"
                        label="Bark push notifications"
                        description="A push through the Bark app for new recordings"
                        checked={barkNotifications}
                        onCheckedChange={handleBarkNotificationsChange}
                        disabled={isSavingSettings}
                    />
                    {barkNotifications && (
                        <SettingsRow
                            label="Bark push URL"
                            description="Copy the full push URL from the Bark app"
                            controlId="bark-push-url"
                            control={
                                <Input
                                    id="bark-push-url"
                                    type="url"
                                    value={barkPushUrl}
                                    onChange={(e) =>
                                        handleBarkPushUrlChange(e.target.value)
                                    }
                                    placeholder="https://api.day.app/your_key"
                                    className="squircle h-9.5 w-64 rounded-[var(--radius-control)] border-border max-sm:w-full"
                                />
                            }
                        />
                    )}
                    <ToggleRow
                        id="notification-sound"
                        label="Notification sound"
                        description="A short sound for errors and new recordings"
                        checked={notificationSound}
                        onCheckedChange={(checked) => {
                            setNotificationSound(checked);
                            setToastSound(checked);
                            handleChange({ notificationSound: checked });
                        }}
                        disabled={isSavingSettings}
                    />
                    <ToggleRow
                        id="marketing-email-consent"
                        label="Product updates"
                        description="Occasional emails about new features and releases"
                        checked={marketingEmailConsent}
                        onCheckedChange={(checked) => {
                            setMarketingEmailConsent(checked);
                            handleChange({ marketingEmailConsent: checked });
                        }}
                        disabled={isSavingSettings}
                    />
                </SettingsRows>
            )}
        </SettingsGroup>
    );
}
