import { useNavigate } from "react-router-dom";
import styles from "./not-found.module.scss";
import { MaterialButton, MaterialIcon } from "@/utils/material";

export default function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundContainer}>
                <div className={styles.notFoundContent}>
                    <div className={styles.errorCode}>404</div>
                    <h1>Страница не найдена</h1>
                    <p>
                        К сожалению, запрашиваемая страница не существует или была перемещена.
                    </p>
                    <div className={styles.notFoundActions}>
                        <MaterialButton
                            variant="filled"
                            onClick={() => navigate("/")}
                        >
                            На главную
                        </MaterialButton>
                        <MaterialButton
                            variant="outlined"
                            onClick={() => navigate(-1)}
                        >
                            Назад
                        </MaterialButton>
                    </div>
                </div>
                <div className={styles.notFoundIllustration}>
                    <MaterialIcon name="search_off" />
                </div>
            </div>
        </div>
    );
}
