import { useState, useEffect, useRef, useCallback } from "react";
import { EMOJI_CATEGORIES, getRecentEmojis, addRecentEmoji } from "./emojiData";
import type { Size2D } from "@/core/types";
import styles from "@/pages/chat/css/EmojiMenu.module.scss";

interface BaseEmojiMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onEmojiSelect: (emoji: string) => void;
}

interface StandaloneEmojiMenuProps extends BaseEmojiMenuProps {
    position: Size2D;
    mode: "standalone";
}

interface IntegratedEmojiMenuProps extends BaseEmojiMenuProps {
    mode: "integrated";
}

type EmojiMenuProps = StandaloneEmojiMenuProps | IntegratedEmojiMenuProps;

export function EmojiMenu(props: EmojiMenuProps) {
    const { isOpen, onClose, onEmojiSelect, mode } = props;
    const position = mode === "standalone" ? props.position : undefined;
    const [activeCategory, setActiveCategory] = useState("recent");
    const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
    const menuRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const categoryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const tabsRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    useEffect(() => {
        if (isOpen) {
            setRecentEmojis(getRecentEmojis());
        }
    }, [isOpen]);

    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;

        // Find which category is currently visible
        for (const [categoryName, element] of categoryRefs.current) {
            if (element) {
                const rect = element.getBoundingClientRect();
                const containerRect = scrollRef.current.getBoundingClientRect();

                // Check if category header is in view
                if (rect.top <= containerRect.top + 50 && rect.bottom > containerRect.top + 50) {
                    if (activeCategory !== categoryName) {
                        setActiveCategory(categoryName);
                        scrollTabIntoView(categoryName);
                    }
                    break;
                }
            }
        }
    }, [activeCategory]);

    function scrollToCategory(categoryName: string) {
        const element = categoryRefs.current.get(categoryName);
        if (element && scrollRef.current) {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    function scrollTabIntoView(categoryName: string) {
        const tabElement = tabRefs.current.get(categoryName);
        if (tabElement && tabsRef.current) {
            const tabsRect = tabsRef.current.getBoundingClientRect();
            const tabRect = tabElement.getBoundingClientRect();

            // Check if tab is outside the visible area
            if (tabRect.left < tabsRect.left || tabRect.right > tabsRect.right) {
                tabElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleEscape);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen, onClose]);

    function handleEmojiClick(emoji: string) {
        addRecentEmoji(emoji);
        onEmojiSelect(emoji);
        onClose();
    };


    return (
        <div
            ref={menuRef}
            className={`${styles.emojiMenu} ${isOpen ? styles.open : ""} ${mode === "integrated" ? styles.integrated : ""}`}
            style={{
                pointerEvents: isOpen ? "auto" : "none",
                ...(mode === "standalone" && position ? {
                    position: "fixed",
                    left: position.x,
                    bottom: position.y,
                    zIndex: 1000,
                } : {}),
                ...(mode === "integrated" ? {
                    position: "relative",
                } : {})
            }}
            >
            <div className={styles.emojiMenuHeader}>
            <div ref={tabsRef} className={styles.emojiCategoryTabs}>
                {EMOJI_CATEGORIES.map((category) => (
                    <button
                        key={category.name}
                        ref={(el) => {
                            if (el) tabRefs.current.set(category.name, el);
                        }}
                        className={`${styles.emojiCategoryTab} ${activeCategory === category.name ? styles.active : ""}`}
                        onClick={() => scrollToCategory(category.name)}
                        title={category.name}
                    >
                        <span>{category.icon}</span>
                    </button>
                ))}
            </div>
            </div>

            <div
                ref={scrollRef}
                className={styles.emojiGrid}
                onScroll={handleScroll}
            >
                {EMOJI_CATEGORIES.map((category) => {
                    const emojis = category.name === "recent" ? recentEmojis : category.emojis;

                    return (
                        <div
                            key={category.name}
                            ref={(el) => {
                                if (el) categoryRefs.current.set(category.name, el);
                            }}
                            className={styles.emojiCategorySection}
                        >
                            <h3 className={styles.emojiCategoryTitle}>
                                {category.name.charAt(0).toUpperCase() + category.name.slice(1)}
                            </h3>
                            {emojis.length > 0 ? (
                                <div className={styles.emojiCategoryGrid}>
                                    {emojis.map((emoji, index) => (
                                        <button
                                            key={`${category.name}-${index}`}
                                            className={styles.emojiItem}
                                            onClick={() => handleEmojiClick(emoji)}
                                            title={emoji}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.emojiEmptyState}>
                                    <span>No {category.name} emojis</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
