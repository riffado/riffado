"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
    baseURL:
        typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:3000",
});

export const { useSession, signIn, signOut, signUp, resetPassword } =
    authClient;

/** @deprecated better-auth renamed forgetPassword → requestPasswordReset in v1.4 */
export const forgetPassword = authClient.requestPasswordReset;
