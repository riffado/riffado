/**
 * Regression: Plaud "Account migrated to 4.0".
 *
 * Migrated accounts get `{ status: -1800907, msg: "Account migrated to 4.0.
 * Please update and reinitialize." }` (HTTP 200, no `data_file_list`) from
 * every legacy `/file/...` endpoint. Sync used to crash with
 * "undefined is not an object (evaluating 'n.length')" and silently import
 * nothing. The client must switch to `/file-app/v4/...`, keep legacy ids
 * stable (`of_<id>` -> `<id>`) so existing rows are not duplicated, and
 * download audio from the v4 detail's presigned object URL.
 */
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

vi.mock("@/lib/env", () => ({
    env: { WEBSHARE_API_KEY: undefined },
}));

import { gzipSync } from "node:zlib";
import { PlaudClient } from "../../lib/plaud/client";
import {
    parseSummary,
    parseTranscript,
    selectContentItems,
} from "../../lib/plaud/content";
import {
    applyPlaudV4Detail,
    isPlaudV4MigratedResponse,
    mapPlaudV4Item,
    plaudV4DetailToLegacy,
    plaudV4FileIdToRecordingId,
    recordingIdToPlaudV4FileId,
    selectPlaudV4Audio,
    timeZoneOffsetMinutes,
} from "../../lib/plaud/v4";

const API = "https://api-euc1.plaud.ai";
const MIGRATED = {
    status: -1800907,
    msg: "Account migrated to 4.0. Please update and reinitialize.",
};
const NEW_START = Date.UTC(2026, 9, 28, 10, 43, 10); // 11:43:10 Paris

const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });

const originalFetch = global.fetch;
const calls: { url: string; auth?: string; method: string; body?: string }[] =
    [];
let nodeVersion = 10;
let renameConflictsLeft = 0;
// Per-recording folder (what the Plaud library lists).
let folderName = "2026-10-28 11:43:10";
let parentItemsInRename = true;
let folderConflictsLeft = 0;
let childrenFolderName: string | undefined;
let oldEditedVersion: number | undefined;
let transcriptUrlInDetail = true;
// AUDIO_TRANSCODED object in the f_new detail: with a presigned URL, with a
// content id only, or absent.
let transcodedAudio: "url" | "id" | undefined;

