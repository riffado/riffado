"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldInput } from "@/components/ui/field";
import { toast } from "@/lib/toast";
import {
    announceConnected,
    type ConnectFailure,
    failureFromError,
    failureFromResponse,
    postJson,
} from "./connect-request";
import { ConnectErrorNotice, inlineLinkClass } from "./dialog-parts";
import { plaudRegionFromApiBase } from "./server-label";

const RESEND_COOLDOWN_MS = 30_000;
const SSO_ISSUE_URL = "https://github.com/riffado/riffado/issues/65";

interface EmailCodeViewProps {
    onConnected: () => void;
    onUseConnector: () => void;
    /** Prefills the email, e.g. the stored account on reconnect. */
    defaultEmail?: string | null;
}

/**
 * Email code sign-in: Plaud emails a code, Riffado verifies it. The send
 * route follows Plaud's region redirect, so the code step shows the
 * region the account was found on.
 */
export function EmailCodeView({
    onConnected,
    onUseConnector,
    defaultEmail,
}: EmailCodeViewProps) {
    const [step, setStep] = useState<"email" | "code">("email");
    const [email, setEmail] = useState(defaultEmail ?? "");
    const [code, setCode] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [apiBase, setApiBase] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [lastSentAt, setLastSentAt] = useState(0);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [failure, setFailure] = useState<ConnectFailure | null>(null);

    const sendCode = useCallback(
        async (isResend: boolean) => {
            const trimmed = email.trim();
            if (!trimmed) {
                setFieldError("Enter the email you use for Plaud");
                return;
            }
            const now = Date.now();
            if (now - lastSentAt < RESEND_COOLDOWN_MS) {
                const secs = Math.ceil(
                    (RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000,
                );
                setFailure({
                    message: `Wait ${secs}s before sending another code`,
                });
                return;
            }
            setFieldError(null);
            setFailure(null);
            setIsLoading(true);
            try {
                const res = await postJson("/api/plaud/auth/send-code", {
                    email: trimmed,
                });
                if (!res.ok) {
                    setFailure(
                        await failureFromResponse(
                            res,
                            "Couldn't send the code",
                            "send Plaud verification code",
                        ),
                    );
                    return;
                }
                const data = (await res.json()) as {
                    otpToken: string;
                    apiBase: string;
                };
                setOtpToken(data.otpToken);
                setApiBase(data.apiBase);
                setLastSentAt(Date.now());
                setStep("code");
                if (isResend) toast.success("New code sent");
            } catch (err) {
                setFailure(failureFromError(err, "Couldn't send the code"));
            } finally {
                setIsLoading(false);
            }
        },
        [email, lastSentAt],
    );

    const verify = useCallback(async () => {
        const trimmed = code.trim();
        if (!trimmed) {
            setFieldError("Enter the code from the email");
            return;
        }
        setFieldError(null);
        setFailure(null);
        setIsLoading(true);
        try {
            const res = await postJson("/api/plaud/auth/verify", {
                code: trimmed,
                otpToken,
                apiBase,
                email,
            });
            if (!res.ok) {
                setFailure(
                    await failureFromResponse(
                        res,
                        "Couldn't verify the code",
                        "verify Plaud OTP code",
                    ),
                );
                return;
            }
            await announceConnected(res);
            onConnected();
        } catch (err) {
            setFailure(failureFromError(err, "Couldn't verify the code"));
        } finally {
            setIsLoading(false);
        }
    }, [code, otpToken, apiBase, email, onConnected]);

    if (step === "email") {
        return (
            <form
                noValidate
                className="flex flex-col gap-5 px-6 pt-6 pb-6"
                onSubmit={(e) => {
                    e.preventDefault();
                    void sendCode(false);
                }}
            >
                <Field
                    id="plaud-email"
                    label="Plaud email"
                    hint="The email you sign in to plaud.ai with. Plaud sends the code"
                    error={fieldError}
                >
                    <FieldInput
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            setFieldError(null);
                        }}
                        disabled={isLoading}
                        // oxlint-disable-next-line jsx-a11y/no-autofocus -- intentional -- the view exists to take this one input
                        autoFocus
                    />
                </Field>

                <p className="text-small text-subtle">
                    Signed up to Plaud with Google or Apple? The email code may
                    sign you in to a different, empty Plaud account.{" "}
                    <button
                        type="button"
                        onClick={onUseConnector}
                        className={inlineLinkClass}
                    >
                        Use Sign in with Plaud instead
                    </button>{" "}
                    <a
                        href={SSO_ISSUE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={inlineLinkClass}
                    >
                        #65
                    </a>
                </p>

                <div className="flex flex-col gap-3">
                    <ConnectErrorNotice failure={failure} />
                    <Button
                        type="submit"
                        variant="ink"
                        size="control"
                        disabled={isLoading}
                        className="w-full"
                    >
                        {isLoading ? "Sending code…" : "Send code"}
                    </Button>
                </div>
            </form>
        );
    }

    return (
        <form
            noValidate
            className="flex flex-col gap-5 px-6 pt-6 pb-6"
            onSubmit={(e) => {
                e.preventDefault();
                void verify();
            }}
        >
            <Field
                id="plaud-otp"
                label="Verification code"
                hint={
                    <>
                        Sent to{" "}
                        <span className="font-medium text-foreground">
                            {email.trim()}
                        </span>
                        {apiBase && (
                            <> · {plaudRegionFromApiBase(apiBase)} server</>
                        )}
                    </>
                }
                error={fieldError}
            >
                <FieldInput
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value);
                        setFieldError(null);
                    }}
                    disabled={isLoading}
                    className="text-center font-mono tracking-[0.3em] tabular-nums"
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- intentional -- the code arrives by email and is typed right away
                    autoFocus
                />
            </Field>

            <div className="flex flex-col gap-3">
                <ConnectErrorNotice failure={failure} />
                <Button
                    type="submit"
                    variant="ink"
                    size="control"
                    disabled={isLoading}
                    className="w-full"
                >
                    {isLoading ? "Checking code…" : "Connect account"}
                </Button>
                <div className="flex items-center justify-between text-small text-subtle">
                    <button
                        type="button"
                        onClick={() => {
                            setStep("email");
                            setCode("");
                            setFieldError(null);
                            setFailure(null);
                        }}
                        className={inlineLinkClass}
                    >
                        Use a different email
                    </button>
                    <button
                        type="button"
                        onClick={() => void sendCode(true)}
                        disabled={isLoading}
                        className={`${inlineLinkClass} disabled:opacity-50`}
                    >
                        Send a new code
                    </button>
                </div>
            </div>
        </form>
    );
}
