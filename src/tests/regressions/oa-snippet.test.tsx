/**
 * @vitest-environment jsdom
 *
 * Runtime contract for the hosted Open Analytics snippet: inject only
 * when IS_HOSTED and both OA_TRACKING_KEY and OA_HOST are set; never
 * inject on self-host; strip a trailing slash from the collector.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
    IS_HOSTED: false,
    OA_TRACKING_KEY: undefined as string | undefined,
    OA_HOST: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));
vi.mock("next/script", () => ({
    default: function Script(props: Record<string, unknown>) {
        return <script {...props} />;
    },
}));

import { OpenAnalytics } from "@/components/open-analytics";

afterEach(() => {
    mockEnv.IS_HOSTED = false;
    mockEnv.OA_TRACKING_KEY = undefined;
    mockEnv.OA_HOST = undefined;
    document.body.innerHTML = "";
});

function oaScript() {
    return document.querySelector("script[data-key]");
}

describe("Open Analytics snippet injection", () => {
    it("does not inject on self-host even when key and host are set", () => {
        mockEnv.IS_HOSTED = false;
        mockEnv.OA_TRACKING_KEY = "site_abc123";
        mockEnv.OA_HOST = "https://oa.example.com";
        const { container } = render(<OpenAnalytics />);
        expect(container.querySelector("script")).toBeNull();
    });

    it("does not inject on hosted when only the key is set", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.OA_TRACKING_KEY = "site_abc123";
        render(<OpenAnalytics />);
        expect(oaScript()).toBeNull();
    });

    it("does not inject on hosted when only the host is set", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.OA_HOST = "https://oa.example.com";
        render(<OpenAnalytics />);
        expect(oaScript()).toBeNull();
    });

    it("injects cookieless script when hosted and both vars are set", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.OA_TRACKING_KEY = "site_abc123";
        mockEnv.OA_HOST = "https://oa.example.com";
        render(<OpenAnalytics />);
        const script = oaScript();
        expect(script).not.toBeNull();
        expect(script?.getAttribute("src")).toBe(
            "https://oa.example.com/oa.js",
        );
        expect(script?.getAttribute("data-key")).toBe("site_abc123");
        expect(script?.getAttribute("data-collector")).toBe(
            "https://oa.example.com",
        );
        expect(script?.getAttribute("data-storage")).toBe("none");
    });

    it("strips a trailing slash from OA_HOST", () => {
        mockEnv.IS_HOSTED = true;
        mockEnv.OA_TRACKING_KEY = "site_abc123";
        mockEnv.OA_HOST = "https://oa.example.com/";
        render(<OpenAnalytics />);
        const script = oaScript();
        expect(script?.getAttribute("src")).toBe(
            "https://oa.example.com/oa.js",
        );
        expect(script?.getAttribute("data-collector")).toBe(
            "https://oa.example.com",
        );
    });
});
