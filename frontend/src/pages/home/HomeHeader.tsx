import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/state/user";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIconButton } from "@/utils/material";
import { GitHubLink, SupportLink } from "@/pages/home/homeLinks";
import styles from "@/pages/home/home-header.module.scss";

export function HomeHeader() {
    const navigate = useNavigate();
    const { user } = useUserStore();
    const { isMobile } = useDownloadAppScreen();
    const isLoggedIn = user.authToken && user.currentUser;

    function handleGetStarted() {
        if (isMobile) {
            navigate("/download-app");
        } else if (isLoggedIn) {
            navigate("/chat");
        } else {
            navigate("/login");
        }
    }

    const openBtn = (
        <MaterialButton
            variant="filled"
            onClick={handleGetStarted}
            icon={
                isMobile ? "download" : isLoggedIn ? "open_in_new" : "login"
            }
            className={styles.headerDownloadButton}
        >
            {isMobile ? "Скачать" : isLoggedIn ? "Открыть" : "Войти"}
        </MaterialButton>
    );

    return (
        <header className={styles.homepageHeader}>
            <div className={styles.headerInner}>
                <div className={styles.headerContent}>
                    <div className={styles.logo}>
                        <div className={styles.logoIcon} />
                        <h1>FromChat</h1>
                    </div>
                    <div className={styles.headerCenterLinks}>
                        <GitHubLink>
                            <MaterialButton variant="text" icon="code">GitHub</MaterialButton>
                        </GitHubLink>
                        <SupportLink>
                            <MaterialButton variant="text" icon="support">Поддержка</MaterialButton>
                        </SupportLink>
                    </div>
                    <div className={styles.headerButton}>
                        {openBtn}
                        {isMobile ? (
                            <MaterialIconButton
                                variant="filled"
                                onClick={() => navigate("/download-app")}
                                icon="download"
                                className={styles.headerSmallButton}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </header>
    );
}
