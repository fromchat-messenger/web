import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MaterialIconButton } from "@/utils/material";
import { KEEP_ANDROID_OPEN_LOCKDOWN_AT, KEEP_ANDROID_OPEN_URL } from "@/pages/home/homeNav";
import styles from "@/pages/home/keep-android-open-banner.module.scss";

const DISMISS_STORAGE_KEY = "fromchat-keep-android-open-banner-dismissed";

const collapseTransition = {
    height: { duration: 0.36, ease: [0.32, 0.72, 0, 1] as const },
    opacity: { duration: 0.24, ease: [0.4, 0, 0.2, 1] as const },
};

function pluralDays(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod100 >= 11 && mod100 <= 14) {
        return "дней";
    }
    if (mod10 === 1) {
        return "день";
    }
    if (mod10 >= 2 && mod10 <= 4) {
        return "дня";
    }
    return "дней";
}

function formatCountdown(distanceMs: number): string {
    if (distanceMs <= 0) {
        return "0 дней";
    }

    const days = Math.floor(distanceMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distanceMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distanceMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distanceMs % (1000 * 60)) / 1000);
    const pad = (value: number) => String(value).padStart(2, "0");

    return `${days} ${pluralDays(days)} · ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function isDismissed(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    return window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1";
}

export function KeepAndroidOpenBanner() {
    const innerRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(() => !isDismissed());
    const [collapsedHeight, setCollapsedHeight] = useState(0);
    const [countdown, setCountdown] = useState(() =>
        formatCountdown(KEEP_ANDROID_OPEN_LOCKDOWN_AT - Date.now()),
    );

    const measureHeight = useCallback(() => {
        const node = innerRef.current;
        if (!node) {
            return 0;
        }

        return Math.ceil(node.getBoundingClientRect().height);
    }, []);

    useLayoutEffect(() => {
        if (!visible) {
            return;
        }

        const updateHeight = () => {
            const nextHeight = measureHeight();
            setCollapsedHeight((current) =>
                Math.abs(current - nextHeight) > 1 ? nextHeight : current,
            );
        };

        updateHeight();

        const observer = new ResizeObserver(updateHeight);
        const node = innerRef.current;
        if (node) {
            observer.observe(node);
        }

        window.addEventListener("resize", updateHeight);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateHeight);
        };
    }, [visible, countdown, measureHeight]);

    useEffect(() => {
        function tick() {
            setCountdown(formatCountdown(KEEP_ANDROID_OPEN_LOCKDOWN_AT - Date.now()));
        }

        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, []);

    function openCampaign() {
        window.open(KEEP_ANDROID_OPEN_URL, "_blank", "noopener,noreferrer");
    }

    function handleDismiss(event: React.MouseEvent) {
        event.stopPropagation();
        setCollapsedHeight(measureHeight());
        window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
        setVisible(false);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openCampaign();
        }
    }

    return (
        <AnimatePresence initial={false}>
            {visible ? (
                <motion.div
                    key="keep-android-open-banner"
                    className={styles.bannerCollapse}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: collapsedHeight, opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={collapseTransition}
                >
                    <div ref={innerRef} className={styles.bannerShell}>
                        <div
                            className={styles.bannerPill}
                            role="link"
                            tabIndex={0}
                            onClick={openCampaign}
                            onKeyDown={handleKeyDown}
                        >
                            <span className={styles.bannerText}>
                                Android может стать закрытой платформой через{" "}
                                <span className={styles.bannerTimer}>{countdown}</span>
                            </span>
                            <MaterialIconButton
                                variant="standard"
                                icon="close"
                                className={styles.bannerClose}
                                title="Закрыть"
                                onClick={handleDismiss}
                            />
                        </div>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
