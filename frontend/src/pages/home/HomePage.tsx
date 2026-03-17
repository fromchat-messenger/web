import { useNavigate } from "react-router-dom";
import { useState, type ReactNode } from "react";
import styles from "./home.module.scss";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon, MaterialList, MaterialListItem } from "@/utils/material";
import generalChatScreenshot from "../../images/screenshots/general-chat.png";
import dmScreenshot from "../../images/screenshots/dm.png";
import windowsIcon from "../../images/windows.svg";
import linuxIcon from "../../images/linux.svg";
import macIcon from "../../images/mac.svg";
import { HomeHeader } from "./HomeHeader";
import { HomeFooter } from "./HomeFooter";
import { SplitButton } from "@/core/components/SplitButton";
import { DownloadDialog } from "@/core/components/DownloadDialog";
import { OS_CONFIG, ALL_OS, detectOs, type DownloadOs } from "@/core/downloads/os";

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

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogOs, setDialogOs] = useState<DownloadOs>(() => detectOs());
    const [menuOpen, setMenuOpen] = useState(false);

    const triggerDownload = (os: DownloadOs): boolean => {
        if (typeof document === "undefined") {
            return false;
        }

        setDialogOs(os);
        setDialogOpen(true);

        const link = document.createElement("a");
        link.href = `/api/download/${os}`;
        link.download = "";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
    };

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
                        <SplitButton
                            variant={isMobile ? "filled" : "tonal"}
                            text="Скачать приложение"
                            icon="download"
                            onPrimaryClick={() => triggerDownload(detectOs())}
                            menuOpen={menuOpen}
                            onMenuOpen={setMenuOpen}
                            menu={(
                                <MaterialList>
                                    {ALL_OS.map((os) => (
                                        <MaterialListItem
                                            key={os}
                                            icon={["windows", "linux", "macos"].includes(os) ? undefined : OS_CONFIG[os].icon}
                                            headline={OS_CONFIG[os].label}
                                            rounded
                                            onClick={() => {
                                                if (triggerDownload(os)) setMenuOpen(false);
                                            }}
                                        >
                                            {["windows", "linux", "macos"].includes(os) && (
                                                <span
                                                    slot="icon"
                                                    className={styles.menuCustomIcon}
                                                    style={{
                                                        "--menu-custom-icon-url": `url("${os === "windows" ? windowsIcon : os === "linux" ? linuxIcon : macIcon}")`,
                                                    } as React.CSSProperties}
                                                />
                                            )}
                                        </MaterialListItem>
                                    ))}
                                </MaterialList>
                            )}
                        />
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

                <section id="download" className={styles.download}>
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
                                            <MaterialButton
                                                variant="outlined"
                                                icon="download"
                                                onClick={() => triggerDownload(os)}
                                            >
                                                Скачать
                                            </MaterialButton>
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

            <DownloadDialog open={dialogOpen} onOpenChange={setDialogOpen} os={dialogOs} />
            <HomeFooter />
        </div>
    );
}
