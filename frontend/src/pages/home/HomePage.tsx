import { Link, useNavigate } from "react-router-dom";
import { useUserStore } from "@/state/user";
import styles from "./home.module.scss";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import generalChatScreenshot from "../../images/screenshots/general-chat.png";
import dmScreenshot from "../../images/screenshots/dm.png";
import telegramIcon from "../../images/telegram.svg";
import maxIcon from "../../images/max.svg";
import type { ReactNode } from "react";

const GITHUB_WEB = "https://github.com/fromchat-messenger/web";
const GITHUB_APP = "https://github.com/fromchat-messenger/app";
const GITHUB_LICENSE = `${GITHUB_WEB}/blob/main/LICENSE`;

function GitHubLink({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <a href={`${GITHUB_WEB}/tree/main`} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    );
}

function SupportLink({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <a href="https://t.me/denis0001-dev" target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    );
}

interface FeatureSectionProps {
    title: ReactNode;
    children: ReactNode;
    screenshot: string;
    right?: boolean;
}

function FeatureSection({title, children, screenshot, right = false}: FeatureSectionProps) {
    const featureText = (
        <div className={styles.featureText}>
            <div className={styles.featureTitle}>{title}</div>
            <div className={styles.featureDesc}>{children}</div>
        </div>
    );

    const featureScreenshot = (
        <div className={styles.featureScreenshotOuter}>
            <div className={styles.featureScreenshotGlow} />
            <img src={screenshot} className={styles.featureScreenshot} />
        </div>
    )

    return (
        <div className={`${styles.featureContainer}`}>
            {right ? <>{featureText}{featureScreenshot}</> : <>{featureScreenshot}{featureText}</>}
        </div>
    )
}

