import type { ReactNode } from "react";
import { HomeHeader } from "@/pages/home/HomeHeader";
import { HomeFooter } from "@/pages/home/HomeFooter";
import { KeepAndroidOpenBanner } from "@/pages/home/KeepAndroidOpenBanner";
import styles from "@/pages/home/home.module.scss";

interface MarketingPageShellProps {
    children: ReactNode;
    onScrollToDownload?: () => void;
}

export function MarketingPageShell({ children, onScrollToDownload }: MarketingPageShellProps) {
    return (
        <div className={styles.homepage}>
            <HomeHeader onScrollToDownload={onScrollToDownload} />
            <KeepAndroidOpenBanner />
            <main className={styles.main}>{children}</main>
            <HomeFooter onScrollToDownload={onScrollToDownload} />
        </div>
    );
}
