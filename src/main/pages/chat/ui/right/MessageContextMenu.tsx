import { useState, useEffect, useRef } from "react";
import type { Message, Size2D } from "@/core/types";
import { EmojiMenu } from "./EmojiMenu";
import { useUserStore } from "@/state/user";
import styles from "@/pages/chat/css/MessageContextMenu.module.scss";

interface MessageContextMenuProps {
    message: Message;
    isAuthor: boolean;
    onEdit: (message: Message) => void;
    onReply: (message: Message) => void;
    onDelete: (message: Message) => void;
    onRetry?: (message: Message) => void;
    onReactionClick?: (messageId: number, emoji: string) => Promise<void>;
    position: Size2D;
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
}

export interface ContextMenuState {
    isOpen: boolean;
    message: Message | null;
    position: Size2D;
}

export function MessageContextMenu({
    message,
    isAuthor,
    onEdit,
    onReply,
    onDelete,
    onRetry,
    onReactionClick,
    position,
    isOpen,
    onOpenChange
}: MessageContextMenuProps) {
    const { user } = useUserStore();
    // Internal state for closing animation
    const [isClosing, setIsClosing] = useState(false);
    const [reactionBarPosition, setReactionBarPosition] = useState<Size2D>({ x: 0, y: 0 });
    const [contextMenuPosition, setContextMenuPosition] = useState<Size2D>(position);
    const [animationClass, setAnimationClass] = useState<keyof typeof styles>(styles.entering);
    const [reactionBarAnimationClass, setReactionBarAnimationClass] = useState<keyof typeof styles>(styles.entering);
    const [isEmojiMenuExpanded, setIsEmojiMenuExpanded] = useState(false);
    const [initialDimensions, setInitialDimensions] = useState<{ width: number; height: number } | null>(null);
    const [expandUpward, setExpandUpward] = useState(false);

    // Refs for measuring actual dimensions
    const reactionBarRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const emojiMenuRef = useRef<HTMLDivElement>(null);

    // Calculate smart positioning when component opens
    useEffect(() => {
        if (isOpen) {
            // Use a small delay to ensure elements are rendered before measuring
            const frameId = requestAnimationFrame(() => {
                if (reactionBarRef.current && contextMenuRef.current) {
                    // Get actual dimensions from DOM elements
                    const reactionBarRect = reactionBarRef.current.getBoundingClientRect();
                    const contextMenuRect = contextMenuRef.current.getBoundingClientRect();

                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;

                    // Calculate shared/combined rect dimensions
                    const sharedRect = {
                        width: Math.max(reactionBarRect.width, contextMenuRect.width),
                        height: reactionBarRect.height + contextMenuRect.height + 10 // 10px margin
                    };

                    let menuX = position.x;
                    let menuY = position.y;
                    let reactionX = position.x;
                    let reactionY = position.y - reactionBarRect.height - 10; // Position above menu
                    let animation: keyof typeof styles = styles.entering;
                    let reactionPositionedRight = false;

                    // Check if reaction bar would overflow at the top
                    if (reactionY < 0) {
                        // Position reaction bar to the right side of the context menu instead
                        reactionX = menuX + contextMenuRect.width + 10;
                        reactionY = menuY; // Align with menu top
                        reactionPositionedRight = true;
                        animation = styles.enteringRight; // Use right-side animation
                    } else {
                        // Try positioning above menu first
                        
                        // Check if shared rect would overflow horizontally
                        if (menuX + sharedRect.width > viewportWidth) {
                            menuX = position.x - contextMenuRect.width;
                            reactionX = menuX;
                            animation = styles.enteringLeft;
                        }
                    }

                    // Ensure menu doesn't go off the left edge
                    if (menuX < 0) {
                        menuX = 0;
                        if (!reactionPositionedRight) {
                            reactionX = menuX;
                        }
                    }

                    // Check if reaction bar positioned to the right would overflow
                    if (reactionPositionedRight && reactionX + reactionBarRect.width > viewportWidth) {
                        // Position to the left side instead
                        reactionX = menuX - reactionBarRect.width - 10;
                    }

                    // Check if shared rect would overflow bottom edge (only if reaction bar is above)
                    if (!reactionPositionedRight && menuY + sharedRect.height > viewportHeight) {
                        menuY = viewportHeight - sharedRect.height;
                        reactionY = menuY - reactionBarRect.height - 10;
                        animation = styles.enteringUp;
                    }

                    // Ensure menu doesn't go off the right edge
                    if (menuX + contextMenuRect.width > viewportWidth) {
                        menuX = viewportWidth - contextMenuRect.width;
                        if (!reactionPositionedRight) {
                            reactionX = menuX;
                        }
                    }

                    setContextMenuPosition({ x: menuX, y: menuY });
                    setReactionBarPosition({ x: reactionX, y: reactionY });
                    setAnimationClass(animation);
                    setReactionBarAnimationClass(animation);
                }
            });

            return () => cancelAnimationFrame(frameId);
        }
    }, [isOpen, position, isAuthor]);

    // Effect to handle clicks outside the context menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (isOpen && !isClosing) {
                // Check if the click is on a context menu element or reaction bar
                const target = event.target as Element;
                // Use refs instead of class selectors for CSS modules
                if ((!contextMenuRef.current || !contextMenuRef.current.contains(target)) && 
                    (!reactionBarRef.current || !reactionBarRef.current.contains(target))) {
                    handleClose();
                }
            }
        };

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape' && isOpen && !isClosing) {
                handleClose();
            }
        };

        function handleWindowBlur() {
            // Close context menu when browser window loses focus
            if (isOpen && !isClosing) {
                handleClose();
            }
        };

        // Add event listeners
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('blur', handleWindowBlur);

        // Cleanup
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [isOpen, isClosing]);

    function handleClose() {
        setIsClosing(true);
        setAnimationClass(styles.closing);
        setReactionBarAnimationClass(styles.closing);

        // Wait for animation to complete before calling onOpenChange
        setTimeout(() => {
            onOpenChange(false);
            setIsClosing(false);
            setAnimationClass(styles.entering); // Reset for next opening
            setReactionBarAnimationClass(styles.entering); // Reset for next opening
            // Reset emoji menu state after context menu animation completes
            setIsEmojiMenuExpanded(false);
            setInitialDimensions(null);
            setExpandUpward(false);
        }, 200); // Match the animation duration from _animations.scss
    }

    interface Action {
        label: string;
        icon: string;
        onClick: () => void;
        show: boolean;
    }

    // Check if message is sending or failed
    const isSending = message.runtimeData?.sendingState?.status === 'sending';
    const isFailed = message.runtimeData?.sendingState?.status === 'failed';
    const isSendingOrFailed = isSending || isFailed;

    const actions: Action[] = [
        {
            label: "Reply",
            icon: "reply",
            onClick: () => {
                onReply(message);
                handleClose();
            },
            show: !isSendingOrFailed
        },
        {
            label: "Edit",
            icon: "edit",
            onClick: () => {
                onEdit(message);
                handleClose();
            },
            show: isAuthor && !isSendingOrFailed
        },
        {
            label: "Retry",
            icon: "refresh",
            onClick: () => {
                if (onRetry) {
                    onRetry(message);
                }
                handleClose();
            },
            show: isAuthor && isFailed && !!onRetry
        },
        {
            label: "Delete",
            icon: "delete",
            onClick: () => {
                onDelete(message);
                handleClose();
            },
            show: isAuthor || user.currentUser?.id === 1
        },
        {
            label: "Copy",
            icon: "content_copy",
            onClick: () => {
                navigator.clipboard.writeText(message.content);
                handleClose();
            },
            show: true
        }
    ];

    // Quick reactions for the reaction bar
    const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

    async function handleReactionClick(emoji: string) {
        if (onReactionClick) {
            await onReactionClick(message.id, emoji);
        }
        handleClose();
    }

    function handleExpandClick() {
        if (!reactionBarRef.current || !contextMenuRef.current) return;

        // Measure the actual dimensions of the reaction bar content
        const reactionBarRect = reactionBarRef.current.getBoundingClientRect();

        setInitialDimensions({ width: reactionBarRect.width, height: reactionBarRect.height });

        // Check if expanding downward would cause overflow
        // Calculate space from the reaction bar's bottom edge downward
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - reactionBarRect.bottom;
        const emojiMenuHeight = 400;

        // Only expand upward if there's not enough space below for the emoji menu
        const shouldExpandUpward = spaceBelow < emojiMenuHeight;
        setExpandUpward(shouldExpandUpward);

        // Use requestAnimationFrame to ensure the dimensions are applied before expansion
        requestAnimationFrame(() => {
            setIsEmojiMenuExpanded(true);
        });
    }

    function handleEmojiSelect(emoji: string) {
        if (onReactionClick) {
            onReactionClick(message.id, emoji);
        }
        handleClose();
    }

    return isOpen && (
        <>
            {/* Reaction Bar */}
            <div
                ref={reactionBarRef}
                className={`${styles.contextMenuReactionBar} ${reactionBarAnimationClass} ${isEmojiMenuExpanded ? styles.expanded : ""} ${expandUpward ? styles.expandUpward : ""}`}
                style={{
                    position: 'fixed',
                    ...(isEmojiMenuExpanded && expandUpward
                        ? {
                            bottom: `${window.innerHeight - reactionBarPosition.y - (initialDimensions?.height || 0)}px`,
                            left: `${reactionBarPosition.x}px`,
                        }
                        : {
                            top: `${reactionBarPosition.y}px`,
                            left: `${reactionBarPosition.x}px`,
                        }
                    ),
                    width: isEmojiMenuExpanded ? '320px' : initialDimensions?.width || 'auto',
                    height: isEmojiMenuExpanded ? '400px' : initialDimensions?.height || 'auto',
                    zIndex: 1001
                }}
                onClick={(e) => e.stopPropagation()}>
                {!isEmojiMenuExpanded ? (
                    <div className={styles.reactionBarContent}>
                        {QUICK_REACTIONS.map((emoji, index) => (
                            <button
                                key={index}
                                className={styles.reactionEmojiButton}
                                onClick={async () => await handleReactionClick(emoji)}
                                title={emoji}
                            >
                                {emoji}
                            </button>
                        ))}
                        <button
                            className={styles.reactionExpandButton}
                            onClick={handleExpandClick}
                            title="More emojis"
                        >
                            <span className="material-symbols">add</span>
                        </button>
                    </div>
                ) : (
                    <div
                        ref={emojiMenuRef}
                        className={styles.emojiMenuWrapper}>
                        <EmojiMenu
                            isOpen={true}
                            onClose={handleClose}
                            onEmojiSelect={handleEmojiSelect}
                            mode="integrated"
                        />
                    </div>
                )}
            </div>

            {/* Context Menu */}
            <div
                ref={contextMenuRef}
                className={`${styles.contextMenu} ${animationClass} ${isEmojiMenuExpanded ? styles.faded : ""}`}
                style={{
                    position: 'fixed',
                    top: `${contextMenuPosition.y}px`,
                    left: `${contextMenuPosition.x}px`,
                    zIndex: 1000
                }}
                onClick={(e) => e.stopPropagation()}>
                {actions.map((action, i) => (
                    action.show && (
                        <div
                            className={styles.contextMenuItem}
                            onClick={action.onClick}
                            key={i}>
                            <span className="material-symbols">{action.icon}</span>
                            {action.label}
                        </div>
                    )
                ))}
            </div>
        </>
    )
}
