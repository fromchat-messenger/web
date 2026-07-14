import { AuthContainer } from "./Auth";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import type { Variants, Transition } from "motion/react";
import styles from "./auth.module.scss";

const MIN_HEIGHT = 400;

const slideVariants: Variants = {
    enter: (direction: number) => ({
        x: direction > 0 ? 300 : -300,
        opacity: 0,
        y: 0 // Ensure no vertical movement
    }),
    center: {
        x: 0,
        opacity: 1,
        y: 0 // Ensure no vertical movement
    },
    exit: (direction: number) => ({
        x: direction > 0 ? -300 : 300,
        opacity: 0,
        y: 0 // Ensure no vertical movement
    })
};

const slideTransition: Transition = {
    x: { 
        type: "spring", 
        stiffness: 300, 
        damping: 30 
    },
    opacity: { duration: 0.2 }
};



export default function AuthPage() {
    const [searchParams] = useSearchParams();
    const { navigate: navigateDownloadApp } = useDownloadAppScreen();
    if (navigateDownloadApp) return navigateDownloadApp;
    const navigate = useNavigate();

    const [direction, setDirection] = useState(0);
    const prevMode = useRef(searchParams.get("mode") || "login");
    const containerRef = useRef<HTMLDivElement>(null);
    const loginFormRef = useRef<HTMLDivElement>(null);
    const registerFormRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState<number>(400);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const currentMode = searchParams.get("mode") || "login";

    useEffect(() => {
        if (prevMode.current !== currentMode) {
            setDirection(currentMode === "register" ? 1 : -1);
            prevMode.current = currentMode;
            setIsTransitioning(true);
        }
    }, [currentMode]);

    // Setup ResizeObserver to watch for content changes
    useEffect(() => {
        const activeRef = currentMode === "login" ? loginFormRef : registerFormRef;

        if (activeRef.current) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const height = entry.contentRect.height;
                    if (height > 0) {
                        setContainerHeight(Math.max(height, MIN_HEIGHT));
                    }
                }
            });

            resizeObserver.observe(activeRef.current);

            // Initial measurement
            const initialHeight = activeRef.current.scrollHeight;
            if (initialHeight > 0) {
                setContainerHeight(Math.max(initialHeight, MIN_HEIGHT));
            }

            return () => {
                resizeObserver.disconnect();
            };
        }
    }, [currentMode]);

    
    function switchMode(newMode: "login" | "register") {
        navigate(`/auth?mode=${newMode}`, { replace: true });
    }

    function handleAnimationComplete() {
        setIsTransitioning(false);
    }


    return (
        <AuthContainer>
            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    width: "100%",
                    height: `${containerHeight}px`,
                    transition: isTransitioning ? "height 0.3s ease" : "none"
                }}
            >
                <AnimatePresence mode="sync" custom={direction}>
                    {currentMode === "login" ? (
                        <motion.div
                            key="login"
                            ref={loginFormRef}
                            custom={direction}
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={slideTransition}
                            onAnimationComplete={handleAnimationComplete}
                            className={styles.formWrapper}
                        >
                            <LoginForm onSwitchMode={() => switchMode("register")} />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="register"
                            ref={registerFormRef}
                            custom={direction}
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={slideTransition}
                            onAnimationComplete={handleAnimationComplete}
                            className={styles.formWrapper}
                        >
                            <RegisterForm onSwitchMode={() => switchMode("login")} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </AuthContainer>
    )
}
