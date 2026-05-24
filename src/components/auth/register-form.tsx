"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/icons/logo";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";

export function RegisterForm({
    allowedEmailDomains = [],
}: {
    allowedEmailDomains?: readonly string[];
}) {
    const t = useTranslations("auth.signUp");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const { push, refresh } = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            toast.error(t("passwordsMismatch"));
            return;
        }

        if (password.length < 8) {
            toast.error(t("passwordTooShort"));
            return;
        }

        setIsLoading(true);

        try {
            const result = await signUp.email({
                email,
                password,
                name,
            });

            if (result.error) {
                toast.error(result.error.message || t("failedGeneric"));
                return;
            }

            toast.success(t("createdToast"));
            push("/onboarding");
            refresh();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : t("failedGeneric");
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Panel className="w-full max-w-md space-y-6">
            <div className="flex items-center gap-3">
                <Logo className="size-10 shrink-0" />
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {t("subtitle")}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="name">{t("name")}</Label>
                    <Input
                        id="name"
                        type="text"
                        placeholder={t("namePlaceholder")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email">{t("email")}</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder={t("emailPlaceholder")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isLoading}
                    />
                    {allowedEmailDomains.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                            {t("domainsHint", {
                                domains: allowedEmailDomains.join(", "),
                            })}
                        </p>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <Label htmlFor="password">{t("password")}</Label>
                    <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={isLoading}
                        minLength={8}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                        {t("confirmPassword")}
                    </Label>
                    <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        disabled={isLoading}
                    />
                </div>

                <MetalButton
                    type="submit"
                    className="w-full"
                    variant="cyan"
                    disabled={isLoading}
                >
                    {isLoading ? t("submitting") : t("submit")}
                </MetalButton>
            </form>

            <div className="text-center text-sm">
                <span className="text-muted-foreground">
                    {t("haveAccount")}{" "}
                </span>
                <Link
                    href="/login"
                    className="text-accent-cyan hover:underline"
                >
                    {t("signInLink")}
                </Link>
            </div>
        </Panel>
    );
}
