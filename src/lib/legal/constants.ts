/**
 * Single source of truth for the operator's legal identity and the facts
 * the hosted `(legal)` pages render. Centralized so the entity name,
 * address, governing law, contacts, and recipient categories live in one
 * reviewable place instead of being duplicated across the privacy and
 * terms documents.
 *
 * Public registry data only. No personal data (board-member names, PESEL,
 * etc.) belongs here -- the operator is the company, not an individual.
 *
 * These pages describe the HOSTED service only. The `(legal)` layout
 * 404s on self-host (`!IS_HOSTED`), so nothing here applies to a
 * self-hosted instance.
 */

/** Operator and GDPR data controller for the hosted service. */
export const LEGAL_ENTITY = {
    /** Short trading form used in running prose. */
    name: "PERIER sp. z o.o.",
    /** Full registered name. */
    fullName: "PERIER spółka z ograniczoną odpowiedzialnością",
    form: "a limited liability company incorporated under the laws of Poland (spółka z ograniczoną odpowiedzialnością)",
    krs: "0001203585",
    nip: "8513340283",
    regon: "543161719",
    registrationCourt:
        "District Court Szczecin-Centrum in Szczecin, 13th Commercial Division of the National Court Register (Sąd Rejonowy Szczecin-Centrum w Szczecinie, XIII Wydział Gospodarczy Krajowego Rejestru Sądowego)",
    shareCapital: "PLN 5,000",
    address: {
        street: "ul. 1 Maja 39",
        postalCode: "71-627",
        city: "Szczecin",
        country: "Poland",
    },
} as const;

/** Governing law for the hosted service contract. */
export const GOVERNING_LAW = {
    country: "Poland",
    /** Phrase to drop into prose, e.g. "governed by the laws of Poland". */
    lawPhrase: "the laws of Poland",
} as const;

/**
 * Minimum age to use the hosted service. 16 matches the digital-consent
 * age set for Poland under Article 8 GDPR. Under-18s need a parent or
 * guardian's consent to enter the service contract.
 */
export const MIN_AGE = 16;

/** ISO date the current documents take effect. */
export const EFFECTIVE_DATE = "2026-06-20";

/** Human-readable effective date, pinned to UTC to avoid off-by-one. */
export const EFFECTIVE_DATE_DISPLAY = new Date(
    EFFECTIVE_DATE,
).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
});

/** Contact mailboxes referenced by the legal pages. */
export const CONTACT_EMAILS = {
    support: "support@riffado.com",
    security: "security@riffado.com",
    /** Dedicated mailbox for GDPR data-subject requests. */
    privacy: "privacy@riffado.com",
} as const;

/** Polish data-protection supervisory authority (GDPR right to complain). */
export const SUPERVISORY_AUTHORITY = {
    name: "the President of the Personal Data Protection Office (Prezes Urzędu Ochrony Danych Osobowych, UODO)",
    address: "ul. Stawki 2, 00-193 Warsaw, Poland",
    url: "https://uodo.gov.pl",
} as const;

export type RecipientCategory = {
    category: string;
    purpose: string;
    location: string;
    safeguard: string;
};

/**
 * Categories of recipients that process personal data on the operator's
 * behalf for the hosted service (GDPR Art. 13(1)(e) -- disclosed as
 * categories, not named vendors, per the operator's decision). Each
 * category must stay specific enough to satisfy the EDPB transparency
 * guidelines: what kind of provider, what it does, where it processes,
 * and the transfer safeguard.
 *
 * Self-hosted analytics (Rybbit) runs on the operator's own
 * infrastructure and is intentionally NOT a third-party recipient.
 * User-configured AI providers are not the operator's processors either
 * -- the user contracts with them directly.
 *
 * When error monitoring (PostHog EU) ships, add an "error monitoring
 * provider" category here; being EU-hosted it introduces no new
 * international-transfer concern.
 */
export const RECIPIENT_CATEGORIES: RecipientCategory[] = [
    {
        category: "Payment processor",
        purpose: "Payment processing for hosted subscriptions",
        location:
            "Ireland (EEA), with onward transfer to its US parent company",
        safeguard:
            "EU Standard Contractual Clauses; EU-U.S. Data Privacy Framework",
    },
    {
        category: "Cloud hosting provider",
        purpose: "Application hosting and database",
        location: "Germany (EEA)",
        safeguard: "Processed within the EEA",
    },
    {
        category: "Object storage provider",
        purpose: "Encrypted audio file storage",
        location: "EU-region storage; provider established in the USA",
        safeguard:
            "Data Processing Addendum and EU Standard Contractual Clauses",
    },
    {
        category: "Email delivery provider",
        purpose: "Transactional email delivery",
        location: "USA",
        safeguard:
            "Data Processing Addendum and EU Standard Contractual Clauses",
    },
    {
        category: "AI transcription provider",
        purpose:
            "Cloud transcription for hosted-Pro users who have not configured their own AI provider",
        location: "USA",
        safeguard:
            "Data Processing Addendum and EU Standard Contractual Clauses",
    },
];

/** Formatted one-line postal address for the operator. */
export const LEGAL_ADDRESS_LINE = `${LEGAL_ENTITY.address.street}, ${LEGAL_ENTITY.address.postalCode} ${LEGAL_ENTITY.address.city}, ${LEGAL_ENTITY.address.country}`;
