import type React from "react";
import { motion, AnimatePresence } from "motion/react";
import styles from "./auth.module.scss";

export function AuthContainer({ children }: { children?: React.ReactNode }) {
    return (
        <div className={styles.authContainer}>
            <div className={styles.gradientBackground} />
            <motion.div 
                className={styles.authCard}
                initial={{
                    opacity: 0,
                    scale: 0.95,
                    y: 10
                }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0
                }}
                transition={{
                    duration: 0.4,
                    ease: "easeInOut"
                }}
            >
                {children}
            </motion.div>
        </div>
    )
}

export type IconType = "filled" | "outlined";

export interface AuthHeaderIcon {
    name: string;
    type: IconType
}

export interface AuthHeaderProps {
    title: string;
    icon: string | AuthHeaderIcon;
    subtitle: string;
}

export function AuthHeader({ title, icon, subtitle }: AuthHeaderProps) {
    const iconType = typeof icon == "string" ? "filled" : icon.type;
    const iconName = typeof icon == "string" ? icon : icon.name;

    return (
        <motion.div 
            className={styles.authHeader}
            initial={{
                opacity: 0,
                y: -10
            }}
            animate={{
                opacity: 1,
                y: 0
            }}
            transition={{
                duration: 0.4,
                delay: 0.1,
                ease: "easeInOut"
            }}
        >
            <h2>
                <motion.span 
                    className={`material-symbols ${iconType} large`}
                    initial={{
                        opacity: 0,
                        scale: 0.8,
                        rotate: -10
                    }}
                    animate={{
                        opacity: 1,
                        scale: 1,
                        rotate: 0
                    }}
                    transition={{
                        duration: 0.5,
                        delay: 0.2,
                        ease: "easeOut"
                    }}
                >
                    {iconName}
                </motion.span>
                {title}
            </h2>
            <motion.p
                initial={{
                    opacity: 0,
                    y: 10
                }}
                animate={{
                    opacity: 1,
                    y: 0
                }}
                transition={{
                    duration: 0.4,
                    delay: 0.3,
                    ease: "easeInOut"
                }}
            >
                {subtitle}
            </motion.p>
        </motion.div>
    )
}

export type AlertType = "success" | "danger"

export interface Alert {
    type: AlertType;
    message: string;
}

export function AlertsContainer({ alerts }: { alerts: Alert[]}) {
    const displayAlerts = alerts.slice(-3);

    return (
        <div className={styles.alertContainer}>
            <AnimatePresence mode="popLayout">
                {displayAlerts.map((alert, i) => (
                    <motion.div
                        key={`${i}-${alert.message}`}
                        className={`${styles.alert} alert-${alert.type}`}
                        initial={{
                            opacity: 0,
                            y: -20,
                            scale: 0.95
                        }}
                        animate={{
                            opacity: 1,
                            y: 0,
                            scale: 1
                        }}
                        exit={{
                            opacity: 0,
                            y: -10,
                            scale: 0.95
                        }}
                        transition={{
                            duration: 0.3,
                            ease: "easeInOut"
                        }}
                        layout
                    >
                        {alert.message}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}