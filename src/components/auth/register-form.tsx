"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
    type FormEvent,
    type ReactNode,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    AUTH_ERROR_COPY,
    type AuthClientError,
    MIN_PASSWORD_LENGTH,
    mapAuthError,
    passwordTooShortMessage,
} from "@/components/auth/auth-errors";
import {
    AuthHeading,
    AuthSwitch,
    AuthTerms,
    ErrorLink,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldInput } from "@/components/ui/field";
import { sendVerificationEmail, signUp } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const RESEND_COOLDOWN_MS = 30_000;

/**
 * Where a new account lands: the dashboard's first-run screen, which
 * greets the user once when it sees `welcome=1`. Also the target of the
 * emailed verification link.
 */
export const POST_SIGN_UP_URL = "/dashboard?welcome=1";

interface RegisterFormProps {
    /**
     * Whether the instance requires email verification before sign-in
     * (`emailVerificationRequired` in `src/lib/auth.ts` -- hosted + SMTP
     * configured only). When true, `signUp.email()` creates the user but
     * does not create a session, so we can't redirect into the app; we
     * show "Check your email" in place instead.
     */
    requireEmailVerification: boolean;
    /** Shows the hosted Terms and Privacy line. */
    showTerms?: boolean;
}

type FieldName = "name" | "email" | "password" | "confirmPassword";

type RegisterErrors = Partial<Record<FieldName | "form", ReactNode>>;

/** Create-account heading, form and links, or "Check your email" after. */
export function RegisterForm({
    requireEmailVerification,
    showTerms = false,
}: RegisterFormProps) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<RegisterErrors>({});
    const [awaitingVerification, setAwaitingVerification] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmPasswordRef = useRef<HTMLInputElement>(null);
    const refs: Record<FieldName, RefObject<HTMLInputElement | null>> = {
        name: nameRef,
        email: emailRef,
        password: passwordRef,
        confirmPassword: confirmPasswordRef,
    };
    const { push, refresh } = useRouter();

    const fail = (field: FieldName | "form", message: ReactNode) => {
        setErrors({ [field]: message });
        if (field !== "form") refs[field].current?.focus();
    };

    const clearError = (field: FieldName) => {
        if (errors[field] || errors.form) setErrors({});
    };

    const showError = (error: AuthClientError) => {
        const { kind } = mapAuthError(error);
        switch (kind) {
            case "email-taken":
                fail(
                    "email",
                    <>
                        There's already an account with this email.{" "}
                        <ErrorLink href="/login">Sign in</ErrorLink> instead
                    </>,
                );
                return;
            case "invalid-email":
                fail("email", AUTH_ERROR_COPY.invalidEmail);
                return;
            case "password-too-short":
                fail("password", passwordTooShortMessage(password.length));
                return;
            case "password-too-long":
                fail("password", AUTH_ERROR_COPY.passwordTooLong);
                return;
            case "sign-up-disabled":
                fail("form", AUTH_ERROR_COPY.signUpDisabled);
                return;
            case "rate-limited":
                fail("form", AUTH_ERROR_COPY.rateLimited);
                return;
            default:
                fail(
                    "form",
                    error.message || "Couldn't create your account. Try again",
                );
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!name.trim()) return fail("name", "Enter your name");
        if (!email.trim()) return fail("email", "Enter your email");
        if (password.length < MIN_PASSWORD_LENGTH) {
            return fail("password", passwordTooShortMessage(password.length));
        }
        if (password !== confirmPassword) {
            return fail("confirmPassword", AUTH_ERROR_COPY.passwordsDontMatch);
        }

        setErrors({});
        setIsLoading(true);

        try {
            const result = await signUp.email({
                email,
                password,
                name,
                // Where the verification link signs the user in, matching
                // the destination when verification is off.
                callbackURL: POST_SIGN_UP_URL,
            });

            if (result.error) {
                showError(result.error);
                return;
            }

            if (requireEmailVerification) {
                setAwaitingVerification(true);
                return;
            }

            if (posthog.__loaded && result.data?.user) {
                // Distinct id only -- see posthog-identify.tsx for why.
                posthog.identify(result.data.user.id);
                posthog.capture("user_signed_up");
            }

            push(POST_SIGN_UP_URL);
            refresh();
        } catch {
            fail("form", AUTH_ERROR_COPY.network);
        } finally {
            setIsLoading(false);
        }
    };

    if (awaitingVerification) {
        return <CheckYourEmail email={email} />;
    }

    return (
        <>
            <AuthHeading title="Create your account" />
            <form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-4"
            >
                <Field label="Name" error={errors.name}>
                    <FieldInput
                        ref={nameRef}
                        type="text"
                        name="name"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            clearError("name");
                        }}
                        required
                        autoComplete="name"
                    />
                </Field>

                <Field label="Email" error={errors.email}>
                    <FieldInput
                        ref={emailRef}
                        type="email"
                        name="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            clearError("email");
                        }}
                        required
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                </Field>

                <Field
                    label="Password"
                    hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    error={errors.password}
                >
                    <FieldInput
                        ref={passwordRef}
                        type="password"
                        name="password"
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            clearError("password");
                        }}
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                    />
                </Field>

                <Field label="Confirm password" error={errors.confirmPassword}>
                    <FieldInput
                        ref={confirmPasswordRef}
                        type="password"
                        name="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            clearError("confirmPassword");
                        }}
                        required
                        autoComplete="new-password"
                    />
                </Field>

                <div className="flex flex-col gap-3 pt-2">
                    {errors.form ? (
                        <FieldError role="alert">{errors.form}</FieldError>
                    ) : null}
                    <Button
                        type="submit"
                        variant="ink"
                        size="control"
                        className="w-full"
                        disabled={isLoading}
                    >
                        {isLoading ? "Creating account…" : "Create account"}
                    </Button>
                </div>
            </form>

            <div className="flex flex-col gap-5">
                <AuthSwitch prompt="Already have an account?" href="/login">
                    Sign in
                </AuthSwitch>
                {showTerms ? <AuthTerms /> : null}
            </div>
        </>
    );
}

