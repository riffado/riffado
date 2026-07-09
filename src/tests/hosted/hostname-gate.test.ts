import { describe, expect, it } from "vitest";
import { decideHostnameGate } from "@/lib/hosted/hostname-gate";

const ADMIN = "admin.riffado.com";
const CUSTOMER = "riffado.com";

describe("decideHostnameGate -- gate disabled (self-host default)", () => {
    it("passes admin paths on any host when adminHostname is undefined", () => {
        expect(
            decideHostnameGate({
                requestHostname: "localhost",
                pathname: "/admin",
                adminHostname: undefined,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: "self-hosted.example.com",
                pathname: "/admin/users",
                adminHostname: undefined,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: "anything",
                pathname: "/api/admin/actions/suspend",
                adminHostname: undefined,
            }),
        ).toEqual({ kind: "next" });
    });

    it("passes customer paths on any host when adminHostname is undefined", () => {
        expect(
            decideHostnameGate({
                requestHostname: "localhost",
                pathname: "/dashboard",
                adminHostname: undefined,
            }),
        ).toEqual({ kind: "next" });
    });
});

describe("decideHostnameGate -- gate active, customer host", () => {
    it("blocks /admin on the customer host", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/admin",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "not-found" });
    });

    it("blocks /admin/* subpaths on the customer host", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/admin/users/abc",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "not-found" });
    });

    it("blocks /api/admin/* on the customer host", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/api/admin/actions/suspend",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "not-found" });
    });

    it("allows customer pages on the customer host", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/dashboard",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/api/recordings/123",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("allows auth paths on the customer host", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/login",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/api/auth/sign-in/email",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });
});

describe("decideHostnameGate -- gate active, admin host", () => {
    it("redirects bare / to /admin on the admin host", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "redirect", to: "/admin" });
    });

    it("serves /admin and /admin/* on the admin host", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/admin",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/admin/users",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("serves /api/admin/* on the admin host", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/api/admin/actions/suspend",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("serves auth pages on the admin host (operators need to log in)", () => {
        for (const path of [
            "/login",
            "/register",
            "/forgot-password",
            "/reset-password",
            "/api/auth/sign-in/email",
            "/api/auth/get-session",
        ]) {
            expect(
                decideHostnameGate({
                    requestHostname: ADMIN,
                    pathname: path,
                    adminHostname: ADMIN,
                }),
            ).toEqual({ kind: "next" });
        }
    });

    it("blocks customer pages on the admin host", () => {
        for (const path of [
            "/dashboard",
            "/settings",
            "/recordings/abc",
            "/onboarding",
            "/rebrand",
            "/api/recordings/123",
        ]) {
            expect(
                decideHostnameGate({
                    requestHostname: ADMIN,
                    pathname: path,
                    adminHostname: ADMIN,
                }),
            ).toEqual({ kind: "not-found" });
        }
    });

    it("blocks /api/v1/* (customer-facing external API) on the admin host", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/api/v1/recordings",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "not-found" });
    });

    it("serves /api/stripe/webhook on the admin host (shared)", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/api/stripe/webhook",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("serves /api/stripe/webhook on the customer host too (dual-homed)", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/api/stripe/webhook",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });
});

describe("decideHostnameGate -- prefix-boundary correctness", () => {
    it("does not treat /administrator as an admin path", () => {
        // Important: prefix check must respect path boundaries so that
        // /administrator or /admin-something is NOT treated as /admin.
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/administrator",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("does not treat /api/administrators as /api/admin", () => {
        expect(
            decideHostnameGate({
                requestHostname: CUSTOMER,
                pathname: "/api/administrators",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "next" });
    });

    it("does not treat /login-help as the auth /login allowlist", () => {
        expect(
            decideHostnameGate({
                requestHostname: ADMIN,
                pathname: "/login-help",
                adminHostname: ADMIN,
            }),
        ).toEqual({ kind: "not-found" });
    });
});
