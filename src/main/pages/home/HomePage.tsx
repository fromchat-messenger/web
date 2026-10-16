import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import styles from "@/pages/home/home.module.scss";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import { CodeBlock } from "@/core/components/CodeBlock";
import { MarketingPageShell } from "@/pages/home/MarketingPageShell";
import { DownloadDialogHost, useAppDownload } from "@/pages/home/useAppDownload";
import {
    DESKTOP_OS,
    MOBILE_OS,
    OS_CONFIG,
    getOsLabel,
    isDesktopOs,
    type DownloadOs,
} from "@/pages/home/os";
import { GITHUB_BACKEND, GITHUB_ORG, FROMCHAT_GIT, SELF_HOST_COMMANDS } from "@/pages/home/homeNav";
import githubIcon from "@/images/github.svg";
import giteaIcon from "@/images/gitea.svg";
import windowsIcon from "@/images/windows.svg";
import linuxIcon from "@/images/linux.svg";
import macIcon from "@/images/mac.svg";
import publicChatScreenshot from "@/images/screenshots/public-chat.png";
import dmScreenshot from "@/images/screenshots/dm.png";

function OsRowIcon({ os }: { os: DownloadOs }) {
    if (os === "windows" || os === "linux" || os === "macos" || os === "ios") {
        const iconUrl =
            os === "windows"
                ? windowsIcon
                : os === "linux"
                  ? linuxIcon
                  : macIcon;
        return (
            <span
                className={styles.downloadLeadingIcon}
                style={{ maskImage: `url("${iconUrl}")`, WebkitMaskImage: `url("${iconUrl}")` }}
            />
        );
    }

    return <MaterialIcon name={OS_CONFIG[os].icon} className={styles.downloadLeadingIconMaterial} />;
}

function DownloadRow({
    os,
    onDownload,
    recommended = false,
}: {
    os: DownloadOs;
    onDownload: (os: DownloadOs) => void;
    recommended?: boolean;
}) {
    const info = OS_CONFIG[os];
    const rowClassName = [
        styles.downloadRow,
        recommended ? styles.downloadRowRecommended : "",
        info.maintained ? "" : styles.downloadRowMuted,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <li className={rowClassName}>
            <div className={styles.downloadRowLeading}>
                <OsRowIcon os={os} />
            </div>
            <div className={styles.downloadRowText}>
                <span className={styles.downloadRowName}>
                    {info.label}
                    {recommended ? (
                        <span className={styles.downloadRowBadge}>Рекомендуется</span>
                    ) : null}
                </span>
                <span className={styles.downloadRowDesc}>{info.description}</span>
            </div>
            <MaterialButton
                variant={recommended ? "filled" : "text"}
                icon="download"
                onClick={() => onDownload(os)}
            >
                Скачать
            </MaterialButton>
        </li>
    );
}

function FeatureSection({
    title,
    body,
    screenshot,
    reverse = false,
}: {
    title: string;
    body: string;
    screenshot: string;
    reverse?: boolean;
}) {
    return (
        <section className={`${styles.section} ${styles.feature}${reverse ? ` ${styles.featureReverse}` : ""}`}>
            <div className={styles.featureText}>
                <h2 className={styles.featureTitle}>{title}</h2>
                <p className={styles.featureBody}>{body}</p>
            </div>
            <div className={styles.featureImageWrap}>
                <img src={screenshot} alt="" className={styles.featureImage} draggable={false} />
            </div>
        </section>
    );
}

