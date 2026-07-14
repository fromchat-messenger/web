import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import styles from "./css/styled-dialog.module.scss";

interface StyledDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
    onBackdropClick?: () => void;
    className?: string;
    contentClassName?: string;
    afterChildren?: ReactNode;
}

export function StyledDialog({ 
    open, 
    onOpenChange, 
    children, 
    onBackdropClick,
    className = "",
    contentClassName = "",
    afterChildren
}: StyledDialogProps) {
    const transition: Transition = { duration: 0.3, type: "tween", ease: "easeInOut" };

    // Handle ESC key
    useEffect(() => {
        if (open) {
            function handleEsc(e: KeyboardEvent) {
                if (e.key === "Escape") {
                    onOpenChange(false);
                }
            }

            document.addEventListener("keydown", handleEsc);
            return () => document.removeEventListener("keydown", handleEsc);
        }
    }, [open, onOpenChange]);

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.styledDialogBackdrop}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            if (onBackdropClick) {
                                onBackdropClick();
                            } else {
                                onOpenChange(false);
                            }
                        }
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}>
                    <motion.div
                        className={`${styles.styledDialog} ${className}`}
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        transition={transition}>
                        <div className={`${styles.styledDialogContent} ${contentClassName}`}>
                            {children}
                        </div>
                        {afterChildren}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.getElementById("root")!
    );
}
