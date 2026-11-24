"use client";

import { ArrowRight, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useId, useState } from "react";
import { rowInputClass } from "@/components/settings/form-controls";
import { SettingsGroup } from "@/components/settings/section-header";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { SettingsRow, SettingsRows } from "@/components/settings/toggle-row";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { SettingsPage } from "@/types/settings";

/** The signed-in user, as the settings page read it on the server. */
export interface AccountInfo {
    name: string;
    email: string;
}

/** Shortest password Better Auth accepts (its `minPasswordLength` default). */
export const MIN_PASSWORD_LENGTH = 8;

interface AuthClientError {
    code?: string;
    message?: string;
    status?: number;
}

function errorMessage(error: AuthClientError, fallback: string): string {
    if (error.status === 429) {
        return "Too many tries. Wait a minute, then try again";
    }
    return error.message || fallback;
}

/** Client-side check before asking the server, worded for the field. */
export function newPasswordError(value: string): string | null {
    if (value.length === 0) return "Enter a new password";
    if (value.length < MIN_PASSWORD_LENGTH) {
        return `Use at least ${MIN_PASSWORD_LENGTH} characters. This one has ${value.length}`;
    }
    return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Settings › Account: name, sign-in email, password and other devices,
 * plus (hosted) the way to the delete-account flow in Plan & usage.
 *
 * Everything goes through the Better Auth client. Email can only change
 * where the server can send the confirmation (`canChangeEmail`, computed
 * on the server from the same condition that turns on email
 * verification); elsewhere it is read-only.
 */
export function AccountSection({
    account,
    canChangeEmail,
    isHosted,
    onNavigate,
}: {
    account: AccountInfo;
    canChangeEmail: boolean;
    isHosted: boolean;
    /** Opens another settings page (Delete account lives in Plan & usage). */
    onNavigate?: (page: SettingsPage) => void;
}) {
    return (
        <>
            <SettingsGroup title="Profile">
                <SettingsRows>
                    <NameRow initialName={account.name} />
                    <EmailRow
                        email={account.email}
                        canChange={canChangeEmail}
                    />
                </SettingsRows>
            </SettingsGroup>

            <SettingsGroup title="Password and devices">
                <SettingsRows>
                    <PasswordRow />
                    <OtherDevicesRow />
                </SettingsRows>
            </SettingsGroup>

            {isHosted && (
                <SettingsGroup title="Delete account">
                    <SettingsRows>
                        <SettingsRow
                            label="Delete your account and data"
                            description="Lives in Plan & usage, next to your subscription, so you can see what ends with it"
                            control={
                                <Button
                                    variant="quiet"
                                    size="compact"
                                    onClick={() => onNavigate?.("plan")}
                                >
                                    <ArrowRight />
                                    Open Plan &amp; usage
                                </Button>
                            }
                        />
                    </SettingsRows>
                </SettingsGroup>
            )}
        </>
    );
}

function NameRow({ initialName }: { initialName: string }) {
    const router = useRouter();
    const inputId = useId();
    const [saved, setSaved] = useState(initialName);
    const [name, setName] = useState(initialName);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const next = name.trim();
        if (next === saved) {
            setName(saved);
            setError(null);
            return;
        }
        if (!next) {
            setError("Enter a name. It's shown in the account menu");
            return;
        }
        setSaving(true);
        setError(null);
        const { error: authError } = await authClient.updateUser({
            name: next,
        });
        setSaving(false);
        if (authError) {
            setError(errorMessage(authError, "Couldn't save your name"));
            return;
        }
        setSaved(next);
        setName(next);
        toast.success("Name saved");
        router.refresh();
    };

    const messageId = `${inputId}-message`;
    return (
        <SettingsRow
            label="Name"
            description="Shown in the account menu"
            controlId={inputId}
            control={
                <FieldInput
                    id={inputId}
                    className={cn(rowInputClass, "w-64 max-sm:w-full")}
                    value={name}
                    autoComplete="name"
                    maxLength={120}
                    disabled={saving}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? messageId : undefined}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void save()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            void save();
                        }
                        if (e.key === "Escape" && name !== saved) {
                            e.preventDefault();
                            setName(saved);
                            setError(null);
                        }
                    }}
                />
            }
        >
            {error && <FieldError id={messageId}>{error}</FieldError>}
        </SettingsRow>
    );
}

function EmailRow({ email, canChange }: { email: string; canChange: boolean }) {
    const [editing, setEditing] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const close = () => {
        setEditing(false);
        setNewEmail("");
        setError(null);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const next = newEmail.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(next)) {
            setError("Enter an email address like name@example.com");
            return;
        }
        if (next === email.toLowerCase()) {
            setError("That's the email you already sign in with");
            return;
        }
        setSending(true);
        setError(null);
        const { error: authError } = await authClient.changeEmail({
            newEmail: next,
            callbackURL: new URL(
                "/settings#account",
                window.location.origin,
            ).toString(),
        });
        setSending(false);
        if (authError) {
            setError(errorMessage(authError, "Couldn't start the change"));
            return;
        }
        setPending(next);
        close();
        toast.success(`Check ${email} to approve the change`);
    };

    return (
        <SettingsRow
            label="Email"
            description={
                canChange
                    ? "You sign in with it. A change needs a confirmation from both addresses"
                    : "You sign in with it"
            }
            control={
                <>
                    <span className="max-w-72 truncate text-ui font-medium text-strong">
                        {email}
                    </span>
                    {canChange && !editing && (
                        <Button
                            variant="quiet"
                            size="compact"
                            onClick={() => setEditing(true)}
                        >
                            Change
                        </Button>
                    )}
                </>
            }
        >
            {pending && !editing && (
                <p className="text-small text-muted-foreground">
                    Approve the change from {email}, then confirm it from{" "}
                    {pending}. Until then you sign in with {email}
                </p>
            )}
            {editing && (
                <form
                    onSubmit={submit}
                    noValidate
                    className="squircle flex flex-col gap-4 rounded-[var(--radius-item)] bg-background p-4 dark:bg-night-deep/40"
                >
                    <Field
                        label="New email"
                        error={error}
                        hint={`We email ${email} to approve the change, then the new address to confirm it`}
                        className="max-w-80"
                    >
                        <FieldInput
                            type="email"
                            className={rowInputClass}
                            autoComplete="email"
                            autoFocus
                            value={newEmail}
                            disabled={sending}
                            onChange={(e) => {
                                setNewEmail(e.target.value);
                                setError(null);
                            }}
                        />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="bordered"
                            size="compact"
                            onClick={close}
                            disabled={sending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="ink"
                            size="compact"
                            disabled={sending}
                        >
                            {sending ? "Sending…" : "Send confirmation"}
                        </Button>
                    </div>
                </form>
            )}
        </SettingsRow>
    );
}