export default function HomePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { isMobile } = useDownloadAppScreen();
    const { dialogOpen, setDialogOpen, dialogOs, triggerDownload, detectedOs } = useAppDownload();
    const downloadSectionId = "download";

    useEffect(() => {
        const state = location.state as { scrollToDownload?: boolean } | null;
        if (state?.scrollToDownload) {
            document.getElementById(downloadSectionId)?.scrollIntoView({ behavior: "smooth" });
            navigate(location.pathname + location.search, { replace: true, state: null });
        } else if (location.hash === "#download" || location.hash === "#self-host") {
            document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
        }
    }, [location, navigate]);

    const scrollToDownload = () => {
        document.getElementById(downloadSectionId)?.scrollIntoView({ behavior: "smooth" });
    };

    const primaryDownloadOs = isMobile && !isDesktopOs(detectedOs) ? "android" : detectedOs;
    const primaryDownloadLabel = isDesktopOs(primaryDownloadOs)
        ? `Скачать для ${getOsLabel(primaryDownloadOs)}`
        : primaryDownloadOs === "android"
          ? "Скачать для Android"
          : `Скачать для ${getOsLabel(primaryDownloadOs)}`;

    return (
        <MarketingPageShell onScrollToDownload={scrollToDownload}>
            <section id="self-host" className={`${styles.section} ${styles.hero}`}>
                <div className={styles.heroIcon} aria-hidden />
                <h1 className={styles.heroTitle}>Мессенджер, которому можно доверять</h1>
                <p className={styles.heroBody}>
                    Разверните FromChat на своём сервере — в том числе в закрытой сети без доступа в
                    интернет. Переписки, файлы и пользователи остаются у вас. Полный контроль и{" "}
                    <a
                        href={GITHUB_ORG}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.heroInlineLink}
                    >
                        открытый исходный код
                    </a>
                    .
                </p>
                <CodeBlock code={SELF_HOST_COMMANDS} />
                <div className={styles.heroDocsLinks}>
                    <a
                        href={GITHUB_BACKEND}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.heroDocsLink}
                    >
                        <span
                            className={styles.heroDocsIcon}
                            style={{
                                maskImage: `url("${githubIcon}")`,
                                WebkitMaskImage: `url("${githubIcon}")`,
                            }}
                        />
                        GitHub
                    </a>
                    <span className={styles.heroDocsSeparator} aria-hidden />
                    <a
                        href={FROMCHAT_GIT}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.heroDocsLink}
                    >
                        <span
                            className={styles.heroDocsIcon}
                            style={{
                                maskImage: `url("${giteaIcon}")`,
                                WebkitMaskImage: `url("${giteaIcon}")`,
                            }}
                        />
                        FromChat Git
                    </a>
                </div>
            </section>

            <section className={`${styles.section} ${styles.pivot}`}>
                <h2 className={styles.pivotTitle}>Не нужен свой сервер?</h2>
                <p className={styles.pivotBody}>
                    На нашем уже работают общий чат, личные сообщения и звонки — с файлами и
                    картинками. Скачайте приложение или войдите в браузере.
                </p>
                <div className={styles.pivotActions}>
                    <MaterialButton
                        variant="filled"
                        icon="download"
                        onClick={() => triggerDownload(primaryDownloadOs)}
                    >
                        {primaryDownloadLabel}
                    </MaterialButton>
                    {!isMobile ? (
                        <MaterialButton
                            variant="outlined"
                            icon="android"
                            onClick={() => triggerDownload("android")}
                        >
                            Скачать для Android
                        </MaterialButton>
                    ) : null}
                    <Link to="/login" className={styles.secondaryLink}>
                        Открыть в браузере
                    </Link>
                </div>
            </section>

            <FeatureSection
                title="Общий чат"
                body="Открытый форум сервера: сообщения в реальном времени, файлы и изображения."
                screenshot={publicChatScreenshot}
            />
            <FeatureSection
                title="Личные сообщения"
                body="Переписка один на один — тоже с файлами и картинками."
                screenshot={dmScreenshot}
                reverse
            />

            <section id={downloadSectionId} className={`${styles.section} ${styles.downloadSection}`}>
                <div className={styles.downloadHeader}>
                    <h2 className={styles.downloadTitle}>Скачать клиент</h2>
                    <p className={styles.downloadSubtitle}>
                        Нативные приложения для ПК и Android — файлы, уведомления и переписка в реальном
                        времени.
                    </p>
                </div>

                <div className={styles.downloadPanel}>
                    <div className={styles.downloadPanelSection}>
                        <div className={styles.downloadPanelHeader}>
                            <MaterialIcon name="computer" className={styles.downloadPanelHeaderIcon} />
                            <span className={styles.downloadPanelHeaderLabel}>ПК</span>
                            <Link to="/desktop" className={styles.downloadPanelLink}>
                                Подробнее
                            </Link>
                        </div>
                        <ul className={styles.downloadList}>
                            {DESKTOP_OS.map((os) => (
                                <DownloadRow
                                    key={os}
                                    os={os}
                                    onDownload={triggerDownload}
                                    recommended={isDesktopOs(detectedOs) && os === detectedOs}
                                />
                            ))}
                        </ul>
                    </div>

                    <div className={styles.downloadPanelSection}>
                        <div className={styles.downloadPanelHeader}>
                            <MaterialIcon name="smartphone" className={styles.downloadPanelHeaderIcon} />
                            <span className={styles.downloadPanelHeaderLabel}>Мобильные</span>
                        </div>
                        <ul className={styles.downloadList}>
                            {MOBILE_OS.map((os) => (
                                <DownloadRow
                                    key={os}
                                    os={os}
                                    onDownload={triggerDownload}
                                    recommended={!isDesktopOs(detectedOs) && os === detectedOs}
                                />
                            ))}
                        </ul>
                    </div>

                    <div className={styles.downloadPanelSection}>
                        <div className={styles.downloadPanelHeader}>
                            <MaterialIcon name="language" className={styles.downloadPanelHeaderIcon} />
                            <span className={styles.downloadPanelHeaderLabel}>Веб</span>
                        </div>
                        <ul className={styles.downloadList}>
                            <li className={styles.downloadRow}>
                                <div className={styles.downloadRowLeading}>
                                    <MaterialIcon name="language" className={styles.downloadLeadingIconMaterial} />
                                </div>
                                <div className={styles.downloadRowText}>
                                    <span className={styles.downloadRowName}>Веб-версия</span>
                                    <span className={styles.downloadRowDesc}>
                                        Открывается в браузере на компьютере — без установки
                                    </span>
                                </div>
                                <MaterialButton
                                    variant="text"
                                    icon="open_in_new"
                                    onClick={() => navigate("/login")}
                                >
                                    Открыть
                                </MaterialButton>
                            </li>
                        </ul>
                    </div>
                </div>
            </section>

            <DownloadDialogHost
                dialogOpen={dialogOpen}
                setDialogOpen={setDialogOpen}
                dialogOs={dialogOs}
            />
        </MarketingPageShell>
    );
}
