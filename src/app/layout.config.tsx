import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Shared Fumadocs layout config (nav title, repo link). Currently only
// consumed by the docs layout under `src/app/(docs)/layout.tsx`; extracted
// so a future Fumadocs "home" layout (landing-shaped docs index) can reuse
// it without duplication.
export const baseOptions: BaseLayoutProps = {
    nav: {
        title: "OpenPlaud Docs",
        // Clicking the nav title returns to the docs landing instead of
        // bouncing the reader to the marketing root.
        url: "/docs",
    },
    githubUrl: "https://github.com/openplaud/openplaud",
};

// Sidebar tabs that split the docs into three top-level sections.
// `url` matches the `baseUrl` + folder name in `content/docs/`. Adding a
// new top-level section is two edits: a new folder under `content/docs/`
// and a new entry here.
export const docsTabs: NonNullable<DocsLayoutProps["tabs"]> = [
    { title: "Guides", url: "/docs/guides" },
    { title: "Self Hosting", url: "/docs/self-hosting" },
    { title: "Reference", url: "/docs/reference" },
];
