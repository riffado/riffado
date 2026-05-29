/**
 * Regression test for the Rybbit analytics proxy 404 bug that survived
 * #127 and #144:
 *   https://riffado.com/api/_int/script.js (and every other path under
 *   /api/_int/*) returned 404 in production even though IS_HOSTED +
 *   RYBBIT_HOST + RYBBIT_SITE_ID were set.
 *
 * Root cause: the route folder was named `_int`. In the Next.js App Router,
 * any folder prefixed with `_` is a "private folder" and is silently
 * excluded from the route manifest. The handler files compiled fine and
 * `rybbit-proxy-runtime.test.ts` passed (because that suite imports the
 * route module directly and calls `GET`/`POST` as functions — bypassing
 * the router entirely). The URL just wasn't reachable. Requests fell
 * through to the prerendered App Router 404 page, which is why
 * production responses came back with `x-nextjs-prerender: 1, 1` and
 * `x-nextjs-cache: HIT` instead of the plain text 404 that `gated()` in
 * `src/lib/rybbit/proxy.ts` actually emits.
 *
 * Fix: rename `src/app/api/_int/` -> `src/app/api/int/` and update every
 * caller (component, middleware, tests, docs).
 *
 * This test guards the *class* of bug, not just this specific path: it
 * walks `src/app/` and fails if any folder whose name starts with `_`
 * contains a `route.ts` (or `route.tsx`/`route.js`) descendant. Such a
 * file is unreachable by HTTP and almost certainly a mistake.
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
        // Helpful failure message so the next person hitting this knows
        // exactly why their route is 404'ing.
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

/**
 * Belt and braces: pin the specific path that regressed in production.
 * If someone reintroduces `app/api/_int/` (e.g., via a bad rebase), this
 * fails with an obvious message before deploy.
 */
describe("Rybbit proxy route folder is not `_int`", () => {
    it("uses `src/app/api/int/`, not `src/app/api/_int/`", () => {
        const bad = join(APP_DIR, "api", "_int");
        let exists = false;
        try {
            exists = statSync(bad).isDirectory();
        } catch {
            exists = false;
        }
        expect(
            exists,
            "src/app/api/_int/ exists — App Router treats `_`-prefixed folders as private, so /api/_int/* is unreachable. Rename to src/app/api/int/.",
        ).toBe(false);
    });

    it("`src/app/api/int/script.js/route.ts` exists", () => {
        const route = join(APP_DIR, "api", "int", "script.js", "route.ts");
        let exists = false;
        try {
            exists = statSync(route).isFile();
        } catch {
            exists = false;
        }
        expect(exists).toBe(true);
    });
});
