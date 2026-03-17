import type { ReactNode } from "react";
import { StyledDialog } from "./StyledDialog";
import { MaterialButton, MaterialIcon } from "@/utils/material";
import { OS_CONFIG, type DownloadOs } from "@/core/downloads/os";
import styles from "./css/download-dialog.module.scss";

interface DownloadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    os: DownloadOs;
}

function AndroidInstructions(): ReactNode {
    return (
        <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Установка на Android</h3>
            <p className={styles.text}>
                Вы скачали APK-файл FromChat. Чтобы установить приложение:
            </p>
            <ul className={styles.list}>
                <li>Откройте загруженный APK-файл из шторки уведомлений или файлового менеджера.</li>
                <li>
                    Если появится запрос &quot;Разрешить установку из неизвестных источников&quot; — дайте
                    разрешение для браузера, из которого вы скачивали APK.
                </li>
                <li>
                    Google Play Protect может предупредить о неизвестном приложении. Если вы доверяете FromChat,
                    нажмите &quot;Подробнее&quot; → &quot;Всё равно установить&quot; (или аналогичную кнопку).
                </li>
                <li>Дождитесь завершения установки и откройте FromChat из списка приложений.</li>
            </ul>
        </div>
    );
}

function IosInstructions(): ReactNode {
    return (
        <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Установка на iOS</h3>
            <p className={styles.text}>
                Эта сборка не распространяется через App Store или TestFlight. Чтобы установить FromChat на iPhone
                или iPad, потребуется один из вариантов сторонней установки:
            </p>
            <ul className={styles.list}>
                <li>
                    <strong>TrollStore</strong>: постоянная установка приложений из IPA-файлов. Требуется поддерживаемая
                    версия iOS и настройка TrollStore на устройстве.
                </li>
                <li>
                    <strong>Джейлбрейк</strong>: установка через менеджер пакетов (Sileo, Cydia и т.п.) или напрямую
                    из файлового менеджера, если у вас уже есть джейлбрейк.
                </li>
                <li>
                    <strong>Другие сервисы сайдлоада</strong>: сторонние инструменты, которые подписывают IPA-файл
                    вашим сертификатом разработчика или временным сертификатом.
                </li>
            </ul>
            <p className={styles.text}>
                К сожалению, простого и официально поддерживаемого пути установки для iOS здесь нет — именно поэтому я
                бы сам iPhone не покупал 😄
            </p>
        </div>
    );
}

function renderInstructions(os: DownloadOs): ReactNode {
    if (os === "android") {
        return <AndroidInstructions />;
    }

    if (os === "ios") {
        return <IosInstructions />;
    }

    return null;
}

export function DownloadDialog({ open, onOpenChange, os }: DownloadDialogProps) {
    const osInfo = OS_CONFIG[os];

    return (
        <StyledDialog
            open={open}
            onOpenChange={onOpenChange}
            className={styles.downloadDialog}
            contentClassName={styles.downloadDialogContent}
            afterChildren={
                <div className={styles.actions}>
                    <MaterialButton variant="filled" onClick={() => onOpenChange(false)}>
                        Закрыть
                    </MaterialButton>
                </div>
            }
        >
            <div className={styles.body}>
                <div className={styles.header}>
                    <div className={styles.iconWrapper}>
                        <MaterialIcon name="download" className={styles.icon} />
                    </div>
                    <div className={styles.titleBlock}>
                        <h2 className={styles.title}>Thanks for downloading</h2>
                        <p className={styles.subtitle}>
                            FromChat для&nbsp;
                            <span className={styles.osName}>{osInfo.label}</span>
                        </p>
                    </div>
                </div>
                {renderInstructions(os)}
            </div>
        </StyledDialog>
    );
}

