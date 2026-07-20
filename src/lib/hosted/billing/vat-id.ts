import Stripe from "stripe";
import { getStripe } from "./stripe-client";

const EU_VAT_PREFIXES = new Set([
    "AT",
    "BE",
    "BG",
    "CY",
    "CZ",
    "DE",
    "DK",
    "EE",
    "EL",
    "ES",
    "FI",
    "FR",
    "HR",
    "HU",
    "IE",
    "IT",
    "LT",
    "LU",
    "LV",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SE",
    "SI",
    "SK",
    "XI",
]);

export type VatIdVerificationCode =
    | "invalid_vat_id"
    | "vat_id_pending"
    | "vat_id_unavailable";

export class VatIdVerificationError extends Error {
    constructor(
        message: string,
        readonly code: VatIdVerificationCode,
    ) {
        super(message);
        this.name = "VatIdVerificationError";
    }
}

export interface VerifiedBusiness {
    name: string;
    vatId: string;
}

export async function prepareCustomerTaxIdentity(input: {
    stripeCustomerId: string;
    business?: VerifiedBusiness;
}): Promise<void> {
    const stripe = getStripe();
    const taxIds = await stripe.customers.listTaxIds(input.stripeCustomerId, {
        limit: 100,
    });
    const euVatIds = taxIds.data.filter((taxId) => taxId.type === "eu_vat");

    if (!input.business) {
        await rejectUnsafeExistingTaxIds({
            stripe,
            stripeCustomerId: input.stripeCustomerId,
            taxIds: euVatIds,
        });
        return;
    }

    const normalizedVatId = normalizeEuVatId(input.business.vatId);
    if (!EU_VAT_PREFIXES.has(normalizedVatId.slice(0, 2))) {
        throw new VatIdVerificationError(
            "Enter a VAT ID issued by an EU member state",
            "invalid_vat_id",
        );
    }

    let taxId = euVatIds.find(
        (candidate) => normalizeEuVatId(candidate.value) === normalizedVatId,
    );
    if (!taxId) {
        try {
            taxId = await stripe.customers.createTaxId(input.stripeCustomerId, {
                type: "eu_vat",
                value: normalizedVatId,
            });
        } catch (error) {
            if (error instanceof Stripe.errors.StripeInvalidRequestError) {
                throw new VatIdVerificationError(
                    "The VAT ID format is invalid",
                    "invalid_vat_id",
                );
            }
            throw error;
        }
    } else {
        taxId = await stripe.customers.retrieveTaxId(
            input.stripeCustomerId,
            taxId.id,
        );
    }

    await requireVerifiedTaxId({
        stripe,
        stripeCustomerId: input.stripeCustomerId,
        taxId,
    });

    for (const staleTaxId of euVatIds) {
        if (staleTaxId.id !== taxId.id) {
            await stripe.customers.deleteTaxId(
                input.stripeCustomerId,
                staleTaxId.id,
            );
        }
    }

    await stripe.customers.update(input.stripeCustomerId, {
        name: taxId.verification?.verified_name ?? input.business.name,
    });
}

async function rejectUnsafeExistingTaxIds(input: {
    stripe: Stripe;
    stripeCustomerId: string;
    taxIds: Stripe.TaxId[];
}): Promise<void> {
    for (const taxId of input.taxIds) {
        const refreshed = await input.stripe.customers.retrieveTaxId(
            input.stripeCustomerId,
            taxId.id,
        );
        const status = refreshed.verification?.status;
        if (status === "unverified") {
            await input.stripe.customers.deleteTaxId(
                input.stripeCustomerId,
                refreshed.id,
            );
            throw new VatIdVerificationError(
                "The saved VAT ID could not be verified. Update it before checkout.",
                "invalid_vat_id",
            );
        }
        if (status === "pending") {
            throw new VatIdVerificationError(
                "The saved VAT ID is still being verified. Try checkout again shortly.",
                "vat_id_pending",
            );
        }
        if (status === "unavailable" || status === undefined) {
            throw new VatIdVerificationError(
                "VAT ID verification is temporarily unavailable. Try again later.",
                "vat_id_unavailable",
            );
        }
    }
}

async function requireVerifiedTaxId(input: {
    stripe: Stripe;
    stripeCustomerId: string;
    taxId: Stripe.TaxId;
}): Promise<void> {
    const status = input.taxId.verification?.status;
    if (status === "verified") return;

    if (status === "unverified") {
        await input.stripe.customers.deleteTaxId(
            input.stripeCustomerId,
            input.taxId.id,
        );
        throw new VatIdVerificationError(
            "The VAT ID could not be verified in VIES",
            "invalid_vat_id",
        );
    }
    if (status === "pending") {
        throw new VatIdVerificationError(
            "The VAT ID is still being verified. Try checkout again shortly.",
            "vat_id_pending",
        );
    }
    throw new VatIdVerificationError(
        "VAT ID verification is temporarily unavailable. Try again later.",
        "vat_id_unavailable",
    );
}

function normalizeEuVatId(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
