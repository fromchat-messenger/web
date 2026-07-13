import { delay } from "@/utils/utils";

export type LegalDocumentKind = "privacy" | "terms";

export const LEGAL_DOCUMENT_PATH: Record<LegalDocumentKind, string> = {
    privacy: "/api/static/PRIVACY.md",
    terms: "/api/static/TERMS.md",
};

const RETRY_WINDOW_MS = 5000;
const RETRY_DELAY_MS = 1000;

const CACHE_KEY: Record<LegalDocumentKind, string> = {
    privacy: "fromchat:legal:privacy",
    terms: "fromchat:legal:terms",
};

export type LegalDocumentLoadResult =
    | { status: "success"; markdown: string; fromCache: false }
    | { status: "cached"; markdown: string; fromCache: true }
    | { status: "error"; message: string };

function readCache(kind: LegalDocumentKind): string | null {
    try {
        return localStorage.getItem(CACHE_KEY[kind]);
    } catch {
        return null;
    }
}

function writeCache(kind: LegalDocumentKind, markdown: string): void {
    try {
        localStorage.setItem(CACHE_KEY[kind], markdown);
    } catch {
        // best-effort
    }
}

async function fetchOnce(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
}

export async function loadLegalDocument(
    kind: LegalDocumentKind,
    signal?: AbortSignal,
): Promise<LegalDocumentLoadResult> {
    const path = LEGAL_DOCUMENT_PATH[kind];
    const start = Date.now();

    while (true) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }

        try {
            const markdown = await fetchOnce(path);
            writeCache(kind, markdown);
            return { status: "success", markdown, fromCache: false };
        } catch {
            const elapsed = Date.now() - start;
            if (elapsed >= RETRY_WINDOW_MS) {
                break;
            }
            await delay(RETRY_DELAY_MS);
        }
    }

    const cached = readCache(kind);
    if (cached != null && cached.length > 0) {
        return { status: "cached", markdown: cached, fromCache: true };
    }

    return {
        status: "error",
        message: "Не удалось загрузить документ. Проверьте подключение к интернету и попробуйте снова.",
    };
}
