import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "node",
        // Never pick up tests from local git worktrees Claude Code creates
        // under .claude/ — they're checkouts of other branches and run with a
        // different (often missing) env, which would fail the suite spuriously.
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.next/**",
            ".claude/**",
        ],
    },
});
