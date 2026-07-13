import { MaterialIcon } from "@/utils/material";
import { Link } from "react-router-dom";
import styles from "./download-app.module.scss";

export default function DownloadAppPage() {
    return (
        <div className={styles.downloadAppScreen}>
            <div className={styles.downloadAppCard}>
                <h1>Скачайте приложение</h1>
                <p>
                    Этот сайт не предназначен для работы на маленьких экранах.
                    Выберите вашу платформу:
                </p>
                <div className={styles.downloadAppButtons}>
                    <a href="/download?os=android" className={styles.downloadAppBtn}>
                        <MaterialIcon name="android" />
                        Android
                    </a>
                    <a href="/download?os=ios" className={styles.downloadAppBtn}>
                        <MaterialIcon name="phone_iphone" />
                        iOS
                    </a>
                </div>
                <p>
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
