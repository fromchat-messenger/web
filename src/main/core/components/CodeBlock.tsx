import { Fragment, useState } from "react";
import { MaterialIconButton } from "@/utils/material";
import styles from "@/core/components/css/code-block.module.scss";

interface CodeBlockProps {
    code: string;
    className?: string;
}

function highlightShellLine(line: string): React.ReactNode[] {
    if (!line) {
        return [""];
    }

    const segments = line.split(/(\s+)/);
    const words = segments.filter((part) => !/^\s+$/.test(part));
    const command = words[0] ?? "";

    let wordIndex = 0;

    return segments.map((part, index) => {
        if (/^\s+$/.test(part)) {
            return part;
        }

        wordIndex += 1;
        const key = `${index}-${part}`;

        if (/^https?:\/\//.test(part)) {
            return (
                <span key={key} className={styles.tokenUrl}>
                    {part}
                </span>
            );
        }

        if (/^--[\w-]+$/.test(part) || /^-[a-zA-Z][\w-]*$/.test(part)) {
            return (
                <span key={key} className={styles.tokenFlag}>
                    {part}
                </span>
            );
        }

        if (wordIndex === 1) {
            return (
                <span key={key} className={styles.tokenCommand}>
                    {part}
                </span>
            );
        }

        if (wordIndex === 2 && (command === "git" || command === "docker")) {
            return (
                <span key={key} className={styles.tokenSubcommand}>
                    {part}
                </span>
            );
        }

        if (part.includes("/") || part.endsWith(".git") || part.endsWith(".sh")) {
            return (
                <span key={key} className={styles.tokenPath}>
                    {part}
                </span>
            );
        }

        return (
            <span key={key} className={styles.tokenArg}>
                {part}
            </span>
        );
    });
}

function highlightShell(code: string): React.ReactNode {
    const lines = code.split("\n");

    return lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
            {highlightShellLine(line)}
            {lineIndex < lines.length - 1 ? "\n" : null}
        </Fragment>
    ));
}

export function CodeBlock({ code, className }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    }

    return (
        <div className={`${styles.codeBlock}${className ? ` ${className}` : ""}`}>
            <pre className={styles.pre}>
                <code>{highlightShell(code)}</code>
            </pre>
            <MaterialIconButton
                variant="standard"
                icon={copied ? "check" : "content_copy"}
                className={styles.copyButton}
                onClick={handleCopy}
                title={copied ? "Скопировано" : "Копировать"}
            />
        </div>
    );
}
