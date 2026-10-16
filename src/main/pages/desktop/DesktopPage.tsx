import { Link } from "react-router-dom";
import { MaterialButton } from "@/utils/material";
import { MarketingPageShell } from "@/pages/home/MarketingPageShell";
import { DownloadDialogHost, useAppDownload } from "@/pages/home/useAppDownload";
import { DESKTOP_OS, OS_CONFIG, getOsLabel } from "@/pages/home/os";
import type { DownloadOs } from "@/pages/home/os";
import windowsIcon from "@/images/windows.svg";
import linuxIcon from "@/images/linux.svg";
import macIcon from "@/images/mac.svg";
import desktopScreenshot from "@/images/screenshots/desktop-main.png";
import styles from "@/pages/desktop/desktop.module.scss";

function OsIcon({ os }: { os: DownloadOs }) {
    const iconUrl = os === "windows" ? windowsIcon : os === "linux" ? linuxIcon : macIcon;
    return (
        <span
            className={styles.tableOsIcon}
            style={{ maskImage: `url("${iconUrl}")`, WebkitMaskImage: `url("${iconUrl}")` }}
        />
    );
}

export default function DesktopPage() {
    const { dialogOpen, setDialogOpen, dialogOs, triggerDownload, detectedOs } = useAppDownload();
    const downloadOs = DESKTOP_OS.includes(detectedOs as DownloadOs) ? detectedOs : "windows";

    const scrollToDownload = () => {
        document.getElementById("desktop-download")?.scrollIntoView({ behavior: "smooth" });
    };

    return (
        <MarketingPageShell onScrollToDownload={scrollToDownload}>
            <div className={styles.desktopPage}>
                <section className={`${styles.sectionBlock} ${styles.hero}`}>
                    <div className={styles.heroScreenshot}>
                        <img src={desktopScreenshot} alt="" draggable={false} />
                    </div>
                    <h1 className={styles.heroTitle}>Нативное приложение для Windows, macOS и Linux</h1>
                    <p className={styles.heroBody}>
                        Подключайтесь к своему серверу или публичному — общий чат, личные сообщения, звонки и
                        вложения. Уведомления в трее, когда приложение свёрнуто.
                    </p>
                    <div className={styles.heroActions}>
                        <MaterialButton
                            variant="filled"
                            icon="download"
                            onClick={() => triggerDownload(downloadOs)}
                        >
                            Скачать для {getOsLabel(downloadOs)}
                        </MaterialButton>
                        <MaterialButton variant="outlined" onClick={scrollToDownload}>
                            Все платформы
                        </MaterialButton>
                    </div>
                </section>

                <section className={styles.sectionBlock}>
                    <h2 className={styles.sectionTitle}>Зачем desktop-клиент</h2>
                    <p className={styles.sectionBody}>
                        Тот же FromChat, что на телефоне и в браузере — но как нативное приложение с постоянным
                        соединением и системными уведомлениями.
                    </p>
                    <ul className={styles.benefitsList}>
                        <li>Общий чат и личные сообщения с файлами и изображениями</li>
                        <li>Голосовые и видеозвонки</li>
                        <li>Уведомления в трее при свёрнутом окне</li>
                        <li>Windows, macOS и Linux — одна кодовая база на Compose Multiplatform</li>
                    </ul>
                </section>

                <section id="desktop-download" className={styles.sectionBlock}>
                    <h2 className={styles.sectionTitle}>Скачать</h2>
                    <div className={styles.downloadGroup}>
                        <div className={styles.downloadGroupLabel}>Desktop</div>
                        <div className={styles.downloadList}>
                            {DESKTOP_OS.map((os) => (
                                <div key={os} className={styles.downloadRow}>
                                    <div className={styles.downloadRowInfo}>
                                        <OsIcon os={os} />
                                        <div className={styles.downloadRowText}>
                                            <span className={styles.downloadRowName}>{OS_CONFIG[os].label}</span>
                                            <span className={styles.downloadRowDesc}>
                                                {OS_CONFIG[os].description}
                                            </span>
                                        </div>
                                    </div>
                                    <MaterialButton
                                        variant="outlined"
                                        icon="download"
                                        onClick={() => triggerDownload(os)}
                                    >
                                        Скачать
                                    </MaterialButton>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className={styles.installNote}>
                        <strong>Windows portable:</strong> распаковывается в папку, где виден только{" "}
                        <code>FromChat Portable.exe</code> — остальные файлы скрыты. Данные хранятся рядом в{" "}
                        <code>fromchat-data/</code>.
                    </div>
                    <div className={styles.installNote}>
                        <strong>macOS:</strong> если система блокирует приложение, откройте{" "}
                        <strong>Системные настройки → Конфиденциальность и безопасность</strong> и разрешите
                        запуск.
                    </div>

                    <p className={styles.crossLink}>
                        Также доступно на{" "}
                        <Link to="/" state={{ scrollToDownload: true }}>
                            Android
                        </Link>
                        .
                    </p>
                </section>
            </div>

            <DownloadDialogHost
                dialogOpen={dialogOpen}
                setDialogOpen={setDialogOpen}
                dialogOs={dialogOs}
            />
        </MarketingPageShell>
    );
}
