import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/db/schema";

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface TestPostgresDatabase {
    name: string;
    url: string;
    db: TestDatabase;
    sql: ReturnType<typeof postgres>;
    dispose: () => Promise<void>;
}

const LOCAL_DATABASE_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "[::1]",
]);

export function getTestDatabaseUrl(): string | null {
    const value = process.env.TEST_DATABASE_URL?.trim();
    return value ? value : null;
}

function assertSafeAdminUrl(rawUrl: string): void {
    const url = new URL(rawUrl);
    if (
        process.env.ALLOW_REMOTE_TEST_DATABASE_URL !== "true" &&
        !LOCAL_DATABASE_HOSTS.has(url.hostname)
    ) {
        throw new Error(
            "TEST_DATABASE_URL must point at localhost unless ALLOW_REMOTE_TEST_DATABASE_URL=true is set",
        );
    }
}

function databaseUrlFor(adminUrl: string, databaseName: string): string {
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

function makeDatabaseName(label: string): string {
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const suffix = randomBytes(6).toString("hex");
    return `riffado_test_${safeLabel}_${process.pid}_${suffix}`;
}

export async function createMigratedTestDatabase(
    adminUrl: string,
    label: string,
): Promise<TestPostgresDatabase> {
    assertSafeAdminUrl(adminUrl);

    const name = makeDatabaseName(label);
    const admin = postgres(adminUrl, { max: 1 });
    try {
        await admin`create database ${admin(name)}`;
    } finally {
        await admin.end();
    }

    const url = databaseUrlFor(adminUrl, name);
    const client = postgres(url, { max: 20 });
    const db = drizzle(client, { schema });

    const dispose = async () => {
        try {
            await client.end({ timeout: 5 });
        } finally {
            const dropAdmin = postgres(adminUrl, { max: 1 });
            try {
                await dropAdmin`drop database if exists ${dropAdmin(name)} with (force)`;
            } finally {
                await dropAdmin.end();
            }
        }
    };

    try {
        await migrate(db, { migrationsFolder: "./src/db/migrations" });
    } catch (error) {
        await dispose();
        throw error;
    }

    return {
        name,
        url,
        db,
        sql: client,
        dispose,
    };
}
