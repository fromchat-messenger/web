import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { parse } from "marked";
import { escape as escapeHtml } from "he";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import { fitPathToUnitSquare, getMaterialShapePath } from "./materialShapes";
import { legalMaterialIconName, parseLegalMarkdown, type LegalSection } from "./fcDirective";
import { rewriteLegalDocumentHref, rewriteLegalLinksInHtml } from "./legalLinks";
import {
    loadLegalDocument,
    type LegalDocumentKind,
} from "./legalDocumentLoader";
import { LegalPageShell } from "./LegalPageShell";
import styles from "./legal.module.scss";

const CACHED_BANNER_TEXT =
    "Показана сохранённая копия документа. Содержимое может быть устаревшим.";

function wrapMarkdownTables(html: string): string {
    return html.replace(
        /<table\b[^>]*>[\s\S]*?<\/table>/gi,
        (table) => `<div class="legalTableScroll">${table}</div>`,
    );
}

function renderMarkdownBody(markdown: string): string {
    const html = parse(markdown, { breaks: true, gfm: true }) as string;
    return wrapMarkdownTables(rewriteLegalLinksInHtml(html));
}

function ExpressiveSectionHeader({
    section,
}: {
    section: LegalSection;
}) {
    const shapePath = useMemo(
        () => getMaterialShapePath(section.directive.shape),
        [section.directive.shape],
    );
    const shapeFit = useMemo(
        () => fitPathToUnitSquare(shapePath),
        [shapePath],
    );
    const iconName = legalMaterialIconName(section.directive.icon);

    return (
        <div className={styles.sectionHeader}>
            <div className={styles.sectionIconFrame}>
                <svg
                    viewBox="0 0 1 1"
                    className={styles.sectionIconShape}
                    aria-hidden="true"
                >
                    <g transform={shapeFit.transform}>
                        <path d={shapePath} className={styles.sectionShapeFill} />
                    </g>
                </svg>
                <MaterialIcon name={iconName} className={styles.sectionIconGlyph} />
            </div>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
        </div>
    );
}

interface LegalMarkdownPageProps {
    kind: LegalDocumentKind;
}

export function LegalMarkdownPage({ kind }: LegalMarkdownPageProps) {
    const navigate = useNavigate();
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [markdown, setMarkdown] = useState<string | null>(null);
    const [isCached, setIsCached] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const handleContentClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;

        const href = anchor.getAttribute("href");
        if (!href) return;

        const clientRoute = rewriteLegalDocumentHref(href) ?? (
            href === "/terms" || href === "/privacy" ? href : null
        );
        if (!clientRoute) return;

        event.preventDefault();
        navigate(clientRoute);
    }, [navigate]);

    const retry = useCallback(() => {
        setLoadAttempt((attempt) => attempt + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const abortController = new AbortController();

        setMarkdown(null);
        setError(null);
        setIsCached(false);
        setLoading(true);

        loadLegalDocument(kind, abortController.signal)
            .then((result) => {
                if (cancelled) return;

                if (result.status === "error") {
                    setError(result.message);
                    return;
                }

                setMarkdown(result.markdown);
                setIsCached(result.fromCache);
            })
            .catch((e: unknown) => {
                if (cancelled || (e instanceof DOMException && e.name === "AbortError")) {
                    return;
                }
                setError("Не удалось загрузить документ. Проверьте подключение к интернету и попробуйте снова.");
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
            abortController.abort();
        };
    }, [kind, loadAttempt]);

    const content = (() => {
        if (loading) {
            return (
                <div className={styles.legalPage}>
                    <p className={styles.loading}>Загрузка…</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className={styles.legalPage}>
                    <div className={styles.errorState}>
                        <p className={styles.error}>{escapeHtml(error)}</p>
                        <MaterialButton onClick={retry}>Повторить</MaterialButton>
                    </div>
                </div>
            );
        }

        if (!markdown) {
            return (
                <div className={styles.legalPage}>
                    <p className={styles.loading}>Загрузка…</p>
                </div>
            );
        }

        const { preamble, sections } = parseLegalMarkdown(markdown);

        return (
            <div className={styles.legalPage} onClick={handleContentClick}>
                {isCached ? (
                    <div className={styles.cachedBanner} role="status">
                        {CACHED_BANNER_TEXT}
                    </div>
                ) : null}

                {preamble ? (
                    <div
                        className={styles.preamble}
                        dangerouslySetInnerHTML={{ __html: renderMarkdownBody(preamble) }}
                    />
                ) : null}

                {sections.map((section, index) => (
                    <section key={`${section.title}-${index}`} className={styles.section}>
                        <ExpressiveSectionHeader section={section} />
                        <div
                            className={styles.sectionBody}
                            dangerouslySetInnerHTML={{ __html: renderMarkdownBody(section.bodyMarkdown) }}
                        />
                    </section>
                ))}
            </div>
        );
    })();

    return <LegalPageShell>{content}</LegalPageShell>;
}

export type { LegalDocumentKind };
