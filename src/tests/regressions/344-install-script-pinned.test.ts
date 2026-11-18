import { describe, expect, it } from "vitest";
import { renderInstallScript } from "@/lib/install-script";

describe("renderInstallScript", () => {
    it("marks the version-pinned route as pinned", async () => {
        const script = await renderInstallScript("v1.2.3", true);
        expect(script).toContain('VERSION="v1.2.3"');
        expect(script).toContain('PINNED="1"');
        expect(script).not.toContain("{{");
    });

    it("marks the latest route as unpinned", async () => {
        const script = await renderInstallScript("v1.2.3", false);
        expect(script).toContain('VERSION="v1.2.3"');
        expect(script).toContain('PINNED="0"');
        expect(script).not.toContain("{{");
    });

    it("never compares against the rendered version to decide pinning", async () => {
        const script = await renderInstallScript("v1.2.3", true);
        expect(script).not.toMatch(/"\$VERSION" !?= "v1\.2\.3"/);
    });
});
