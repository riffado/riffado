import { eq } from "drizzle-orm";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { foundingMemberReservations, users } from "@/db/schema";
import {
    createMigratedTestDatabase,
    getTestDatabaseUrl,
    type TestPostgresDatabase,
} from "@/tests/integration/postgres";

const { dbProxy, dbRef } = vi.hoisted(() => {
    const ref: { current: Record<PropertyKey, unknown> | null } = {
        current: null,
    };
    const proxy = new Proxy(
        {},
        {
            get: (_target, property: string | symbol) => {
                const current = ref.current;
                if (!current) {
                    throw new Error("test database was not initialized");
                }
                const value = current[property];
                return typeof value === "function"
                    ? value.bind(current)
                    : value;
            },
        },
    );
    return { dbProxy: proxy, dbRef: ref };
});

vi.mock("@/db", () => ({ db: dbProxy }));

import {
    consumeFoundingMemberReservation,
    createFoundingMemberReservation,
    deleteUser,
    forfeitFoundingMember,
    getFoundingMemberAvailability,
    getFoundingMemberOrdinal,
} from "@/db/queries/billing";

const testDatabaseUrl = getTestDatabaseUrl();
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase(
    "founding member reservations PostgreSQL integration",
    () => {
        let database: TestPostgresDatabase | null = null;

        beforeAll(async () => {
            database = await createMigratedTestDatabase(
                testDatabaseUrl ?? "",
                "founding_reservations",
            );
            dbRef.current = database.db as unknown as Record<
                PropertyKey,
                unknown
            >;
        }, 120_000);

        afterAll(async () => {
            dbRef.current = null;
            await database?.dispose();
        }, 30_000);

        beforeEach(async () => {
            if (!database) throw new Error("test database was not initialized");
            await database.db.delete(foundingMemberReservations);
            await database.db.delete(users);
        });

        it("admits exactly the remaining capacity under concurrent reservations", async () => {
            if (!database) throw new Error("test database was not initialized");

            const now = new Date("2026-07-01T00:00:00.000Z");
            const expiresAt = new Date("2026-07-01T00:35:00.000Z");
            const userIds = [
                "reserve-u1",
                "reserve-u2",
                "reserve-u3",
                "reserve-u4",
            ];
            await database.db.insert(users).values(
                userIds.map((id) => ({
                    id,
                    email: `${id}@example.test`,
                })),
            );

            const results = await Promise.all(
                userIds.map((userId) =>
                    createFoundingMemberReservation({
                        userId,
                        capacity: 3,
                        stripePriceId: "price_found",
                        now,
                        expiresAt,
                    }),
                ),
            );

            const successfulUserIds = results.flatMap((result, index) =>
                result ? [userIds[index]] : [],
            );
            expect(successfulUserIds).toHaveLength(3);
            expect(results.filter((result) => result === null)).toHaveLength(1);

            const persisted = await database.db
                .select()
                .from(foundingMemberReservations);
            expect(persisted).toHaveLength(3);
            expect(new Set(persisted.map((row) => row.userId))).toEqual(
                new Set(successfulUserIds),
            );
            expect(persisted.every((row) => row.status === "reserved")).toBe(
                true,
            );
        });

        it("preserves a legacy claim when founding pricing is forfeited", async () => {
            if (!database) throw new Error("test database was not initialized");

            const legacyPaidAt = new Date("2026-06-01T00:00:00.000Z");
            await database.db.insert(users).values([
                {
                    id: "legacy-founder",
                    email: "legacy-founder@example.test",
                    foundingMember: true,
                    everPaidAt: legacyPaidAt,
                },
                {
                    id: "new-customer",
                    email: "new-customer@example.test",
                },
            ]);

            await expect(
                getFoundingMemberAvailability(1),
            ).resolves.toMatchObject({ claimed: 1, remaining: 0 });

            await forfeitFoundingMember("legacy-founder");

            const [legacyFounder] = await database.db
                .select({
                    foundingMember: users.foundingMember,
                    foundingMemberClaimedAt: users.foundingMemberClaimedAt,
                })
                .from(users)
                .where(eq(users.id, "legacy-founder"))
                .limit(1);
            expect(legacyFounder).toEqual({
                foundingMember: false,
                foundingMemberClaimedAt: legacyPaidAt,
            });
            await expect(
                getFoundingMemberAvailability(1),
            ).resolves.toMatchObject({ claimed: 1, remaining: 0 });

            await deleteUser("legacy-founder");

            const [preservedClaim] = await database.db
                .select()
                .from(foundingMemberReservations)
                .where(eq(foundingMemberReservations.status, "consumed"))
                .limit(1);
            expect(preservedClaim).toMatchObject({
                status: "consumed",
                stripePriceId: "legacy-founding-claim",
                userId: null,
            });
            await expect(
                getFoundingMemberAvailability(1),
            ).resolves.toMatchObject({ claimed: 1, remaining: 0 });

            await expect(
                createFoundingMemberReservation({
                    userId: "new-customer",
                    capacity: 1,
                    stripePriceId: "price_found",
                    now: new Date("2026-07-01T00:00:00.000Z"),
                    expiresAt: new Date("2026-07-01T00:35:00.000Z"),
                }),
            ).resolves.toBeNull();
        });

        it("consumes one reservation idempotently under concurrent payment events", async () => {
            if (!database) throw new Error("test database was not initialized");

            const userId = "consume-u1";
            const paidAt = new Date("2026-07-01T00:05:00.000Z");
            await database.db.insert(users).values({
                id: userId,
                email: "consume-u1@example.test",
            });
            const reservation = await createFoundingMemberReservation({
                userId,
                capacity: 100,
                stripePriceId: "price_found",
                now: new Date("2026-07-01T00:00:00.000Z"),
                expiresAt: new Date("2026-07-01T00:35:00.000Z"),
            });
            expect(reservation).not.toBeNull();

            const outcomes = await Promise.all(
                Array.from({ length: 5 }, () =>
                    consumeFoundingMemberReservation({
                        reservationId: reservation?.id ?? null,
                        userId,
                        stripePriceId: "price_found",
                        paidAt,
                    }),
                ),
            );

            expect(outcomes).toEqual([true, true, true, true, true]);

            const [persistedReservation] = await database.db
                .select()
                .from(foundingMemberReservations)
                .where(eq(foundingMemberReservations.id, reservation?.id ?? ""))
                .limit(1);
            expect(persistedReservation.status).toBe("consumed");
            expect(persistedReservation.consumedAt?.toISOString()).toBe(
                paidAt.toISOString(),
            );

            const [persistedUser] = await database.db
                .select({
                    foundingMember: users.foundingMember,
                    foundingMemberClaimedAt: users.foundingMemberClaimedAt,
                })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            expect(persistedUser).toEqual({
                foundingMember: true,
                foundingMemberClaimedAt: paidAt,
            });

            await database.db.delete(users).where(eq(users.id, userId));

            const [preservedClaim] = await database.db
                .select()
                .from(foundingMemberReservations)
                .where(eq(foundingMemberReservations.id, reservation?.id ?? ""))
                .limit(1);
            expect(preservedClaim).toMatchObject({
                status: "consumed",
                userId: null,
            });
            await expect(
                getFoundingMemberAvailability(100),
            ).resolves.toMatchObject({
                claimed: 1,
            });
        });

        it("keeps a later founder's rank stable after an earlier founder's account is deleted", async () => {
            if (!database) throw new Error("test database was not initialized");

            await database.db.insert(users).values([
                {
                    id: "founder-early",
                    email: "founder-early@example.test",
                    foundingMember: true,
                    foundingMemberClaimedAt: new Date(
                        "2026-06-01T00:00:00.000Z",
                    ),
                },
                {
                    id: "founder-late",
                    email: "founder-late@example.test",
                    foundingMember: true,
                    foundingMemberClaimedAt: new Date(
                        "2026-06-15T00:00:00.000Z",
                    ),
                },
            ]);

            await expect(
                getFoundingMemberOrdinal("founder-early"),
            ).resolves.toBe(1);
            await expect(
                getFoundingMemberOrdinal("founder-late"),
            ).resolves.toBe(2);

            // Deleting the earlier founder removes their `users` row, but
            // `deleteUser` preserves a `consumed` reservation for their
            // claim. The later founder must still rank #2, not #1.
            await deleteUser("founder-early");

            await expect(
                getFoundingMemberOrdinal("founder-late"),
            ).resolves.toBe(2);
            await expect(
                getFoundingMemberOrdinal("founder-early"),
            ).resolves.toBeNull();
        });
    },
);