export default function HomePage() {
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
        <MaterialButton variant="filled" onClick={handleGetStarted} icon={isMobile ? "download" : isLoggedIn ? "open_in_new" : "login"}>
            {isMobile ? "Скачать" : isLoggedIn ? "Открыть" : "Войти"}
        </MaterialButton>
    );

    return (
        <div className={styles.homepage}>
            <div className={styles.colorSphere} />
            <header className={styles.homepageHeader}>
                <div className={styles.container}>
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
                        </div>
                    </div>
                </div>
            </header>

            <main>
                <section className={styles.title}>
                    <div className={styles.titleLogo} />
                    <div className={styles.titleContent}>FromChat</div>
                    <div className={styles.titleDesc}>
                        100% бесплатный и открытый мессенджер. Поддерживает self-hosted установку на своём сервере.
                    </div>
                    <div className={styles.titleButtons}>
                        <MaterialButton variant="filled" onClick={() => navigate("/auth?mode=login")} icon="devices">Открыть веб-версию</MaterialButton>
                        <MaterialButton variant="outlined" onClick={() => navigate("/download-app")} icon="download">Скачать приложение</MaterialButton>
                    </div>
                </section>

                <section className={styles.features}>
                    <FeatureSection
                        title={<>Общий чат</>}
                        screenshot={generalChatScreenshot}
                        right
                    >
                        Открытый форум для всех пользователей сервера. Пишите сообщения, делитесь файлами и общайтесь в реальном времени.
                    </FeatureSection>
                    <FeatureSection
                        title={<>Личные сообщения</>}
                        screenshot={dmScreenshot}>
                        Общайтесь с одним человеком в личной переписке.
                    </FeatureSection>
                </section>

                <section className={styles.download}>
                    <div className={styles.container}>
                        <div className={styles.downloadContent}>
                            <h3>Скачайте приложение</h3>
                            <p>
                                Для лучшего опыта используйте настольное приложение с уведомлениями
                                и автономной работой или мобильное приложение для Android.
                            </p>
                            <div className={styles.downloadPlatforms}>
                                {!isMobile ? (
                                    <>
                                        <a
                                            href={`${GITHUB_WEB}/actions/workflows/build.yml`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.downloadCard}
                                        >
                                            <MaterialIcon name="computer" className={styles.downloadCardIcon} />
                                            <span className={styles.downloadCardTitle}>Для ПК</span>
                                            <span className={styles.downloadCardDesc}>Windows, macOS, Linux</span>
                                            <MaterialButton variant="filled" className={styles.downloadCardBtn}>
                                                <MaterialIcon name="download" slot="icon" />
                                                Скачать
                                            </MaterialButton>
                                        </a>
                                        <a
                                            href={`${GITHUB_APP}/releases/latest`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.downloadCard}
                                        >
                                            <MaterialIcon name="android" className={styles.downloadCardIcon} />
                                            <span className={styles.downloadCardTitle}>Android</span>
                                            <span className={styles.downloadCardDesc}>APK на GitHub</span>
                                            <MaterialButton variant="outlined" className={styles.downloadCardBtn}>
                                                <MaterialIcon name="download" slot="icon" />
                                                Скачать
                                            </MaterialButton>
                                        </a>
                                        <div className={styles.downloadCard}>
                                            <MaterialIcon name="language" className={styles.downloadCardIcon} />
                                            <span className={styles.downloadCardTitle}>Веб-версия</span>
                                            <span className={styles.downloadCardDesc}>Без установки</span>
                                            <MaterialButton variant="outlined" className={styles.downloadCardBtn} onClick={() => navigate("/login")}>
                                                <MaterialIcon name="open_in_new" slot="icon" />
                                                Открыть
                                            </MaterialButton>
                                        </div>
                                    </>
                                ) : (
                                    <a
                                        href={`${GITHUB_APP}/releases/latest`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.downloadCard}
                                    >
                                        <MaterialIcon name="android" className={styles.downloadCardIcon} />
                                        <span className={styles.downloadCardTitle}>Android</span>
                                        <span className={styles.downloadCardDesc}>Скачайте APK на GitHub</span>
                                        <MaterialButton variant="filled" className={styles.downloadCardBtn}>
                                            <MaterialIcon name="download" slot="icon" />
                                            Скачать приложение
                                        </MaterialButton>
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className={styles.cta}>
                    <div className={styles.container}>
                        <div className={styles.ctaContent}>
                            <h3>Готовы начать общение?</h3>
                            <p>
                                Создайте аккаунт за минуту. Общайтесь в общем чате, ведите личную переписку
                                или звоните — всё бесплатно и с открытым кодом.
                            </p>
                            <div className={styles.ctaActions}>
                                {isMobile ? (
                                    <MaterialButton variant="filled" onClick={() => navigate("/download-app")}>
                                        Скачать приложение
                                    </MaterialButton>
                                ) : (
                                    <>
                                        <MaterialButton
                                            variant="filled"
                                            onClick={() => navigate("/register")}>
                                            Создать аккаунт
                                        </MaterialButton>
                                        <MaterialButton
                                            variant="outlined"
                                            onClick={() => navigate("/login")}>
                                            Войти
                                        </MaterialButton>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className={styles.homepageFooter}>
                <div className={styles.footerBrand}>
                    <div className={styles.footerLogoRow}>
                        <div className={styles.footerLogo} />
                        <span className={styles.footerBrandName}>FromChat</span>
                    </div>
                    <p className={styles.footerCopyright}>FromChat © 2025</p>
                </div>
                <div className={styles.footerLinks}>
                    <div className={styles.footerSection}>
                        <Link to="/download-app" className={styles.footerLink}>
                            <MaterialIcon name="download" className={styles.footerLinkIcon} />
                            Скачать приложение
                        </Link>
                        <Link to="/login" className={styles.footerLink}>
                            <MaterialIcon name="language" className={styles.footerLinkIcon} />
                            Веб-версия
                        </Link>
                    </div>
                    <div className={styles.footerSection}>
                        <a href={`${GITHUB_APP}/tree/main`} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                            <MaterialIcon name="android" className={styles.footerLinkIcon} />
                            Исходный код приложения
                        </a>
                        <GitHubLink className={styles.footerLink}>
                            <MaterialIcon name="code" className={styles.footerLinkIcon} />
                            Исходный код веб-версии
                        </GitHubLink>
                        <a href={GITHUB_LICENSE} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                            <MaterialIcon name="description" className={styles.footerLinkIcon} />
                            Лицензия
                        </a>
                    </div>
                    <div className={styles.footerSection}>
                        <a href="https://t.me/fromchat_ch" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                            <span className={`${styles.footerLinkIcon} ${styles.footerLinkIconSvg}`} style={{ maskImage: `url(${telegramIcon})`, WebkitMaskImage: `url(${telegramIcon})` }} />
                            Telegram
                        </a>
                        <a href="https://max.ru/join/c5t6LfnCCPetQSAOshmouEvq9vsjHZT_Lt63kw8YCg0" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                            <span className={`${styles.footerLinkIcon} ${styles.footerLinkIconSvg}`} style={{ maskImage: `url(${maxIcon})`, WebkitMaskImage: `url(${maxIcon})` }} />
                            MAX
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
