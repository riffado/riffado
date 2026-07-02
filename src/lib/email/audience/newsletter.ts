import { iterateConfirmedSubscribers } from "@/db/queries/newsletter-subscriptions";
import type { Recipient } from "@/lib/email/types";

/** Audience generator: confirmed, not-unsubscribed newsletter subscribers. */
export async function* newsletterAudience(): AsyncGenerator<
    Recipient,
    void,
    void
> {
    for await (const sub of iterateConfirmedSubscribers()) {
        yield {
            kind: "subscriber",
            id: sub.id,
            email: sub.email,
            name: null,
            marketingConsent: null,
        };
    }
}
