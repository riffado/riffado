/**
 * Shared mocks for drizzle's fluent query chains, for tests that mock
 * `@/db` with plain `vi.fn()`s. Each helper installs a mockImplementation
 * on the corresponding `db` method; `vi.mock("@/db")` is hoisted, so the
 * `db` imported here is the same mocked instance the code under test sees.
 */
import type { Mock } from "vitest";
import { db } from "@/db";

const CHAIN_METHODS = ["from", "where", "orderBy", "groupBy", "limit", "for"];

/**
 * A drizzle-like fluent chain: every method chains, awaiting the chain at
 * any depth resolves to `result`, and `.returning()` resolves to
 * `returningRows`.
 */
function fluentChain(result: unknown, returningRows: unknown[] = []) {
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) chain[method] = () => chain;
    chain.returning = () => Promise.resolve(returningRows);
    // biome-ignore lint/suspicious/noThenProperty: drizzle fluent chains are thenables; the mock must be awaitable at any depth
    chain.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
}

/**
 * Every `db.select()` call resolves to the next queued result; extra
 * calls resolve to [].
 */
export function queueSelects(results: unknown[][]): void {
    let call = 0;
    (db.select as Mock).mockImplementation(() => {
        const result = call < results.length ? results[call] : [];
        call += 1;
        return fluentChain(result);
    });
}

/**
 * Record every `db.update().set(...)` payload. Awaiting the chain
 * resolves to undefined; whichever update calls `.returning()` gets
 * `returningRows` (default: no rows).
 */
export function captureUpdates(
    returningRows: unknown[] = [],
): Record<string, unknown>[] {
    const updates: Record<string, unknown>[] = [];
    (db.update as Mock).mockImplementation(() => ({
        set: (values: Record<string, unknown>) => {
            updates.push(values);
            return fluentChain(undefined, returningRows);
        },
    }));
    return updates;
}

/** Count `db.delete()` calls; awaiting the chain resolves to undefined. */
export function captureDeletes(): number[] {
    const deletes: number[] = [];
    (db.delete as Mock).mockImplementation(() => {
        deletes.push(deletes.length);
        return fluentChain(undefined);
    });
    return deletes;
}
