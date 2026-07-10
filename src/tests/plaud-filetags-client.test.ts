import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";

// Mock env so importing PlaudClient (which transitively imports env via
// the proxy module) doesn't trip the DATABASE_URL/ENCRYPTION_KEY runtime
// checks. WEBSHARE_API_KEY undefined -> plaudFetch takes the direct path.
const mockEnv = vi.hoisted(() => ({
    WEBSHARE_API_KEY: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
    env: mockEnv,
}));

import { AppError, ErrorCode } from "../lib/errors";
import { DEFAULT_PLAUD_API_BASE, PlaudClient } from "../lib/plaud/client";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

function jsonResponse(body: unknown) {
    return {
        ok: true,
        json: () => Promise.resolve(body),
    };
}

describe("PlaudClient filetag methods", () => {
    let client: PlaudClient;
    const bearer = "test-bearer-token";

    beforeEach(() => {
        client = new PlaudClient(bearer);
        mockFetch.mockReset();
        // Queue a 500 for the workspace-token mint so the client falls
        // back to the user token (same setup as plaud.test.ts).
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: () => Promise.resolve({ status: 500, msg: "server error" }),
        });
    });

    describe("listFiletags", () => {
        it("GETs /filetag/ and returns the payload", async () => {
            const payload = {
                status: 0,
                msg: "ok",
                data_filetag_list: [
                    {
                        id: 12,
                        name: "Meetings",
                        icon: "iconfont_folder_meeting",
                        color: "#4c8eff",
                    },
                ],
            };
            mockFetch.mockResolvedValueOnce(jsonResponse(payload));

            const result = await client.listFiletags();

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/filetag/`,
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${bearer}`,
                    }),
                }),
            );
            expect(result).toEqual(payload);
        });
    });

    describe("createFiletag", () => {
        it("POSTs name/icon/color to /filetag/, sending the icon as the wire codepoint", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    status: 0,
                    data_filetag: { id: "42", name: "Meetings" },
                }),
            );

            const result = await client.createFiletag({
                name: "Meetings",
                icon: "iconfont_folder_meeting",
                color: "#4c8eff",
            });

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/filetag/`,
                expect.objectContaining({
                    method: "POST",
                    // The official apps only render codepoints, not the
                    // canonical names the DB stores.
                    body: JSON.stringify({
                        name: "Meetings",
                        icon: "e607",
                        color: "#4c8eff",
                    }),
                }),
            );
            expect(result.data_filetag?.id).toBe("42");
        });

        it("maps Plaud status -2 (duplicate name) to ALREADY_EXISTS 409", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: -2, msg: "duplicate" }),
            );

            const error = await client
                .createFiletag({
                    name: "Meetings",
                    icon: "iconfont_folder_meeting",
                    color: "#4c8eff",
                })
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(AppError);
            expect((error as AppError).code).toBe(ErrorCode.ALREADY_EXISTS);
            expect((error as AppError).statusCode).toBe(409);
        });

        it("maps other non-zero statuses to PLAUD_API_ERROR", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: -7, msg: "nope" }),
            );

            const error = await client
                .createFiletag({
                    name: "Meetings",
                    icon: "iconfont_folder_meeting",
                    color: "#4c8eff",
                })
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(AppError);
            expect((error as AppError).code).toBe(ErrorCode.PLAUD_API_ERROR);
            expect((error as AppError).statusCode).toBe(400);
        });
    });

    describe("updateFiletag", () => {
        it("PATCHes /filetag/{id} with the full body, sending the icon as the wire codepoint", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ status: 0 }));

            await client.updateFiletag("42", {
                name: "Calls",
                color: "#fb5c5c",
                icon: "iconfont_folder_call",
            });

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/filetag/42`,
                expect.objectContaining({
                    method: "PATCH",
                    body: JSON.stringify({
                        name: "Calls",
                        color: "#fb5c5c",
                        icon: "e69c",
                    }),
                }),
            );
        });

        it("maps -2 to ALREADY_EXISTS on rename collisions", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: -2, msg: "duplicate" }),
            );

            await expect(
                client.updateFiletag("42", {
                    name: "Calls",
                    color: "#fb5c5c",
                    icon: "iconfont_folder_call",
                }),
            ).rejects.toMatchObject({ code: ErrorCode.ALREADY_EXISTS });
        });
    });

    describe("deleteFiletag", () => {
        it("DELETEs /filetag/{id}", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ status: 0 }));

            await client.deleteFiletag("42");

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/filetag/42`,
                expect.objectContaining({ method: "DELETE" }),
            );
        });

        it("throws PLAUD_API_ERROR on non-zero status", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: -1, msg: "not found" }),
            );

            await expect(client.deleteFiletag("42")).rejects.toMatchObject({
                code: ErrorCode.PLAUD_API_ERROR,
            });
        });
    });

    describe("updateFileTags", () => {
        it("POSTs the file id list and target tag id", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ status: 0 }));

            await client.updateFileTags(["f1", "f2"], "42");

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/update-tags`,
                expect.objectContaining({
                    method: "POST",
                    body: JSON.stringify({
                        file_id_list: ["f1", "f2"],
                        filetag_id: "42",
                    }),
                }),
            );
        });

        it('sends "" to clear the assignment (Unorganized)', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ status: 0 }));

            await client.updateFileTags(["f1"], "");

            expect(fetch).toHaveBeenCalledWith(
                `${DEFAULT_PLAUD_API_BASE}/file/update-tags`,
                expect.objectContaining({
                    body: JSON.stringify({
                        file_id_list: ["f1"],
                        filetag_id: "",
                    }),
                }),
            );
        });

        it("throws PLAUD_API_ERROR on non-zero status", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: -3, msg: "bad tag" }),
            );

            await expect(
                client.updateFileTags(["f1"], "42"),
            ).rejects.toMatchObject({ code: ErrorCode.PLAUD_API_ERROR });
        });
    });
});