function PasswordRow() {
    const switchId = useId();
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [signOutOthers, setSignOutOthers] = useState(true);
    const [errors, setErrors] = useState<{
        current?: string;
        next?: string;
        form?: string;
    }>({});
    const [saving, setSaving] = useState(false);

    const close = () => {
        setOpen(false);
        setCurrent("");
        setNext("");
        setSignOutOthers(true);
        setErrors({});
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const found = {
            current: current ? undefined : "Enter your current password",
            next: newPasswordError(next) ?? undefined,
        };
        if (found.current || found.next) {
            setErrors(found);
            return;
        }
        setSaving(true);
        setErrors({});
        const { error } = await authClient.changePassword({
            currentPassword: current,
            newPassword: next,
            revokeOtherSessions: signOutOthers,
        });
        setSaving(false);
        if (error) {
            if (error.code === "INVALID_PASSWORD") {
                setErrors({ current: "That isn't your current password" });
            } else if (
                error.code === "PASSWORD_TOO_SHORT" ||
                error.code === "PASSWORD_TOO_LONG"
            ) {
                setErrors({
                    next: errorMessage(error, "Choose a different password"),
                });
            } else {
                setErrors({
                    form: errorMessage(error, "Couldn't change your password"),
                });
            }
            return;
        }
        close();
        toast.success(
            signOutOthers
                ? "Password changed. Other devices are signed out"
                : "Password changed",
        );
    };

    return (
        <SettingsRow
            label="Password"
            description="Change it here, or reset it from the sign-in page if you've forgotten it"
            control={
                open ? null : (
                    <Button
                        variant="quiet"
                        size="compact"
                        onClick={() => setOpen(true)}
                    >
                        Change password
                    </Button>
                )
            }
        >
            {open && (
                <form
                    onSubmit={submit}
                    noValidate
                    className="squircle flex flex-col gap-4 rounded-[var(--radius-item)] bg-background p-4 dark:bg-night-deep/40"
                >
                    <div className="grid items-start gap-4 sm:grid-cols-2 lg:pr-24">
                        <Field label="Current password" error={errors.current}>
                            <FieldInput
                                type="password"
                                className={rowInputClass}
                                autoComplete="current-password"
                                autoFocus
                                value={current}
                                disabled={saving}
                                onChange={(e) => {
                                    setCurrent(e.target.value);
                                    setErrors((c) => ({
                                        ...c,
                                        current: undefined,
                                    }));
                                }}
                            />
                        </Field>
                        <Field label="New password" error={errors.next}>
                            <FieldInput
                                type="password"
                                className={rowInputClass}
                                autoComplete="new-password"
                                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                                value={next}
                                disabled={saving}
                                onChange={(e) => {
                                    setNext(e.target.value);
                                    setErrors((c) => ({
                                        ...c,
                                        next: undefined,
                                    }));
                                }}
                            />
                        </Field>
                    </div>
                    <label
                        htmlFor={switchId}
                        className="flex w-fit cursor-pointer items-center gap-2.5 text-ui text-foreground select-none"
                    >
                        <SettingsSwitch
                            id={switchId}
                            checked={signOutOthers}
                            onCheckedChange={setSignOutOthers}
                            disabled={saving}
                        />
                        Sign out of other devices
                    </label>
                    {errors.form && (
                        <FieldError role="alert">{errors.form}</FieldError>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="bordered"
                            size="compact"
                            onClick={close}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="ink"
                            size="compact"
                            disabled={saving}
                        >
                            {saving ? "Saving…" : "Save password"}
                        </Button>
                    </div>
                </form>
            )}
        </SettingsRow>
    );
}

function OtherDevicesRow() {
    const [pending, setPending] = useState(false);
    const signOutOthers = async () => {
        setPending(true);
        const { error } = await authClient.revokeOtherSessions();
        setPending(false);
        if (error) {
            toast.error(
                errorMessage(error, "Couldn't sign out the other devices"),
            );
            return;
        }
        toast.success("Signed out of every other device");
    };
    return (
        <SettingsRow
            label="Other devices"
            description="Signs out every browser except this one"
            control={
                <Button
                    variant="quiet"
                    size="compact"
                    onClick={() => void signOutOthers()}
                    disabled={pending}
                >
                    <LogOut />
                    {pending ? "Signing out…" : "Sign out other devices"}
                </Button>
            }
        />
    );
}