function installPlaudMock() {
    calls.length = 0;
    nodeVersion = 10;
    renameConflictsLeft = 0;
    folderName = "2026-10-28 11:43:10";
    parentItemsInRename = true;
    folderConflictsLeft = 0;
    childrenFolderName = undefined;
    oldEditedVersion = undefined;
    transcriptUrlInDetail = true;
    transcodedAudio = undefined;
    global.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const headers = (init?.headers ?? {}) as Record<string, string>;
            calls.push({
                url,
                auth: headers.Authorization,
                method: init?.method ?? "GET",
                body: typeof init?.body === "string" ? init.body : undefined,
            });
            const u = new URL(url);

            if (u.pathname === "/user-app/auth/workspace/token/ws_test") {
                return json({ status: 0, data: { workspace_token: "wt-123" } });
            }
            if (u.pathname === "/file/f_new" && init?.method === "PATCH") {
                return json(MIGRATED);
            }
            if (u.pathname === "/file-app/v4/nodes/rename/n_file") {
                if (renameConflictsLeft > 0) {
                    renameConflictsLeft--;
                    nodeVersion++;
                    return json({
                        status: -1800313,
                        msg: "node version conflict",
                    });
                }
                nodeVersion++;
                return json({
                    status: 0,
                    data: {
                        items: [],
                        parent_items: parentItemsInRename
                            ? [
                                  {
                                      node_id: "n_folder",
                                      name: folderName,
                                      version_ms: 77,
                                  },
                              ]
                            : [],
                    },
                });
            }
            if (u.pathname === "/file-app/v4/nodes/rename/n_folder") {
                if (folderConflictsLeft > 0) {
                    folderConflictsLeft--;
                    return json({
                        status: -1800313,
                        msg: "node version conflict",
                    });
                }
                return json({ status: 0, data: { items: [] } });
            }
            if (u.pathname === "/file-app/v4/files/content/url") {
                const { content_ids } = JSON.parse(String(init?.body));
                return json({
                    status: 0,
                    data: {
                        url_map: Object.fromEntries(
                            (content_ids as string[]).map((id) => [
                                id,
                                id === "c_tc"
                                    ? "https://bucket.s3.amazonaws.com/a.mp3?sig=resolved"
                                    : "https://bucket.s3.amazonaws.com/trans_result.json.gz?sig=resolved",
                            ]),
                        ),
                    },
                });
            }
            if (u.pathname === "/file-app/v4/folders/children") {
                return json({
                    status: 0,
                    data: {
                        items: [
                            { node_id: "n_other", name: "x", version_ms: 1 },
                            {
                                node_id: "n_folder",
                                name: childrenFolderName ?? folderName,
                                version_ms: 88,
                            },
                        ],
                        next_cursor: null,
                    },
                });
            }
            if (u.pathname === "/file/simple/web") return json(MIGRATED);
            if (u.pathname.startsWith("/file/temp-url/")) return json(MIGRATED);
            if (u.pathname === "/file-app/v4/recordings/all") {
                if (!u.searchParams.get("cursor")) {
                    return json({
                        status: 0,
                        data: {
                            items: [
                                {
                                    file_id: "f_new",
                                    name: "2026-10-28 11:43:10",
                                    duration_ms: 1641620,
                                    created_at_show_ms: NEW_START,
                                    version_ms: 1793196964483,
                                },
                                {
                                    file_id:
                                        "of_34f465e07b50f0a01cb76302d6c6eaa7",
                                    name: "Suivi Documents",
                                    duration_ms: 308000,
                                    created_at_show_ms: 1792745124000,
                                    version_ms: 1792745560432,
                                },
                            ],
                            next_cursor: "page-2",
                        },
                    });
                }
                return json({
                    status: 0,
                    data: {
                        items: [
                            {
                                file_id: "of_ed242f55f01779b404852ebb44e641d5",
                                name: "Tarification",
                                duration_ms: 1862000,
                                created_at_show_ms: 1792683867000,
                                version_ms: oldEditedVersion ?? 1792683867616,
                            },
                        ],
                        next_cursor: null,
                    },
                });
            }
            if (u.pathname === "/file-app/v4/files/detail/f_new") {
                return json({
                    status: 0,
                    data: {
                        node: {
                            node_id: "n_file",
                            name: "2026-10-28 11:43:10",
                            version_ms: nodeVersion,
                            folder: {
                                folder_id: "n_folder",
                                name: folderName,
                            },
                            breadcrumbs: [
                                { node_id: "n_recordings" },
                                { node_id: "n_folder" },
                                { node_id: "n_file" },
                            ],
                        },
                        meta: {
                            file_id: "f_new",
                            duration: 1641620,
                            size_bytes: 0,
                            timezone_iana: "Europe/Paris",
                            start_time: NEW_START,
                            serial_number: "8810B50270995044",
                        },
                        objects: [
                            {
                                object_type: "AUDIO",
                                content_id: "c_1",
                                content_url:
                                    "https://bucket.s3.amazonaws.com/a.ogg?sig=1",
                                mime_type: "audio/ogg",
                                object_size: 7004672,
                            },
                            ...(transcodedAudio
                                ? [
                                      {
                                          object_type: "AUDIO_TRANSCODED",
                                          content_id: "c_tc",
                                          content_url:
                                              transcodedAudio === "url"
                                                  ? "https://bucket.s3.amazonaws.com/a.mp3?sig=tc"
                                                  : null,
                                          mime_type: "audio/mpeg",
                                          object_size: 7340032,
                                      },
                                  ]
                                : []),
                            {
                                object_type: "OUTLINE",
                                content_id: "c_outline",
                                content_url:
                                    "https://bucket.s3.amazonaws.com/outline.json.gz",
                                task_status: null,
                            },
                            {
                                object_type: "TRANSCRIPT",
                                content_id: "c_trans",
                                content_url: transcriptUrlInDetail
                                    ? "https://bucket.s3.amazonaws.com/trans_result.json.gz?sig=2"
                                    : null,
                                mime_type: "text/vnd.plaud.transcript+json",
                                task_status: 1,
                            },
                            {
                                object_type: "SUMMARY",
                                content_id: "c_sum",
                                content_url:
                                    "https://bucket.s3.amazonaws.com/ai_content.md.gz?sig=3",
                                mime_type: "text/vnd.plaud.summary+markdown",
                                task_status: 1,
                            },
                        ],
                    },
                });
            }
            if (u.pathname === "/file/detail/f_new") return json(MIGRATED);
            if (u.host === "bucket.s3.amazonaws.com") {
                if (u.pathname === "/trans_result.json.gz") {
                    return new Response(
                        gzipSync(
                            JSON.stringify([
                                {
                                    start_time: 1390,
                                    end_time: 9910,
                                    content: "Bonjour.",
                                    speaker: "Speaker 1",
                                    original_speaker: "Speaker 1",
                                    segment_uid: "x_1",
                                },
                                {
                                    start_time: 9910,
                                    end_time: 12000,
                                    content: "Salut.",
                                    speaker: "Pierre",
                                    original_speaker: "Speaker 2",
                                    segment_uid: "x_2",
                                },
                            ]),
                        ),
                        { status: 200 },
                    );
                }
                if (u.pathname === "/ai_content.md.gz") {
                    return new Response("## 1. Points clés\nTexte.", {
                        status: 200,
                    });
                }
                if (u.pathname === "/a.mp3") {
                    return new Response(
                        new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]),
                        { status: 200 },
                    );
                }
                return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
                    status: 200,
                });
            }
            return new Response("not found", { status: 404 });
        },
    ) as typeof global.fetch;
}

