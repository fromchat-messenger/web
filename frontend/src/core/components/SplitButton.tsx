import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MaterialIcon, MaterialRipple, useRippleHandlers } from "@/utils/material";
import useWindowSize from "@/core/hooks/useWindowSize";
import styles from "./css/split-button.module.scss";

export type SplitButtonVariant = "filled" | "tonal" | "outlined" | "elevated";

interface SplitButtonProps {
    text: ReactNode;
    icon?: ReactNode | string;
    menu: ReactNode;
    menuOpen: boolean;
    onMenuOpen: (open: boolean) => void;
    onPrimaryClick?: () => void;
    variant?: SplitButtonVariant;
    disabled?: boolean;
    className?: string;
    menuAriaLabel?: string;
}

export function SplitButton({
    text,
    icon,
    menu,
    menuOpen: open,
    onMenuOpen,
    onPrimaryClick,
    variant = "filled",
    disabled = false,
    className = "",
    menuAriaLabel,
}: SplitButtonProps) {
    const [isExiting, setIsExiting] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const menuSegmentRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [menuPosition, setMenuPosition] = useState<{
        top?: number;
        bottom?: number;
        left: number;
        transform: string;
        maxHeight: number;
    } | null>(null);
    const { width: windowWidth, height: windowHeight } = useWindowSize();
    const primaryRipple = useRippleHandlers(disabled);
    const menuRipple = useRippleHandlers(disabled);

    const MENU_GAP = 16;
    const EDGE_PAD = 16;

    const updateMenuPosition = useCallback(() => {
        const anchor = menuSegmentRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const menuEl = menuRef.current;
        const menuWidth = menuEl?.offsetWidth ?? 220;
        const menuHeight = menuEl?.offsetHeight ?? 320;

        const anchorX = rect.left + rect.width / 2;
        let left: number;
        let transform: string;
        let top: number | undefined;
        let bottom: number | undefined;
        let maxHeight: number;

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const availableBelow = vh - rect.bottom - MENU_GAP - EDGE_PAD;
        const availableAbove = rect.top - MENU_GAP - EDGE_PAD;
        const fitsBelow = menuHeight <= availableBelow;
        const fitsAbove = menuHeight <= availableAbove;
        const placeAbove = !fitsBelow && (fitsAbove || availableAbove > availableBelow);

        if (placeAbove) {
            bottom = vh - (rect.top - MENU_GAP);
            maxHeight = Math.max(100, availableAbove);
        } else {
            top = rect.bottom + MENU_GAP;
            maxHeight = Math.max(100, availableBelow);
        }

        if (anchorX - menuWidth / 2 < EDGE_PAD) {
            left = EDGE_PAD;
            transform = "none";
        } else if (anchorX + menuWidth / 2 > vw - EDGE_PAD) {
            left = vw - menuWidth - EDGE_PAD;
            transform = "none";
        } else {
            left = anchorX;
            transform = "translateX(-50%)";
        }

        setMenuPosition({ top, bottom, left, transform, maxHeight });
    }, []);

    const closeMenu = useCallback(() => {
        onMenuOpen(false);
        setIsExiting(true);
    }, [onMenuOpen]);

    useEffect(() => {
        if (!open && !isExiting) {
            setMenuPosition(null);
            return;
        }
        if (!open) return;

        updateMenuPosition();
        window.addEventListener("scroll", updateMenuPosition, true);

        function handleDocumentClick(event: MouseEvent | globalThis.MouseEvent) {
            const target = event.target as Node | null;
            if (!target) return;
            if (rootRef.current?.contains(target)) return;
            if (menuRef.current?.contains(target)) return;
            closeMenu();
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") closeMenu();
        }

        document.addEventListener("mousedown", handleDocumentClick as unknown as EventListener);
        document.addEventListener("touchstart", handleDocumentClick as unknown as EventListener);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("scroll", updateMenuPosition, true);
            document.removeEventListener("mousedown", handleDocumentClick as unknown as EventListener);
            document.removeEventListener("touchstart", handleDocumentClick as unknown as EventListener);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, isExiting, closeMenu, updateMenuPosition, windowWidth, windowHeight]);

    useEffect(() => {
        if (!open) setIsExiting(true);
    }, [open]);

    useLayoutEffect(() => {
        if (open && menuRef.current) {
            updateMenuPosition();
        }
    }, [open, updateMenuPosition]);

    const handlePrimaryClick = () => {
        if (disabled) {
            return;
        }
        onPrimaryClick?.();
    };

    const handleMenuToggle = () => {
        if (disabled) return;
        if (open) closeMenu();
        else onMenuOpen(true);
    };

    const variantClass =
        variant === "tonal"
            ? styles.variantTonal
            : variant === "outlined"
                ? styles.variantOutlined
                : variant === "elevated"
                    ? styles.variantElevated
                    : styles.variantFilled;

    const renderIcon = () => {
        if (!icon) {
            return null;
        }

        if (typeof icon === "string") {
            return <MaterialIcon name={icon} className={styles.leadingIconIcon} />;
        }

        return <span className={styles.leadingIconIcon}>{icon}</span>;
    };

    const rootClasses = [
        styles.splitButton,
        variantClass,
        disabled ? styles.disabled : "",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div
            ref={rootRef}
            className={rootClasses}
            data-open={open ? "true" : "false"}
            aria-disabled={disabled ? "true" : "false"}
        >
            <button
                type="button"
                className={styles.primarySegment}
                onClick={handlePrimaryClick}
                onPointerDown={primaryRipple.onPointerDown}
                onPointerEnter={primaryRipple.onPointerEnter}
                onPointerLeave={primaryRipple.onPointerLeave}
                disabled={disabled}
            >
                <MaterialRipple ref={primaryRipple.rippleRef} />
                <span className={styles.primaryContent}>
                    {icon && <span className={styles.leadingIcon}>{renderIcon()}</span>}
                    <span className={styles.label}>{text}</span>
                </span>
            </button>

            <button
                ref={menuSegmentRef}
                type="button"
                className={styles.menuSegment}
                onClick={handleMenuToggle}
                onPointerDown={menuRipple.onPointerDown}
                onPointerEnter={menuRipple.onPointerEnter}
                onPointerLeave={menuRipple.onPointerLeave}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={menuAriaLabel}
            >
                <MaterialRipple ref={menuRipple.rippleRef} />
                <span className={styles.menuIcon}>
                    <MaterialIcon name="expand_more" />
                </span>
            </button>

            {(open || isExiting) &&
                menuPosition &&
                createPortal(
                    <AnimatePresence onExitComplete={() => setIsExiting(false)}>
                        {open && (
                            <motion.div
                                key="menu"
                                ref={menuRef}
                                className={styles.menu}
                                style={{
                                    position: "fixed",
                                    ...(menuPosition.bottom != null
                                        ? { bottom: menuPosition.bottom }
                                        : { top: menuPosition.top }),
                                    left: menuPosition.left,
                                    transform: menuPosition.transform,
                                    maxHeight: menuPosition.maxHeight,
                                    overflowY: "auto",
                                }}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.16, ease: "easeOut" }}
                            >
                                {menu}
                            </motion.div>
                        )}
                    </AnimatePresence>,
                    document.body
                )}
        </div>
    );
}

