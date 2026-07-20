import type { ReactElement } from "react";

/**
 * Renders a React email template to an HTML email body.
 *
 * A minimal, dependency-free replacement for `@react-email/render`'s
 * `render(node, { pretty: false })`. Every call site in this codebase
 * already opted out of prettier-based pretty-printing (recipients never
 * see the raw HTML source), but that package's Node build eagerly
 * `require()`s `prettier/plugins/html` and `prettier/standalone` at
 * module load time regardless of that option. Next.js's `standalone`
 * output tracer externalizes those into a second `.next/node_modules`
 * directory that a Docker image copying only `.next/standalone` and
 * `.next/static` never includes, which crashed every server-side worker
 * that sends email (billing, background sync, export) at startup.
 *
 * This module is reachable from Server Components (via
 * `src/lib/auth.ts`'s email hooks), and Next.js's build statically
 * rejects any module in that graph that imports `react-dom/server` --
 * its own renderer already owns that surface there. `@react-email/render`
 * dodges the same restriction with a dynamic `import()`; this deferred
 * require does the same (matching the existing pattern in
 * `src/instrumentation.ts`), not for style but because it's the only way
 * to use `renderToStaticMarkup` from code also reachable by Server
 * Components.
 */
export async function renderEmailHtml(node: ReactElement): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(node);
    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">${html.replace(/<!DOCTYPE.*?>/, "")}`;
}