beforeAll(() => installPlaudMock());
beforeEach(() => installPlaudMock());
afterAll(() => {
    global.fetch = originalFetch;
});

describe("Plaud 4.0 helpers", () => {
    it("detects the migrated envelope", () => {
        expect(isPlaudV4MigratedResponse(MIGRATED)).toBe(true);
        expect(isPlaudV4MigratedResponse({ status: 0, msg: "success" })).toBe(
            false,
        );
        expect(isPlaudV4MigratedResponse(null)).toBe(false);
    });

    it("maps v4 file ids to stable recording ids and back", () => {
        expect(plaudV4FileIdToRecordingId("of_abc")).toBe("abc");
        expect(plaudV4FileIdToRecordingId("f_new")).toBe("f_new");
        expect(recordingIdToPlaudV4FileId("abc")).toBe("of_abc");
        expect(recordingIdToPlaudV4FileId("f_new")).toBe("f_new");
    });

    it("computes IANA offsets across DST", () => {
        expect(timeZoneOffsetMinutes("Europe/Paris", NEW_START)).toBe(60);
        expect(
            timeZoneOffsetMinutes("Europe/Paris", Date.UTC(2026, 6, 1)),
        ).toBe(120);
        expect(timeZoneOffsetMinutes(undefined, NEW_START)).toBeUndefined();
        expect(timeZoneOffsetMinutes("Not/AZone", NEW_START)).toBeUndefined();
    });

    it("hydrates device, size and timezone from the v4 detail", () => {
        const listed = mapPlaudV4Item({
            file_id: "f_new",
            name: "x",
            duration_ms: 1000,
            created_at_show_ms: NEW_START,
            version_ms: 5,
        });
        expect(listed.source).toBe("v4");
        expect(listed.is_trans).toBe(false);
        const hydrated = applyPlaudV4Detail(listed, {
            meta: {
                serial_number: "SN1",
                timezone_iana: "Europe/Paris",
                start_time: NEW_START,
                duration: 2000,
            },
            objects: [{ object_type: "AUDIO", object_size: 42 }],
        });
        expect(hydrated).toMatchObject({
            serial_number: "SN1",
            filesize: 42,
            duration: 2000,
            end_time: NEW_START + 2000,
            timezone: 1,
            zonemins: 0,
        });
    });

    it("prefers the transcoded audio object and reports its size", () => {
        const detail = {
            meta: { size_bytes: 51200 },
            objects: [
                {
                    object_type: "AUDIO",
                    content_url: "raw",
                    object_size: 51200,
                },
                {
                    object_type: "AUDIO_TRANSCODED",
                    content_url: "mp3",
                    object_size: 51777,
                },
            ],
        };
        expect(selectPlaudV4Audio(detail)?.content_url).toBe("mp3");
        expect(
            applyPlaudV4Detail(mapPlaudV4Item({ file_id: "f_x" }), detail)
                .filesize,
        ).toBe(51777);
    });

    it("falls back to the recorder upload when no transcoded audio is downloadable", () => {
        expect(
            selectPlaudV4Audio({
                objects: [
                    { object_type: "AUDIO_TRANSCODED", object_size: 9 },
                    { object_type: "AUDIO", content_id: "c_raw" },
                ],
            })?.content_id,
        ).toBe("c_raw");
        expect(
            selectPlaudV4Audio({
                objects: [{ object_type: "AUDIO", content_url: "raw" }],
            })?.content_url,
        ).toBe("raw");
    });

    it("does not report the upload size for a transcoded file of unknown size", () => {
        const hydrated = applyPlaudV4Detail(
            mapPlaudV4Item({ file_id: "f_x" }),
            {
                meta: { size_bytes: 51200 },
                objects: [
                    { object_type: "AUDIO", content_url: "raw" },
                    { object_type: "AUDIO_TRANSCODED", content_url: "mp3" },
                ],
            },
        );
        expect(hydrated.filesize).toBe(0);
    });
});

