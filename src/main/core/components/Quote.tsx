import type { ReactNode } from "react";

export interface QuoteProps {
    className?: string;
    children?: ReactNode;
    background?: "surfaceContainer" | "primaryContainer"
}

export default function Quote({ className, children, background = "primaryContainer" }: QuoteProps) {
    return (
        <div className={`quote bg-${background} ${className}`}>
            <div className="quote-inner">
                {children}
            </div>
        </div>
    )
}