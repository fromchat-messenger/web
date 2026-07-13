import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Transition, type Variants } from "motion/react";
import { useImmer } from "use-immer";
import type { RegisterRequest } from "@/core/types";
import { useUserStore } from "@/state/user";
import { MaterialButton, MaterialIconButton } from "@/utils/material";
import api from "@/core/api";
import { AuthTextField, type AuthTextFieldHandle } from "./AuthTextField";
import type { Alert, AlertType } from "./Auth";
import { AuthHeader, AlertsContainer } from "./Auth";
import { LegalInlineLinks } from "@/core/legal/LegalInlineLinks";
import styles from "./auth.module.scss";

const registerFieldVariants: Variants = {
    initial: {
        opacity: 0,
        y: 10
    },
    animate: {
        opacity: 1,
        y: 0
    }
};

const registerFieldTransition: Transition = {
    duration: 0.3,
    ease: "easeInOut"
};

const registerButtonVariants: Variants = {
    initial: {
        opacity: 0,
        y: 10
    },
    animate: {
        opacity: 1,
        y: 0
    }
};

const registerButtonTransition: Transition = {
    duration: 0.3,
    delay: 0.6,
    ease: "easeInOut"
};

interface RegisterFormProps {
    onSwitchMode: () => void;
}

export function RegisterForm({ onSwitchMode }: RegisterFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [alerts, updateAlerts] = useImmer<Alert[]>([]);
    const setUser = useUserStore(state => state.setUser);
    const navigate = useNavigate();

    function showAlert(type: AlertType, message: string) {
        updateAlerts((alerts) => { alerts.push({type: type, message: message}) });
    }

    const displayNameElement = useRef<AuthTextFieldHandle>(null);
    const usernameElement = useRef<AuthTextFieldHandle>(null);
    const passwordElement = useRef<AuthTextFieldHandle>(null);
    const confirmPasswordElement = useRef<AuthTextFieldHandle>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (isLoading) return;

        const displayName = displayNameElement.current!.value.trim();
        const username = usernameElement.current!.value.trim();
        const password = passwordElement.current!.value.trim();
        const confirmPassword = confirmPasswordElement.current!.value.trim();

        if (!displayName || !username || !password || !confirmPassword) {
            showAlert("danger", "Пожалуйста, заполните все поля");
            return;
        }

        if (password !== confirmPassword) {
            showAlert("danger", "Пароли не совпадают");
            return;
        }

        if (displayName.length < 1 || displayName.length > 64) {
            showAlert("danger", "Отображаемое имя должно быть от 1 до 64 символов");
            return;
        }

        if (username.length < 3 || username.length > 20) {
            showAlert("danger", "Имя пользователя должно быть от 3 до 20 символов");
            return;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            showAlert("danger", "Имя пользователя может содержать только английские буквы, цифры, дефисы и подчеркивания");
            return;
        }

        if (password.length < 5 || password.length > 50) {
            showAlert("danger", "Пароль должен быть от 5 до 50 символов");
            return;
        }

        setIsLoading(true);

        try {
            const derived = await api.user.auth.deriveAuthSecret(username, password);
            const request: RegisterRequest = {
                display_name: displayName,
                username: username,
                password: derived,
                confirm_password: derived
            }

            try {
                const data = await api.user.auth.register(request);
                setUser(data.token, data.user);

                try {
                    await api.user.auth.ensureKeysOnLogin(password, data.token);
                } catch (e) {
                    console.error("Key setup failed:", e);
                    try {
                        await api.user.auth.syncPublicKeyToServerIfMissing(data.token);
                    } catch (e2) {
                        console.error("Public key re-sync failed:", e2);
                    }
                }

                navigate("/chat");
            } catch (error: any) {
                showAlert("danger", error.message || "Ошибка при регистрации");
            }
        } catch (error: any) {
            showAlert("danger", error.message || "Ошибка соединения с сервером");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <>
            <AuthHeader 
                icon="person_add"
                title="Регистрация"
                subtitle="Создайте новый аккаунт"
            />
            <div className={styles.authBody}>
                <AlertsContainer alerts={alerts} />
                <motion.form onSubmit={handleSubmit}>
                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={registerFieldVariants}
                        transition={registerFieldTransition}
                    >
                        <AuthTextField
                            label="Отображаемое имя"
                            name="display_name"
                            icon="badge--filled"
                            autocomplete="name"
                            maxlength={64}
                            counter
                            required
                            ref={displayNameElement} />
                    </motion.div>
                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={registerFieldVariants}
                        transition={registerFieldTransition}
                    >
                        <AuthTextField
                            label="@Имя пользователя"
                            name="username"
                            icon="person--filled"
                            autocomplete="username"
                            maxlength={20}
                            counter
                            required
                            ref={usernameElement} />
                    </motion.div>
                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={registerFieldVariants}
                        transition={registerFieldTransition}
                    >
                        <AuthTextField
                            label="Пароль"
                            name="password"
                            type="password"
                            toggle-password
                            icon="password--filled"
                            autocomplete="new-password"
                            required
                            ref={passwordElement} />
                    </motion.div>
                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={registerFieldVariants}
                        transition={registerFieldTransition}
                    >
                        <AuthTextField
                            label="Подтвердите пароль"
                            name="confirm_password"
                            type="password"
                            toggle-password
                            icon="password--filled"
                            autocomplete="new-password"
                            required
                            ref={confirmPasswordElement} />
                    </motion.div>

                    <div className={styles.authButtons}>
                        <motion.div
                            initial="initial"
                            animate="animate"
                            variants={registerButtonVariants}
                            transition={registerButtonTransition}
                        >
                            <MaterialIconButton icon="arrow_back" onClick={onSwitchMode} />
                        </motion.div>
                        <motion.div
                            initial="initial"
                            animate="animate"
                            variants={registerButtonVariants}
                            transition={registerButtonTransition}
                        >
                            <MaterialButton type="submit" disabled={isLoading} loading={isLoading} icon="person_add">
                                {isLoading ? "Регистрация..." : "Зарегистрироваться"}
                            </MaterialButton>
                        </motion.div>
                    </div>

                    <LegalInlineLinks />
                    
                </motion.form>
            </div>
        </>
    );
}