describe("PlaudClient on a 4.0-migrated account", () => {
    it("falls back to /file-app/v4/recordings/all with skip/limit paging", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");

        const page1 = await client.getRecordings(0, 2, 0, "edit_time", true);
        expect(client.usingPlaudV4).toBe(true);
        expect(page1.data_file_total).toBe(3);
        expect(page1.data_file_list.map((r) => r.id)).toEqual([
            "f_new",
            "34f465e07b50f0a01cb76302d6c6eaa7",
        ]);
        expect(page1.data_file_list[1]).toMatchObject({
            version_ms: 1792745560432,
            duration: 308000,
        });

        const page2 = await client.getRecordings(2, 2, 0, "edit_time", true);
        expect(page2.data_file_list.map((r) => r.id)).toEqual([
            "ed242f55f01779b404852ebb44e641d5",
        ]);

        // v4 calls carry the workspace token; the listing is fetched once.
        const v4Calls = calls.filter((c) =>
            c.url.includes("/file-app/v4/recordings/all"),
        );
        expect(v4Calls).toHaveLength(2);
        expect(v4Calls.every((c) => c.auth === "Bearer wt-123")).toBe(true);
        // Legacy list is tried only once.
        expect(
            calls.filter((c) => c.url.includes("/file/simple/web")),
        ).toHaveLength(1);
    });

    it("hydrates and downloads audio from the v4 presigned object URL", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        const { data_file_list } = await client.getRecordings(0, 1, 0);
        const rec = await client.hydrateRecording(data_file_list[0]);
        expect(rec).toMatchObject({
            serial_number: "8810B50270995044",
            filesize: 7004672,
            timezone: 1,
        });

        const audio = await client.downloadRecording(rec.id, false);
        expect(audio.subarray(0, 4).toString("latin1")).toBe("OggS");
        // Detail fetched once (cached between hydrate and download), no
        // legacy temp-url call once v4 mode is known.
        expect(
            calls.filter((c) => c.url.includes("/files/detail/f_new")),
        ).toHaveLength(1);
        expect(calls.some((c) => c.url.includes("/file/temp-url/"))).toBe(
            false,
        );
    });

    it("downloads the transcoded MP3 instead of the recorder upload", async () => {
        transcodedAudio = "url";
        const client = new PlaudClient("ut-1", API, "ws_test");
        const listed = (await client.getRecordings(0, 1, 0)).data_file_list[0];
        const rec = await client.hydrateRecording(listed);
        expect(rec.filesize).toBe(7340032);

        const audio = await client.downloadRecording(rec.id, false);
        expect(audio.subarray(0, 3).toString("latin1")).toBe("ID3");
        expect(calls.some((c) => c.url.includes("/a.ogg"))).toBe(false);
    });

    it("resolves a transcoded audio content id that has no presigned URL", async () => {
        transcodedAudio = "id";
        const client = new PlaudClient("ut-1", API, "ws_test");
        const audio = await client.downloadRecording("f_new", false);
        expect(audio.subarray(0, 3).toString("latin1")).toBe("ID3");
        const resolve = calls.filter((c) =>
            c.url.includes("/files/content/url"),
        );
        expect(resolve).toHaveLength(1);
        expect(JSON.parse(resolve[0].body ?? "{}")).toEqual({
            content_ids: ["c_tc"],
        });
    });

    it("switches to v4 when the legacy temp-url reports the migration", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        const audio = await client.downloadRecording("f_new", false);
        expect(audio.subarray(0, 4).toString("latin1")).toBe("OggS");
        expect(client.usingPlaudV4).toBe(true);
    });

    it("serves pages most recently edited first, like the legacy edit_time sort", async () => {
        oldEditedVersion = 1793300000000;
        const client = new PlaudClient("ut-1", API, "ws_test");
        const page = await client.getRecordings(0, 3, 0, "edit_time", true);
        expect(page.data_file_list.map((r) => r.id)).toEqual([
            "ed242f55f01779b404852ebb44e641d5",
            "f_new",
            "34f465e07b50f0a01cb76302d6c6eaa7",
        ]);
        const byStart = await client.getRecordings(
            0,
            3,
            0,
            "start_time",
            false,
        );
        expect(byStart.data_file_list.map((r) => r.id)).toEqual([
            "ed242f55f01779b404852ebb44e641d5",
            "34f465e07b50f0a01cb76302d6c6eaa7",
            "f_new",
        ]);
    });

    it("sorts create_time requests by creation, not by edit time", async () => {
        oldEditedVersion = 1793300000000;
        const client = new PlaudClient("ut-1", API, "ws_test");
        const page = await client.getRecordings(0, 3, 0, "create_time", true);
        expect(page.data_file_list.map((r) => r.id)).toEqual([
            "f_new",
            "34f465e07b50f0a01cb76302d6c6eaa7",
            "ed242f55f01779b404852ebb44e641d5",
        ]);
    });

    it("leaves legacy recordings untouched in hydrateRecording", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        const legacy = {
            ...mapPlaudV4Item({ file_id: "of_x" }),
            source: undefined,
        };
        expect(await client.hydrateRecording(legacy)).toBe(legacy);
    });
});

