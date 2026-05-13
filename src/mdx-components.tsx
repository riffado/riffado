import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/**
 * MDX components surfaced to every `content/docs/**.mdx` file at render time.
 *
 * Adds the Fumadocs UI primitives that we expect content authors to reach
 * for most often (callouts, tabs, steps, cards, accordions, file trees) on
 * top of the defaults (`<a>`, headings, code blocks, etc.) shipped by
 * `fumadocs-ui/mdx`. Keep this list curated -- every component listed here
 * ships its CSS to the docs route. New additions only when content actually
 * needs them.
 *
 * Page-specific overrides (e.g. `createRelativeLink` for the `<a>` tag) are
 * applied inside the `[[...slug]]/page.tsx` render so they can close over
 * the current `page`. This module is intentionally page-agnostic.
 */
export function getMDXComponents(overrides?: MDXComponents): MDXComponents {
    return {
        ...defaultMdxComponents,
        Callout,
        Tabs,
        Tab,
        Steps,
        Step,
        Cards,
        Card,
        Accordions,
        Accordion,
        Files,
        File,
        Folder,
        ...overrides,
    };
}
