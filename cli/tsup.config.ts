import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as {
    version: string;
};

export default defineConfig({
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
    define: {
        __CLI_VERSION__: JSON.stringify(pkg.version),
    },
    clean: true,
    sourcemap: false,
    minify: false,
    splitting: false,
    shims: false,
    dts: false,
});
