import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
    customers: {
        listTaxIds: vi.fn(),
        createTaxId: vi.fn(),
        retrieveTaxId: vi.fn(),
        deleteTaxId: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/hosted/billing/stripe-client", () => ({
    getStripe: () => stripeMock,
}));

import { prepareCustomerTaxIdentity } from "@/lib/hosted/billing/vat-id";

function taxId(input: {
    id?: string;
    value?: string;
    status: "pending" | "unavailable" | "unverified" | "verified";
    verifiedName?: string | null;
}) {
    return {
        id: input.id ?? "txi_1",
        type: "eu_vat",
        value: input.value ?? "DE123456789",
        verification: {
            status: input.status,
            verified_name: input.verifiedName ?? null,
            verified_address: null,
        },
    };
}

describe("prepareCustomerTaxIdentity", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [] });
        stripeMock.customers.deleteTaxId.mockResolvedValue({ deleted: true });
        stripeMock.customers.update.mockResolvedValue({ id: "cus_1" });
    });

    it("creates an EU VAT ID and waits when Stripe verification is pending", async () => {
        stripeMock.customers.createTaxId.mockResolvedValue(
            taxId({ status: "pending" }),
        );

        await expect(
            prepareCustomerTaxIdentity({
                stripeCustomerId: "cus_1",
                business: { name: "Example GmbH", vatId: "de 123-456-789" },
            }),
        ).rejects.toMatchObject({ code: "vat_id_pending" });

        expect(stripeMock.customers.createTaxId).toHaveBeenCalledWith("cus_1", {
            type: "eu_vat",
            value: "DE123456789",
        });
        expect(stripeMock.customers.update).not.toHaveBeenCalled();
    });

    it("accepts a verified VAT ID and uses Stripe's verified business name", async () => {
        const verified = taxId({
            status: "verified",
            verifiedName: "Verified GmbH",
        });
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [verified] });
        stripeMock.customers.retrieveTaxId.mockResolvedValue(verified);

        await prepareCustomerTaxIdentity({
            stripeCustomerId: "cus_1",
            business: { name: "Entered GmbH", vatId: "DE123456789" },
        });

        expect(stripeMock.customers.update).toHaveBeenCalledWith("cus_1", {
            name: "Verified GmbH",
        });
    });

    it("deletes an unverified VAT ID and rejects checkout", async () => {
        const invalid = taxId({ status: "unverified" });
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [invalid] });
        stripeMock.customers.retrieveTaxId.mockResolvedValue(invalid);

        await expect(
            prepareCustomerTaxIdentity({
                stripeCustomerId: "cus_1",
                business: { name: "Example GmbH", vatId: "DE123456789" },
            }),
        ).rejects.toMatchObject({ code: "invalid_vat_id" });

        expect(stripeMock.customers.deleteTaxId).toHaveBeenCalledWith(
            "cus_1",
            "txi_1",
        );
    });

    it("keeps the previous VAT ID until its replacement is verified", async () => {
        const previous = taxId({
            id: "txi_old",
            value: "FR12345678901",
            status: "verified",
        });
        const replacement = taxId({
            id: "txi_new",
            value: "DE123456789",
            status: "pending",
        });
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [previous] });
        stripeMock.customers.createTaxId.mockResolvedValue(replacement);

        await expect(
            prepareCustomerTaxIdentity({
                stripeCustomerId: "cus_1",
                business: { name: "Example GmbH", vatId: "DE123456789" },
            }),
        ).rejects.toMatchObject({ code: "vat_id_pending" });

        expect(stripeMock.customers.deleteTaxId).not.toHaveBeenCalled();
    });

    it("blocks consumer checkout while a saved VAT ID is pending", async () => {
        const pending = taxId({ status: "pending" });
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [pending] });
        stripeMock.customers.retrieveTaxId.mockResolvedValue(pending);

        await expect(
            prepareCustomerTaxIdentity({ stripeCustomerId: "cus_1" }),
        ).rejects.toMatchObject({ code: "vat_id_pending" });
    });

    it("accepts a verified Polish VAT ID for Stripe's domestic treatment", async () => {
        const verified = taxId({
            value: "PL1234567890",
            status: "verified",
            verifiedName: "Polska Sp. z o.o.",
        });
        stripeMock.customers.listTaxIds.mockResolvedValue({ data: [verified] });
        stripeMock.customers.retrieveTaxId.mockResolvedValue(verified);

        await expect(
            prepareCustomerTaxIdentity({
                stripeCustomerId: "cus_1",
                business: {
                    name: "Polska Sp. z o.o.",
                    vatId: "PL1234567890",
                },
            }),
        ).resolves.toBeUndefined();
    });
});
