import { describe, expect, it } from "vitest";
import {
    applyPullMessage,
    type LayerProgress,
    parsePullLine,
    snapshotProgress,
    splitImageRef,
} from "@/lib/docker/engine";

describe("splitImageRef", () => {
    it("splits repo and tag on the tag colon", () => {
        expect(
            splitImageRef("ghcr.io/etalab-ia/whisperx-openai-api:latest"),
        ).toEqual({
            repo: "ghcr.io/etalab-ia/whisperx-openai-api",
            tag: "latest",
        });
        expect(
            splitImageRef("fedirz/faster-whisper-server:latest-cuda"),
        ).toEqual({ repo: "fedirz/faster-whisper-server", tag: "latest-cuda" });
    });

    it("defaults to latest when no tag is present", () => {
        expect(splitImageRef("postgres")).toEqual({
            repo: "postgres",
            tag: "latest",
        });
    });

    it("does not treat a registry port as a tag", () => {
        expect(splitImageRef("registry.local:5000/team/app")).toEqual({
            repo: "registry.local:5000/team/app",
            tag: "latest",
        });
        expect(splitImageRef("registry.local:5000/team/app:v2")).toEqual({
            repo: "registry.local:5000/team/app",
            tag: "v2",
        });
    });
});

describe("parsePullLine", () => {
    it("parses a valid JSON progress line", () => {
        expect(
            parsePullLine(
                '{"status":"Downloading","id":"abc","progressDetail":{"current":10,"total":100}}',
            ),
        ).toEqual({
            status: "Downloading",
            id: "abc",
            progressDetail: { current: 10, total: 100 },
        });
    });

    it("returns null on non-JSON", () => {
        expect(parsePullLine("not json")).toBeNull();
        expect(parsePullLine("")).toBeNull();
    });
});

describe("applyPullMessage + snapshotProgress", () => {
    it("aggregates download bytes across layers", () => {
        const layers = new Map<string, LayerProgress>();
        applyPullMessage(layers, {
            id: "a",
            status: "Downloading",
            progressDetail: { current: 50, total: 100 },
        });
        applyPullMessage(layers, {
            id: "b",
            status: "Downloading",
            progressDetail: { current: 25, total: 100 },
        });
        expect(snapshotProgress(layers)).toEqual({
            currentBytes: 75,
            totalBytes: 200,
            percent: 38,
        });
    });

    it("pins a layer to 100% on Download complete", () => {
        const layers = new Map<string, LayerProgress>();
        applyPullMessage(layers, {
            id: "a",
            status: "Downloading",
            progressDetail: { current: 30, total: 100 },
        });
        applyPullMessage(layers, { id: "a", status: "Download complete" });
        expect(snapshotProgress(layers)).toEqual({
            currentBytes: 100,
            totalBytes: 100,
            percent: 100,
        });
    });

    it("ignores messages without an id or download total", () => {
        const layers = new Map<string, LayerProgress>();
        applyPullMessage(layers, { status: "Pulling from repo" });
        applyPullMessage(layers, {
            id: "x",
            status: "Pulling fs layer",
            progressDetail: {},
        });
        expect(snapshotProgress(layers)).toEqual({
            currentBytes: 0,
            totalBytes: 0,
            percent: 0,
        });
    });
});
