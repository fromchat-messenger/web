const LEGAL_STATIC_LINK_RE = /(?:^|\/)?(?:api\/)?static\/(TERMS|PRIVACY)\.md$/i;

/**
 * Maps static legal markdown API paths to client routes.
 * Returns null when the href is not a legal document link.
 */
export function rewriteLegalDocumentHref(href: string): string | null {
    const path = href.replace(/\\/g, "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
    const match = path.match(LEGAL_STATIC_LINK_RE);
    if (!match) return null;
    return match[1].toUpperCase() === "TERMS" ? "/terms" : "/privacy";
}

export function rewriteLegalLinksInHtml(html: string): string {
    return html.replace(/href="([^"]+)"/g, (full, href: string) => {
        const rewritten = rewriteLegalDocumentHref(href);
        return rewritten ? `href="${rewritten}"` : full;
    });
}