describe("Plaud-native content on a 4.0-migrated account", () => {
    it("flags ready transcript / summary objects only", () => {
        const listed = mapPlaudV4Item({ file_id: "f_x" });
        const ready = applyPlaudV4Detail(listed, {
            objects: [
                { object_type: "TRANSCRIPT", task_status: 1, content_url: "u" },
                { object_type: "SUMMARY", task_status: 0, content_url: "u" },
            ],
        });
        expect(ready.is_trans).toBe(true);
        expect(ready.is_summary).toBe(false);
    });

    it("maps v4 objects onto the legacy content manifest", () => {
        const legacy = plaudV4DetailToLegacy({
            meta: { file_id: "f_x" },
            objects: [
                { object_type: "AUDIO", content_url: "a" },
                { object_type: "OUTLINE", content_url: "o" },
                {
                    object_type: "TRANSCRIPT",
                    content_id: "c_t",
                    content_url: "t",
                    task_status: 1,
                },
                {
                    object_type: "SUMMARY",
                    content_id: "c_s",
                    content_url: "s",
                    task_status: 1,
                },
            ],
        });
        expect(legacy.data?.content_list).toEqual([
            {
                data_id: "c_t",
                data_type: "transaction",
                task_status: 1,
                data_link: "t",
            },
            {
                data_id: "c_s",
                data_type: "auto_sum_note",
                task_status: 1,
                data_link: "s",
            },
        ]);
        const { transcript, summary } = selectContentItems(legacy);
        expect(transcript?.data_link).toBe("t");
        expect(summary?.data_link).toBe("s");
    });

    it("resolves content ids that come without a presigned URL", async () => {
        transcriptUrlInDetail = false;
        const client = new PlaudClient("ut-1", API, "ws_test");
        const listed = (await client.getRecordings(0, 1, 0)).data_file_list[0];
        const rec = await client.hydrateRecording(listed);
        expect(rec.is_trans).toBe(true);
        const { transcript } = selectContentItems(
            await client.getFileDetail(rec.id),
        );
        expect(transcript?.data_link).toContain("sig=resolved");
        const resolve = calls.filter((c) =>
            c.url.includes("/files/content/url"),
        );
        expect(resolve).toHaveLength(1);
        expect(JSON.parse(resolve[0].body ?? "{}")).toEqual({
            content_ids: ["c_trans"],
        });
    });

    it("serves the import pipeline from the v4 detail", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        const listed = (await client.getRecordings(0, 1, 0)).data_file_list[0];
        const rec = await client.hydrateRecording(listed);
        expect(rec.is_trans).toBe(true);
        expect(rec.is_summary).toBe(true);

        const detail = await client.getFileDetail(rec.id);
        const { transcript, summary } = selectContentItems(detail);
        const parsed = parseTranscript(
            await client.fetchContentLink(transcript?.data_link ?? ""),
        );
        expect(parsed.text).toBe("Speaker 1: Bonjour.\nPierre: Salut.");
        const sum = parseSummary(
            await client.fetchContentLink(summary?.data_link ?? ""),
        );
        expect(sum.summary).toBe("## 1. Points clés\nTexte.");
        expect(
            calls.filter((c) => c.url.includes("/files/detail/f_new")),
        ).toHaveLength(1);
    });
});

