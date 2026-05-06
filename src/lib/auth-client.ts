"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
    baseURL:
        typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:3000",
});

export const {
    useSession,
    signIn,
    signOut,
    signUp,
    forgetPassword,
    resetPassword,
} = authClient;
