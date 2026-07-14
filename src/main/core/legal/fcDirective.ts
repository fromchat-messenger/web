/**
 * Parses `<!-- fc:shape=Cookie4Sided icon=shield -->` directives before section headers.
 */

import { API_BASE_URL } from "@/core/config";

export interface FcSectionDirective {
    shape: string;
    icon: string;
}

const FC_DIRECTIVE_RE = /<!--\s*fc:([^>]+?)\s*-->/i;

function parseDirectiveBody(body: string): FcSectionDirective | null {
    const shapeMatch = body.match(/shape=([A-Za-z0-9_]+)/);
    const iconMatch = body.match(/icon=([A-Za-z0-9_-]+)/);
    if (!shapeMatch || !iconMatch) return null;
    return { shape: shapeMatch[1], icon: iconMatch[1] };
}

export function parseFcDirective(line: string): FcSectionDirective | null {
    const match = line.match(FC_DIRECTIVE_RE);
    if (!match) return null;
    return parseDirectiveBody(match[1]);
}

export interface LegalSection {
    directive: FcSectionDirective;
    title: string;
    bodyMarkdown: string;
}

/**
 * Split markdown into sections keyed by fc directives + `##` headings.
 */
export function parseLegalMarkdown(markdown: string): { preamble: string; sections: LegalSection[] } {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const preambleLines: string[] = [];
    const sections: LegalSection[] = [];

    let i = 0;
    while (i < lines.length) {
        const directive = parseFcDirective(lines[i]);
        if (directive && i + 1 < lines.length && lines[i + 1].startsWith("## ")) {
            const title = lines[i + 1].slice(3).trim();
            i += 2;
            const bodyLines: string[] = [];
            while (i < lines.length) {
                if (parseFcDirective(lines[i]) && i + 1 < lines.length && lines[i + 1].startsWith("## ")) {
                    break;
                }
                bodyLines.push(lines[i]);
                i += 1;
            }
            sections.push({
                directive,
                title,
                bodyMarkdown: bodyLines.join("\n").trim(),
            });
        } else if (sections.length === 0) {
            preambleLines.push(lines[i]);
            i += 1;
        } else {
            i += 1;
        }
    }

    return {
        preamble: preambleLines.join("\n").trim(),
        sections,
    };
}

export function staticIconUrl(icon: string): string {
    return `${API_BASE_URL}/static/icons/${encodeURIComponent(icon)}.webp`;
}

/** Maps legal-doc icon keys to Material Symbols names (Google Fonts). */
const LEGAL_MATERIAL_ICON: Record<string, string> = {
    privacy: "privacy_tip",
    terms: "contract",
};

export function legalMaterialIconName(icon: string): string {
    return LEGAL_MATERIAL_ICON[icon] ?? icon;
}
