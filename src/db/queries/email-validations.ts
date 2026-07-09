import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailValidations } from "@/db/schema";
import type { Reachable } from "@/lib/email/reacher";

const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface ValidationRow {
    email: string;
    reachable: Reachable;
    isDisposable: boolean;
    isRoleAccount: boolean;
    hasFullInbox: boolean;
    isCatchAll: boolean;
    mxAccepts: boolean;
    checkedAt: Date;
}

/** Fetch cached validation rows fresher than `maxAgeMs`, keyed by email. */
export async function findFreshValidations(
    emails: readonly string[],
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<Map<string, ValidationRow>> {
    if (emails.length === 0) return new Map();
    const normalized = emails.map((e) => e.toLowerCase());
    const threshold = new Date(Date.now() - maxAgeMs);

    const rows = await db
        .select({
            email: emailValidations.email,
            reachable: emailValidations.reachable,
            isDisposable: emailValidations.isDisposable,
            isRoleAccount: emailValidations.isRoleAccount,
            hasFullInbox: emailValidations.hasFullInbox,
            isCatchAll: emailValidations.isCatchAll,
            mxAccepts: emailValidations.mxAccepts,
            checkedAt: emailValidations.checkedAt,
        })
        .from(emailValidations)
        .where(
            and(
                gte(emailValidations.checkedAt, threshold),
                inArray(emailValidations.email, normalized),
            ),
        );

    const result = new Map<string, ValidationRow>();
    for (const r of rows) {
        result.set(r.email, {
            email: r.email,
            reachable: r.reachable as Reachable,
            isDisposable: r.isDisposable,
            isRoleAccount: r.isRoleAccount,
            hasFullInbox: r.hasFullInbox,
            isCatchAll: r.isCatchAll,
            mxAccepts: r.mxAccepts,
            checkedAt: r.checkedAt,
        });
    }
    return result;
}

interface UpsertInput {
    email: string;
    reachable: Reachable;
    isDisposable: boolean;
    isRoleAccount: boolean;
    hasFullInbox: boolean;
    isCatchAll: boolean;
    mxAccepts: boolean;
    rawResponse: unknown;
    provider?: string;
}

export async function upsertValidation(input: UpsertInput): Promise<void> {
    const normalized = input.email.toLowerCase();
    await db
        .insert(emailValidations)
        .values({
            email: normalized,
            reachable: input.reachable,
            isDisposable: input.isDisposable,
            isRoleAccount: input.isRoleAccount,
            hasFullInbox: input.hasFullInbox,
            isCatchAll: input.isCatchAll,
            mxAccepts: input.mxAccepts,
            rawResponse: input.rawResponse,
            provider: input.provider ?? "reacher-stacked",
            checkedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: emailValidations.email,
            set: {
                reachable: input.reachable,
                isDisposable: input.isDisposable,
                isRoleAccount: input.isRoleAccount,
                hasFullInbox: input.hasFullInbox,
                isCatchAll: input.isCatchAll,
                mxAccepts: input.mxAccepts,
                rawResponse: input.rawResponse,
                provider: input.provider ?? "reacher-stacked",
                checkedAt: new Date(),
            },
        });
}
