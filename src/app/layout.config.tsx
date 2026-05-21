import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const baseOptions: BaseLayoutProps = {
    nav: {
        title: "OpenPlaud Docs",
        url: "/docs",
    },
    githubUrl: "https://github.com/openplaud/openplaud",
};

export const docsTabs: NonNullable<DocsLayoutProps["tabs"]> = [
    { title: "Guides", url: "/docs/guides" },
    { title: "Self Hosting", url: "/docs/self-hosting" },
    { title: "Reference", url: "/docs/reference" },
];
