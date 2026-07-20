import { describe, expect, it } from "vitest";
import { formatEmailPrice } from "@/lib/notifications/email-templates/format-price";

describe("formatEmailPrice", () => {
    it("formats a whole-dollar USD amount with the site's symbol style", () => {
        expect(formatEmailPrice("5.00", "USD")).toBe("$5/month");
    });

    it("formats EUR with the euro symbol", () => {
        expect(formatEmailPrice("9.00", "EUR")).toBe("\u20ac9/month");
    });

    it("keeps a non-zero decimal amount", () => {
        expect(formatEmailPrice("7.50", "usd")).toBe("$7.50/month");
    });

    it("supports a custom suffix", () => {
        expect(formatEmailPrice("90.00", "USD", "/year")).toBe("$90/year");
    });
});