describe("PlaudClient title sync on a 4.0-migrated account", () => {
    it("renames the v4 node with origin_version", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        const res = await client.updateFilename("f_new", "Point équipe");
        expect(res.status).toBe(0);
        const rename = calls.filter((c) =>
            c.url.includes("/file-app/v4/nodes/rename/n_file"),
        );
        expect(rename).toHaveLength(1);
        expect(rename[0].method).toBe("PATCH");
        expect(JSON.parse(rename[0].body ?? "{}")).toEqual({
            name: "Point équipe",
            origin_version: 10,
        });
    });

    it("refetches the node version and retries once on conflict", async () => {
        renameConflictsLeft = 1;
        const client = new PlaudClient("ut-1", API, "ws_test");
        const res = await client.updateFilename("f_new", "Titre");
        expect(res.status).toBe(0);
        const bodies = calls
            .filter((c) => c.url.includes("/nodes/rename/n_file"))
            .map((c) => JSON.parse(c.body ?? "{}").origin_version);
        expect(bodies).toEqual([10, 11]);
    });

    it("renames the auto-named recording folder with its version from the rename response", async () => {
        const client = new PlaudClient("ut-1", API, "ws_test");
        await client.updateFilename("f_new", "Point équipe");
        const folder = calls.filter((c) =>
            c.url.includes("/nodes/rename/n_folder"),
        );
        expect(folder).toHaveLength(1);
        expect(JSON.parse(folder[0].body ?? "{}")).toEqual({
            name: "Point équipe",
            origin_version: 77,
        });
        expect(calls.some((c) => c.url.includes("/folders/children"))).toBe(
            false,
        );
    });

    it("looks the folder version up when the rename response lacks it", async () => {
        parentItemsInRename = false;
        const client = new PlaudClient("ut-1", API, "ws_test");
        await client.updateFilename("f_new", "Titre");
        const children = calls.find((c) => c.url.includes("/folders/children"));
        expect(
            new URL(children?.url ?? "http://x").searchParams.get("node_id"),
        ).toBe("n_recordings");
        const folder = calls.find((c) =>
            c.url.includes("/nodes/rename/n_folder"),
        );
        expect(JSON.parse(folder?.body ?? "{}").origin_version).toBe(88);
    });

    it("re-checks the folder name before retrying a conflicted folder rename", async () => {
        folderConflictsLeft = 1;
        childrenFolderName = "Dossier client";
        const client = new PlaudClient("ut-1", API, "ws_test");
        await client.updateFilename("f_new", "Titre");
        expect(
            calls.filter((c) => c.url.includes("/nodes/rename/n_folder")),
        ).toHaveLength(1);
    });

    it("retries a conflicted folder rename with the refreshed version", async () => {
        folderConflictsLeft = 1;
        const client = new PlaudClient("ut-1", API, "ws_test");
        await client.updateFilename("f_new", "Titre");
        const versions = calls
            .filter((c) => c.url.includes("/nodes/rename/n_folder"))
            .map((c) => JSON.parse(c.body ?? "{}").origin_version);
        expect(versions).toEqual([77, 88]);
    });

    it("leaves a custom-named folder alone", async () => {
        folderName = "Dossier client";
        const client = new PlaudClient("ut-1", API, "ws_test");
        await client.updateFilename("f_new", "Titre");
        expect(
            calls.some((c) => c.url.includes("/nodes/rename/n_folder")),
        ).toBe(false);
    });

    it("gives up after a second conflict", async () => {
        renameConflictsLeft = 5;
        const client = new PlaudClient("ut-1", API, "ws_test");
        await expect(client.updateFilename("f_new", "Titre")).rejects.toThrow(
            "version conflict",
        );
    });
});

describe("PlaudClient legacy error surfacing", () => {
    it("throws Plaud's message instead of returning a list-less body", async () => {
        global.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const u = new URL(String(input));
            if (u.pathname.startsWith("/user-app/auth/workspace/token/")) {
                return json({ status: 0, data: { workspace_token: "wt" } });
            }
            return json({ status: -3, msg: "token expired" });
        }) as typeof global.fetch;
        const client = new PlaudClient("ut-1", API, "ws_test");
        await expect(client.getRecordings(0, 10, 0)).rejects.toThrow(
            "token expired",
        );
    });
});
