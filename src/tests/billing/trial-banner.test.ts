import { describe, expect, it } from "vitest";
import { resolveBillingBannerMode } from "@/components/dashboard/trial-banner";

const baseState = {
    enabled: true,
    plan: "hosted_free" as const,
    foundingOfferAvailable: true,
    grace: null,
    subscription: null,
};

describe("resolveBillingBannerMode", () => {
    it("treats a grandfathered user inside the transition window as active", () => {
        const transitionUntil = new Date(
            Date.now() + 10 * 24 * 60 * 60 * 1000,
        ).toISOString();

        expect(
            resolveBillingBannerMode({
                ...baseState,
                planTransitionUntil: transitionUntil,
            }),
        ).toEqual({
            kind: "transition",
            daysLeft: 10,
            transitionUntil,
            foundingOfferAvailable: true,
        });
    });

    it("locks a grandfathered user only after the transition window", () => {
        expect(
            resolveBillingBannerMode({
                ...baseState,
                planTransitionUntil: new Date(Date.now() - 1_000).toISOString(),
            }),
        ).toEqual({ kind: "locked" });
    });
});
