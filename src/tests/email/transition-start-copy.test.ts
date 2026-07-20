import { render } from "@react-email/render";
import React from "react";
import { describe, expect, it } from "vitest";
import { TransitionStartEmail } from "@/lib/notifications/email-templates/transition-start";

const baseProps = {
    transitionEndsAt: new Date("2026-08-27T23:59:59Z"),
    amountValue: "5.00",
    amountCurrency: "USD",
    foundingCapacity: 100,
    billingUrl: "https://riffado.com/settings#billing",
    exportUrl: "https://riffado.com/settings#export",
    selfHostUrl: "https://github.com/riffado/riffado#quick-start",
};

describe("TransitionStartEmail", () => {
    it("states the capacity rule without guaranteeing a founding spot", async () => {
        const text = await render(
            React.createElement(TransitionStartEmail, {
                ...baseProps,
                foundingOfferAvailable: true,
            }),
            { plainText: true },
        );
        expect(text).toContain("first 100 paid monthly members");
        expect(text).toContain("first-paid, first-served");
        expect(text).toContain("Claim founding price");
        expect(text).toContain("your account becomes read-only");
        expect(text).toContain("Nothing gets deleted");
        expect(text).not.toContain("Add a card before then");
        expect(text).toContain(
            "https://github.com/riffado/riffado#quick-start",
        );
    });

    it("shows standard pricing after founding capacity is gone", async () => {
        const text = await render(
            React.createElement(TransitionStartEmail, {
                ...baseProps,
                amountValue: "9.00",
                foundingOfferAvailable: false,
            }),
            { plainText: true },
        );
        expect(text).toContain("Monthly Hosted Pro is available for $9");
        expect(text).toContain("Choose a plan");
        expect(text).not.toContain("first 100 paid monthly members");
    });

    it("explains why hosted is now paid, not just what changed", async () => {
        const text = await render(
            React.createElement(TransitionStartEmail, {
                ...baseProps,
                foundingOfferAvailable: true,
            }),
            { plainText: true },
        );
        expect(text).toContain("real infrastructure");
        expect(text).toContain("no lock-in");
        expect(text).toContain("Self-host and Hosted Pro are the same project");
    });

    it("gives account-critical facts their own scannable section", async () => {
        const text = await render(
            React.createElement(TransitionStartEmail, {
                ...baseProps,
                foundingOfferAvailable: true,
            }),
            { plainText: true },
        );
        expect(text.toLowerCase()).toContain(
            "what this means for your account",
        );
        expect(text).toContain("grace period");
    });
});
