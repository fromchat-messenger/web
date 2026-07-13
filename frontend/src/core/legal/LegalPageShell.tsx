import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { HomeHeader } from "@/pages/home/HomeHeader";
import { HomeFooter } from "@/pages/home/HomeFooter";
import homeStyles from "@/pages/home/home.module.scss";
import styles from "./legal.module.scss";

interface LegalPageShellProps {
    children: ReactNode;
}

export function LegalPageShell({ children }: LegalPageShellProps) {
    const navigate = useNavigate();

    const scrollToDownload = () => {
        navigate("/");
    };

    return (
        <div className={homeStyles.homepage}>
            <HomeHeader onScrollToDownload={scrollToDownload} />
            <main className={styles.legalMain}>{children}</main>
            <HomeFooter onScrollToDownload={scrollToDownload} />
        </div>
    );
}
