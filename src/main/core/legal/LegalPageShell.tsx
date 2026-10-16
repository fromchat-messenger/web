import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { MarketingPageShell } from "@/pages/home/MarketingPageShell";
import styles from "./legal.module.scss";

interface LegalPageShellProps {
    children: ReactNode;
}

export function LegalPageShell({ children }: LegalPageShellProps) {
    const navigate = useNavigate();

    const scrollToDownload = () => {
        navigate("/#download");
    };

    return (
        <MarketingPageShell onScrollToDownload={scrollToDownload}>
            <div className={styles.legalMain}>{children}</div>
        </MarketingPageShell>
    );
}
