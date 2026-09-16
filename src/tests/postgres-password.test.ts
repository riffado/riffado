import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { usesDefaultPostgresPassword } from "@/lib/postgres-password";

const ROOT = process.cwd();

describe("usesDefaultPostgresPassword", () => {
    it("detects the known compose default", () => {
        expect(
            usesDefaultPostgresPassword(
                "postgresql://postgres:postgres@db:5432/riffado",
            ),
        ).toBe(true);
        expect(
            usesDefaultPostgresPassword(
                "postgres://postgres:postgres@localhost:5432/riffado?sslmode=disable",
            ),
        ).toBe(true);
    });

    it("accepts a non-default password", () => {
        expect(
            usesDefaultPostgresPassword(
                "postgresql://postgres:s3cret@db:5432/riffado",
            ),
        ).toBe(false);
    });

    it("returns false when the URL is missing or unparseable", () => {
        expect(usesDefaultPostgresPassword(undefined)).toBe(false);
        expect(usesDefaultPostgresPassword("")).toBe(false);
        expect(usesDefaultPostgresPassword("not-a-url")).toBe(false);
    });
});

describe("self-host compose and installer", () => {
    it("binds the bundled Postgres port to localhost", () => {
        const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
        expect(compose).toContain("127.0.0.1:5432:5432");
        expect(compose).not.toMatch(/^\s+-\s+"5432:5432"/m);
    });

    it("generates POSTGRES_PASSWORD in the one-line installer", () => {
        const script = readFileSync(
            join(ROOT, "scripts", "install.sh"),
            "utf8",
        );
        expect(script).toContain('POSTGRES_PASSWORD="$(openssl rand -hex 24)"');
        expect(script).toContain(
            'patch_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"',
        );
    });
});
