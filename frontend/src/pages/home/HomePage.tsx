import { useNavigate } from "react-router-dom";
import { useUserStore } from "@/state/user";
import styles from "./home.module.scss";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import generalChatScreenshot from "../../images/screenshots/general-chat.png";
import dmScreenshot from "../../images/screenshots/dm.png";

function GitHubLink({ children }: { children: React.ReactNode }) {
    return (
        <a href="https://github.com/denis0001-dev/FromChat" target="_blank">{children}</a>
    );
}

function SupportLink({ children }: { children: React.ReactNode }) {
    return (
        <a href="https://t.me/denis0001-dev" target="_blank">{children}</a>
    );
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
                    <div className={styles.titleDesc}>100% бесплатный и открытый мессенджер. Поддерживает self-hosted установку на своем сервере.</div>
                    <div className={styles.titleButtons}>
                        <MaterialButton variant="filled" onClick={() => navigate("/auth?mode=login")} icon="devices">Открыть веб-версию</MaterialButton>
                        <MaterialButton variant="outlined" onClick={() => navigate("/download-app")} icon="download">Скачать приложение</MaterialButton>
                    </div>
                </section>

                <section className={styles.features}>
                    <div className={`${styles.featureContainer}`}>
                        <div className={styles.featureText}>
                            <div className={styles.featureTitle}>Общий чат</div>
                            <div className={styles.featureDesc}>Общайтесь со всеми пользователями этого сервера FromChat.</div>
                        </div>
                        <div className={styles.featureScreenshotOuter}>
                            <div className={styles.featureScreenshotGlow} />
                            <img src={generalChatScreenshot} className={styles.featureScreenshot} />
                        </div>
                    </div>
                    <div className={`${styles.featureContainer}`}>
                        <img src={dmScreenshot} className={styles.featureScreenshot} />
                        <div className={styles.featureText}>
                            <div className={styles.featureTitle}>Личные сообщения</div>
                            <div className={styles.featureDesc}>Общайтесь с одним человеком.</div>
                        </div>
                    </div>
                </section>

                <section className={styles.download}>
                    <div className={styles.container}>
                        <div className={styles.downloadContent}>
                            <h3>Скачайте приложение</h3>
                            <p>
                                Для лучшего опыта используйте настольное приложение с поддержкой
                                уведомлений и автономной работы.
                            </p>
                            <div className={styles.downloadButtons}>
                                {!isMobile ? (
                                    <>
                                        <a
                                            href="https://github.com/Toolbox-io/FromChat/actions/workflows/build.yml"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <MaterialButton variant="filled">
                                                <MaterialIcon name="download" slot="icon" />
                                                Скачать для ПК
                                            </MaterialButton>
                                        </a>
                                        <MaterialButton variant="outlined" onClick={() => navigate("/login")}>
                                            <MaterialIcon name="language" slot="icon" />
                                            Веб-версия
                                        </MaterialButton>
                                    </>
                                ) : (
                                    <MaterialButton variant="filled" onClick={() => navigate("/download-app")}>
                                        Скачать приложение
                                    </MaterialButton>
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
                                Присоединяйтесь к FromChat и общайтесь безопасно с друзьями и коллегами.
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
                <div className={styles.container}>
                    <div className={styles.footerContent}>
                        <div className={styles.footerSection}>
                            <h4>Ссылки</h4>
                            <GitHubLink>GitHub</GitHubLink>
                            <SupportLink>Поддержка</SupportLink>
                        </div>
                        <div className={styles.footerSection}>
                            <h4>Лицензия</h4>
                            <p>GPL-3.0</p>
                        </div>
                    </div>
                    <div className={styles.footerBottom}>
                        <p>&copy; 2025 FromChat. Сделано программистом denis0001-dev с ❤️ для свободы общения.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
