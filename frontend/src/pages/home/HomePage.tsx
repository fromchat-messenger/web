import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import styles from "./home.module.scss";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import generalChatScreenshot from "../../images/screenshots/general-chat.png";
import dmScreenshot from "../../images/screenshots/dm.png";
import { HomeHeader } from "./HomeHeader";
import { HomeFooter } from "./HomeFooter";
import { OS_CONFIG, ALL_OS } from "@/core/downloads/os";

interface FeatureSectionProps {
    title: ReactNode;
    children: ReactNode;
    screenshot: string;
    right?: boolean;
}

function FeatureSection({
    title,
    children,
    screenshot,
    right = false,
}: FeatureSectionProps) {
    const featureText = (
        <div className={styles.featureText}>
            <div className={styles.featureTitle}>{title}</div>
            <div className={styles.featureDesc}>{children}</div>
        </div>
    );

    const featureScreenshot = (
        <div className={styles.featureScreenshotOuter}>
            <div className={styles.featureScreenshotGlow} />
            <img src={screenshot} className={styles.featureScreenshot} draggable={false} />
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
    const { isMobile } = useDownloadAppScreen();

    return (
        <div className={styles.homepage}>
            <HomeHeader />

            <main>
                <section className={styles.title}>
                    <div className={styles.titleLogoWrapper}>
                        <div className={styles.titleLogo} />
                    </div>
                    <div className={styles.titleContent}>FromChat</div>
                    <div className={styles.titleDesc}>
                        100% бесплатный и открытый мессенджер. Поддерживает self-hosted установку на своём сервере.
                    </div>
                    <div className={styles.titleButtons}>
                        {isMobile ? null : (
                            <MaterialButton
                                variant="filled"
                                onClick={() => navigate("/auth?mode=login")}
                                icon="devices"
                            >
                                Открыть веб-версию
                            </MaterialButton>
                        )}
                        <MaterialButton
                            variant={isMobile ? "filled" : "outlined"}
                            onClick={() => navigate("/download-app")}
                            icon="download"
                        >
                            Скачать приложение
                        </MaterialButton>
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
                                Настольное приложение с уведомлениями и автономной работой
                                или мобильное приложение для Android и iOS.
                            </p>
                            <div className={styles.downloadTable}>
                                <div className={styles.downloadTableHeader}>
                                    <span>Платформа</span>
                                    <span>Описание</span>
                                    <span />
                                </div>
                                {ALL_OS.map((os) => (
                                    <div key={os} className={styles.downloadTableRow}>
                                        <div className={styles.downloadTableOs}>
                                            <MaterialIcon
                                                name={OS_CONFIG[os].icon}
                                                className={styles.downloadTableIcon}
                                            />
                                            <span>{OS_CONFIG[os].label}</span>
                                        </div>
                                        <span className={styles.downloadTableDesc}>
                                            {OS_CONFIG[os].description}
                                        </span>
                                        <div className={styles.downloadTableAction}>
                                            <a
                                                href={`/api/download/${os}`}
                                                className={styles.downloadTableActionLink}
                                            >
                                                <MaterialButton
                                                    variant="outlined"
                                                    icon="download"
                                                >
                                                    Скачать
                                                </MaterialButton>
                                            </a>
                                        </div>
                                    </div>
                                ))}
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

            <HomeFooter />
        </div>
    );
}
