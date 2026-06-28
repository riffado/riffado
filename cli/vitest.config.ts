import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // Smoke tests spawn the bundled CLI via child_process. Vitest 4's
        // default thread pool captures spawned stdio inconsistently inside
        // worker_threads; the forks pool runs each test file in its own
        // child process where spawnSync behaves normally.
        pool: "forks",
    },
});
