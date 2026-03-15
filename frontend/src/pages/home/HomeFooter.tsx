import { Link } from "react-router-dom";
import { MaterialIcon } from "@/utils/material";
import { GitHubLink, GITHUB_WEB, GITHUB_APP, GITHUB_LICENSE } from "./homeLinks";
import styles from "./home-footer.module.scss";

export function HomeFooter() {
    return (
        <footer className={styles.homepageFooter}>
            <div className={styles.footerBrand}>
                <div className={styles.footerLogoRow}>
                    <div className={styles.footerLogo} />
                    <span className={styles.footerBrandName}>FromChat</span>
                </div>
                <p className={styles.footerCopyright}>FromChat © 2026</p>
            </div>
            <div className={styles.footerLinks}>
                <div className={styles.footerSection}>
                    <Link to="/download" className={styles.footerLink}>
                        <MaterialIcon name="download" className={styles.footerLinkIcon} />
                        Скачать приложение
                    </Link>
                    <Link to="/login" className={styles.footerLink}>
                        <MaterialIcon name="language" className={styles.footerLinkIcon} />
                        Веб-версия
                    </Link>
                    <a
                        href={`${GITHUB_WEB}/actions/workflows/build.yml`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.footerLink}
                    >
                        <MaterialIcon name="computer" className={styles.footerLinkIcon} />
                        ПК-клиент
                    </a>
                </div>
                <div className={styles.footerSection}>
                    <a
                        href={`${GITHUB_APP}/tree/main`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.footerLink}
                    >
                        <MaterialIcon name="android" className={styles.footerLinkIcon} />
                        Исходный код приложения
                    </a>
                    <GitHubLink className={styles.footerLink}>
                        <MaterialIcon name="code" className={styles.footerLinkIcon} />
                        Исходный код веб-версии
                    </GitHubLink>
                    <a
                        href={GITHUB_LICENSE}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.footerLink}
                    >
                        <MaterialIcon name="description" className={styles.footerLinkIcon} />
                        Лицензия
                    </a>
                </div>
                <div className={styles.footerSection}>
                    <a
                        href="https://t.me/fromchat_ch"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.footerLink}
                    >
                        <span
                            className={`${styles.footerLinkIcon} ${styles.footerLinkIconSvg} ${styles.footerLinkIconSvgTelegram}`}
                        />
                        Telegram
                    </a>
                    <a
                        href="https://max.ru/join/c5t6LfnCCPetQSAOshmouEvq9vsjHZT_Lt63kw8YCg0"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.footerLink}
                    >
                        <span
                            className={`${styles.footerLinkIcon} ${styles.footerLinkIconSvg} ${styles.footerLinkIconSvgMax}`}
                        />
                        MAX
                    </a>
                </div>
            </div>
        </footer>
    );
}
