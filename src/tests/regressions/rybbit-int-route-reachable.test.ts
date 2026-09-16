/**
 * Guards a class of App Router bug: any folder under `src/app/` whose
 * name starts with `_` is a private folder and is silently excluded
 * from the route manifest. A `route.ts` inside one of those folders
 * compiles but is unreachable over HTTP.
 *
 * Originally caught when the Rybbit analytics proxy lived at
 * `src/app/api/_int/` and 404'd in production.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = join(process.cwd(), "src", "app");
const ROUTE_FILES = new Set(["route.ts", "route.tsx", "route.js"]);

/**
 * Returns every directory under `root` (inclusive) whose own name starts
 * with `_`. App Router treats these as private folders, so any route
 * file inside them is unreachable.
 */
function findPrivateFolders(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string) {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const name of entries) {
            const full = join(dir, name);
            let s: ReturnType<typeof statSync>;
            try {
                s = statSync(full);
            } catch {
                continue;
            }
            if (!s.isDirectory()) continue;
            if (name.startsWith("_")) out.push(full);
            walk(full);
        }
    }
    walk(root);
    return out;
}

function hasRouteFileDescendant(dir: string): string | null {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return null;
    }
    for (const name of entries) {
        const full = join(dir, name);
        let s: ReturnType<typeof statSync>;
        try {
            s = statSync(full);
        } catch {
            continue;
        }
        if (s.isDirectory()) {
            const nested = hasRouteFileDescendant(full);
            if (nested) return nested;
        } else if (ROUTE_FILES.has(name)) {
            return full;
        }
    }
    return null;
}

describe("App Router private folders never contain route files", () => {
    it("no `_*` folder under src/app/ contains a route.{ts,tsx,js}", () => {
        const offenders: string[] = [];
        for (const dir of findPrivateFolders(APP_DIR)) {
            const route = hasRouteFileDescendant(dir);
            if (route) offenders.push(route);
        }
        expect(
            offenders,
            offenders.length === 0
                ? ""
                : `Route files found under \`_\`-prefixed (private) App Router folders. ` +
                      `These folders are excluded from the route manifest and the URLs are unreachable. ` +
                      `Rename the folder so it does not start with an underscore.\n` +
                      offenders.map((p) => `  - ${p}`).join("\n"),
        ).toEqual([]);
    });
});