/** "Check your email" after sign-up on instances that verify email. */
function CheckYourEmail({ email }: { email: string }) {
    const [lastSentAt, setLastSentAt] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    const [isResending, setIsResending] = useState(false);
    const waitSeconds = Math.max(
        0,
        Math.ceil((RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000),
    );

    useEffect(() => {
        if (waitSeconds === 0) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [waitSeconds]);

    const handleResend = async () => {
        if (waitSeconds > 0) return;
        setIsResending(true);
        try {
            const result = await sendVerificationEmail({
                email,
                callbackURL: POST_SIGN_UP_URL,
            });
            if (result.error) {
                toast.error(
                    result.error.status === 429
                        ? AUTH_ERROR_COPY.rateLimited
                        : "Couldn't send the email. Try again in a minute",
                );
                return;
            }
            const sentAt = Date.now();
            setLastSentAt(sentAt);
            setNow(sentAt);
            toast.success("Email sent again");
        } catch {
            toast.error(AUTH_ERROR_COPY.network);
        } finally {
            setIsResending(false);
        }
    };

    return (
        <>
            <AuthHeading title="Check your email">
                We sent a link to{" "}
                <span className="font-medium text-strong">{email}</span>. Open
                it within 24 hours to finish creating your account.
            </AuthHeading>
            <div className="flex flex-col gap-3">
                <Button
                    type="button"
                    variant="bordered"
                    size="control"
                    className="w-full tabular-nums"
                    onClick={handleResend}
                    disabled={isResending || waitSeconds > 0}
                >
                    {isResending
                        ? "Sending…"
                        : waitSeconds > 0
                          ? `Resend email in ${waitSeconds}s`
                          : "Resend email"}
                </Button>
                <p className="text-small text-muted-foreground">
                    Nothing after a few minutes? Check your spam folder, then
                    resend
                </p>
            </div>
            <AuthSwitch prompt="Already confirmed?" href="/login">
                Sign in
            </AuthSwitch>
        </>
    );
}
