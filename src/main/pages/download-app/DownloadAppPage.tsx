import { MaterialIcon } from "@/utils/material";
import { Link } from "react-router-dom";
import styles from "./download-app.module.scss";

export default function DownloadAppPage() {
    return (
        <div className={styles.downloadAppScreen}>
            <div className={styles.downloadAppCard}>
                <h1>Скачайте приложение</h1>
                <p>
                    Веб-версия рассчитана на большой экран. Для телефона используйте нативный клиент —
                    Android поддерживается активно.
                </p>
                <div className={styles.downloadAppButtons}>
                    <a href="/download?os=android" className={styles.downloadAppBtn}>
                        <MaterialIcon name="android" />
                        Android
                    </a>
                    <a href="/download?os=ios" className={styles.downloadAppBtnSecondary}>
                        <MaterialIcon name="phone_iphone" />
                        iOS (сайдлоад)
                    </a>
                </div>
                <p>
                    <Link to="/">На главную</Link>
                    {" · "}
                    <Link to="/privacy">Политика конфиденциальности</Link>
                    {" · "}
                    <Link to="/terms">Пользовательское соглашение</Link>
                </p>
                <p>
                    <a href="https://t.me/denis0001-dev">Написать в поддержку</a>
                </p>
            </div>
        </div>
    );
}
