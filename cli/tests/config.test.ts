import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    ConfigNotFoundError,
    clearConfig,
    configPath,
    loadConfig,
    loadConfigOrNull,
    maskApiKey,
    saveConfig,
} from "../src/lib/config.js";

let tmpHome: string;
let originalXdg: string | undefined;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "riffado-cli-config-"));
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpHome;
});

afterEach(() => {
    if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
    } else {
        process.env.XDG_CONFIG_HOME = originalXdg;
    }
    rmSync(tmpHome, { recursive: true, force: true });
});

describe("config", () => {
    it("round-trips server + apiKey", () => {
        saveConfig({
            server: "https://riffado.com",
            apiKey: "op_abcd1234",
        });
        const loaded = loadConfig();
        expect(loaded.server).toBe("https://riffado.com");
        expect(loaded.apiKey).toBe("op_abcd1234");
        expect(loaded.apiKeyId).toBeUndefined();
    });

    it("persists optional apiKeyId", () => {
        saveConfig({
            server: "https://riffado.com",
            apiKey: "op_abcd1234",
            apiKeyId: "ak_123",
        });
        expect(loadConfig().apiKeyId).toBe("ak_123");
    });

    it("throws ConfigNotFoundError when no config exists", () => {
        expect(() => loadConfig()).toThrow(ConfigNotFoundError);
        expect(loadConfigOrNull()).toBeNull();
    });

    it("writes the config file with 0600 perms (POSIX)", () => {
        if (process.platform === "win32") return;
        saveConfig({
            server: "https://riffado.com",
            apiKey: "op_abcd1234",
        });
        const mode = statSync(configPath()).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it("clearConfig removes the file and returns true; false when absent", () => {
        expect(clearConfig()).toBe(false);
        saveConfig({
            server: "https://riffado.com",
            apiKey: "op_abcd1234",
        });
        expect(clearConfig()).toBe(true);
        expect(loadConfigOrNull()).toBeNull();
    });
});

describe("maskApiKey", () => {
    it("masks long keys preserving prefix and suffix", () => {
        expect(maskApiKey("op_abcdef1234567890wxyz")).toBe("op_abcd…wxyz");
    });

    it("returns a short placeholder for tiny inputs", () => {
        expect(maskApiKey("op_ab")).toBe("op_a…");
    });
});
