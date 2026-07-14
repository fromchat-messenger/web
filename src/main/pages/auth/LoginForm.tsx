import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, type Transition, type Variants } from "motion/react";
import { useImmer } from "use-immer";
import type { LoginRequest } from "@/core/types";
import { useUserStore } from "@/state/user";
import { MaterialButton } from "@/utils/material";
import api from "@/core/api";
import { AuthTextField, type AuthTextFieldHandle } from "./AuthTextField";
import { initialize, isSupported, startElectronReceiver, subscribe } from "@/core/push-notifications/push-notifications";
import { isElectron } from "@/core/electron/electron";
import type { Alert, AlertType } from "./Auth";
import { AuthHeader, AlertsContainer } from "./Auth";
import styles from "./auth.module.scss";
import { ensureAuthenticated } from "@/core/websocket";

const loginFieldVariants: Variants = {
    initial: {
        opacity: 0,
        y: 10
    },
    animate: {
        opacity: 1,
        y: 0
    }
};

const loginFieldTransition: Transition = {
    duration: 0.3,
    ease: "easeInOut"
};

const loginButtonVariants: Variants = {
    initial: {
        opacity: 0,
        y: 10
    },
    animate: {
        opacity: 1,
        y: 0
    }
};

const loginButtonTransition: Transition = {
    duration: 0.3,
    delay: 0.4,
    ease: "easeInOut"
};

interface LoginFormProps {
    onSwitchMode: () => void;
}

export function LoginForm({ onSwitchMode }: LoginFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [alerts, updateAlerts] = useImmer<Alert[]>([]);
    const setUser = useUserStore(state => state.setUser);
    const navigate = useNavigate();

    function showAlert(type: AlertType, message: string) {
        updateAlerts((alerts) => { alerts.push({type: type, message: message}) });
    }

    const usernameElement = useRef<AuthTextFieldHandle>(null);
    const passwordElement = useRef<AuthTextFieldHandle>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (isLoading) return;

        const username = usernameElement.current!.value.trim();
        const password = passwordElement.current!.value.trim();

        if (!username || !password) {
            showAlert("danger", "Пожалуйста, заполните все поля");
            return;
        }

        setIsLoading(true);

        try {
            const derived = await api.user.auth.deriveAuthSecret(username, password);
            const request: LoginRequest = {
                username: username,
                password: derived
            }

            try {
                const data = await api.user.auth.login(request);
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

                // Ensure WebSocket is connected and authenticated
                try {
                    await ensureAuthenticated();
                } catch (e) {
                    console.error("WebSocket authentication failed:", e);
                }

                navigate("/chat");

                try {
                    if (isSupported()) {
                        const initialized = await initialize();
                        if (initialized) {
                            await subscribe(data.token);

                            if (isElectron) {
                                await startElectronReceiver();
                            }

                            console.log("Notifications enabled");
                        } else {
                            console.log("Notification permission denied");
                        }
                    } else {
                        console.log("Notifications not supported");
                    }
                } catch (e) {
                    console.error("Notification setup failed:", e);
                }
            } catch (error: any) {
                if (error.message && error.message.includes("suspension")) {
                    const setSuspended = useUserStore.getState().setSuspended;
                    setSuspended(error.message || "No reason provided");
                    return;
                }
                showAlert("danger", error.message || "Неверное имя пользователя или пароль");
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
                icon="login" 
                title="Добро пожаловать!" 
                subtitle="Войдите в свой аккаунт" 
            />
            <div className={styles.authBody}>
                <AlertsContainer alerts={alerts} />
                <motion.form onSubmit={handleSubmit}>
                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={loginFieldVariants}
                        transition={loginFieldTransition}
                    >
                        <AuthTextField
                            label="@Имя пользователя"
                            name="username"
                            icon="person--filled"
                            autocomplete="username"
                            required
                            ref={usernameElement} />
                    </motion.div>

                    <motion.div
                        initial="initial"
                        animate="animate"
                        variants={loginFieldVariants}
                        transition={loginFieldTransition}
                    >
                        <AuthTextField
                            label="Пароль"
                            name="password"
                            type="password"
                            toggle-password
                            icon="password--filled"
                            autocomplete="current-password"
                            required
                            ref={passwordElement} />
                    </motion.div>

                    <div className={styles.authButtons}>
                        <motion.div
                            initial="initial"
                            animate="animate"
                            variants={loginButtonVariants}
                            transition={loginButtonTransition}
                        >
                            <MaterialButton type="submit" disabled={isLoading}>
                                {isLoading ? "Вход..." : "Войти"}
                            </MaterialButton>
                        </motion.div>
                    </div>
                </motion.form>

                <p className={styles.registerLink}>
                    Ещё нет аккаунта?
                    <a
                        href="#"
                        className="link"
                        onClick={(e) => {
                            e.preventDefault();
                            onSwitchMode();
                        }}>
                        Зарегистрируйтесь
                    </a>
                </p>
            </div>
        </>
    );
}

