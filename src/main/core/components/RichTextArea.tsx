import { useEffect, useRef, useCallback, useLayoutEffect } from "react";

interface RichTextAreaProps {
    text: string;
    onTextChange: (value: string) => void;
    onEnter?: "newLine" | null | ((e: React.KeyboardEvent<HTMLTextAreaElement>) => void);
    onCtrlEnter?: ((e: React.KeyboardEvent<HTMLTextAreaElement>) => void) | null;
    placeholder?: string;
    id?: string;
    className?: string;
    rows?: number;
    autoComplete?: string;
    readOnly?: boolean;
}

export function RichTextArea({
    text,
    onTextChange,
    onEnter = "newLine",
    onCtrlEnter = null,
    placeholder,
    className,
    rows = 1,
    autoComplete = "off",
    readOnly = false
}: RichTextAreaProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const hiddenTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const heightRef = useRef<number | null>(null);

    function getStyleValue(computedStyle: CSSStyleDeclaration, prop: keyof CSSStyleDeclaration): number {
        const raw = computedStyle[prop] as string | number | undefined;
        if (raw == null) return 0;
        const str = String(raw);
        return str.endsWith("px") ? parseFloat(str) : parseFloat(str) || 0;
    }

    const calculateTextareaStyles = useCallback(() => {
        const textarea = textareaRef.current;
        const hidden = hiddenTextareaRef.current;
        if (!textarea || !hidden) return undefined;

        const computedStyle = window.getComputedStyle(textarea);
        if (computedStyle.width === "0px") {
            return { outerHeightStyle: 0, overflowing: false };
        }

        // Ensure hidden textarea copies width but not percentage-based anomalies from parents
        // Normalize hidden textarea to avoid inherited constraints and copy critical metrics
        hidden.style.position = "fixed";
        hidden.style.top = "-9999px";
        hidden.style.left = "-9999px";
        hidden.style.visibility = "hidden";
        hidden.style.height = "auto";
        hidden.style.minHeight = "0";
        hidden.style.maxHeight = "none";
        hidden.style.overflow = "hidden";
        hidden.style.boxSizing = computedStyle.boxSizing;
        // Avoid counting vertical padding twice: keep 0 for measurement
        hidden.style.paddingTop = "0";
        hidden.style.paddingBottom = "0";
        hidden.style.paddingLeft = computedStyle.paddingLeft;
        hidden.style.paddingRight = computedStyle.paddingRight;
        // Do not include borders in the inner scrollHeight measurement
        hidden.style.borderTopWidth = "0";
        hidden.style.borderBottomWidth = "0";
        hidden.style.borderLeftWidth = computedStyle.borderLeftWidth;
        hidden.style.borderRightWidth = computedStyle.borderRightWidth;
        hidden.style.fontFamily = computedStyle.fontFamily;
        hidden.style.fontSize = computedStyle.fontSize;
        hidden.style.fontWeight = computedStyle.fontWeight;
        hidden.style.lineHeight = computedStyle.lineHeight;
        hidden.style.letterSpacing = computedStyle.letterSpacing;
        hidden.style.whiteSpace = computedStyle.whiteSpace;
        hidden.style.wordSpacing = computedStyle.wordSpacing;
        hidden.style.textIndent = computedStyle.textIndent;
        hidden.style.textTransform = computedStyle.textTransform;
        hidden.style.textDecoration = computedStyle.textDecoration;
        hidden.style.width = computedStyle.width;
        hidden.style.maxWidth = computedStyle.width;
        hidden.value = textarea.value || placeholder || "x";
        if (hidden.value.slice(-1) === "\n") {
            hidden.value += " ";
        }

        const boxSizing = computedStyle.boxSizing;
        const padding = getStyleValue(computedStyle, "paddingBottom") + getStyleValue(computedStyle, "paddingTop");
        const border = getStyleValue(computedStyle, "borderBottomWidth") + getStyleValue(computedStyle, "borderTopWidth");

        const innerHeight = hidden.scrollHeight;

        hidden.value = "x";
        const singleRowHeight = hidden.scrollHeight;

        let outerHeight = innerHeight;
        const minRows = Number(rows || 1);
        if (minRows) {
            outerHeight = Math.max(minRows * singleRowHeight, outerHeight);
        }
        outerHeight = Math.max(outerHeight, singleRowHeight);

        // Use ceil to avoid sub-pixel gaps and subtract a tiny epsilon to reduce visual gap
        let outerHeightStyle = outerHeight + (boxSizing === "border-box" ? padding + border : 0);
        outerHeightStyle = Math.round(outerHeightStyle); // snap to pixel to avoid half-line gaps
        const overflowing = Math.abs(outerHeight - innerHeight) <= 1;
        return { outerHeightStyle, overflowing };
    }, [rows, placeholder]);

    const syncHeight = useCallback(() => {
        const textarea = textareaRef.current;
        const styles = calculateTextareaStyles();
        if (!textarea || !styles) return;
        const { outerHeightStyle, overflowing } = styles;
        if (heightRef.current !== outerHeightStyle) {
            heightRef.current = outerHeightStyle;
            textarea.style.height = `${outerHeightStyle}px`;
        }
        textarea.style.overflowY = overflowing ? "hidden" : "";
    }, [calculateTextareaStyles]);

    useLayoutEffect(() => {
        syncHeight();
    }, [syncHeight, text]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const onResize = () => syncHeight();
        window.addEventListener("resize", onResize);
        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(() => {
                ro!.unobserve(textarea);
                syncHeight();
                requestAnimationFrame(() => ro && textarea && ro.observe(textarea));
            });
            ro.observe(textarea);
        }
        return () => {
            window.removeEventListener("resize", onResize);
            if (ro) ro.disconnect();
        };
    }, [syncHeight]);

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        // Keep height responsive during rapid uncontrolled input bursts
        syncHeight();
        onTextChange(e.target.value);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        const isCtrlEnter = e.key === "Enter" && (e.ctrlKey || e.metaKey);
        const isPlainEnter = e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

        if (isCtrlEnter) {
            e.preventDefault();
            if (typeof onCtrlEnter === "function") {
                onCtrlEnter(e);
            }
            return;
        }

        if (isPlainEnter) {
            if (onEnter === "newLine") {
                // allow default
                return;
            }
            if (onEnter === null) {
                e.preventDefault();
                return;
            }
            if (typeof onEnter === "function") {
                e.preventDefault();
                onEnter(e);
                return;
            }
        }
    }

    return (
        <>
            <textarea
                className={`rich-text-area ${className}`}
                ref={textareaRef}
                value={text}
                placeholder={placeholder}
                rows={rows}
                autoComplete={readOnly ? "off" : autoComplete}
                onChange={readOnly ? undefined : handleChange}
                onKeyDown={readOnly ? undefined : handleKeyDown}
                readOnly={readOnly} />
            <textarea
                aria-hidden
                readOnly
                tabIndex={-1}
                ref={hiddenTextareaRef}
                style={{
                    position: "fixed",
                    top: "-9999px",
                    left: "-9999px",
                    visibility: "hidden",
                    paddingTop: 0,
                    paddingBottom: 0,
                    height: "auto",
                    minHeight: 0,
                    maxHeight: "none",
                    overflow: "hidden",
                }}
                rows={1}
            />
        </>
    );
}