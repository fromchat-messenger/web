import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useChatStore } from "@/state/chat";
import { useUserStore } from "@/state/user";
import { usePresenceStore } from "@/state/presence";
import { useProfileStore } from "@/state/profile";
import { MessagePanel, type MessagePanelState } from "./panels/MessagePanel";
import { ChatMessages } from "./ChatMessages";
import { ChatInputWrapper } from "./ChatInputWrapper";
import { ProfileDialog } from "@/pages/chat/ui/ProfileDialog";
import { setGlobalMessageHandler } from "@/core/websocket";
import type { Message, WebSocketMessage } from "@/core/types";
import defaultAvatar from "@/images/default-avatar.png";
import { DMPanel } from "./panels/DMPanel";
import useCall from "@/pages/chat/hooks/useCall";
import { TypingIndicator } from "./TypingIndicator";
import { OnlineStatus } from "./OnlineStatus";
import { typingManager } from "@/core/typingManager";
import { PublicChatPanel } from "./panels/PublicChatPanel";
import { MaterialIcon, MaterialIconButton } from "@/utils/material";
import styles from "@/pages/chat/css/layout.module.scss";
import rightPanelStyles from "@/pages/chat/css/right-panel.module.scss";

interface MessagePanelRendererProps {
    panel: MessagePanel | null;
}

function ChatHeaderText({ panel }: { panel: MessagePanel | null }) {
    const { typingUsers, dmTypingUsers } = usePresenceStore();
    const { user } = useUserStore();
    const otherTypingUsers = useMemo(() => {
        return Array
            .from(typingUsers.entries())
            .filter(([userId, username]) => userId !== user.currentUser?.id && username)
            .map(([, username]) => username!);
    }, [typingUsers, user.currentUser?.id]);

    let content: ReactNode;

    if (panel instanceof DMPanel) {
        const recipientId = panel.getRecipientId()!;
        const isTyping = dmTypingUsers.get(recipientId);

        content = isTyping ? <TypingIndicator typingUsers={[]} /> : <OnlineStatus userId={recipientId} />;
    } else if (panel instanceof PublicChatPanel && otherTypingUsers.length > 0) {
        content = <TypingIndicator typingUsers={otherTypingUsers} />;
    } else {
        return null;
    }

    return <div>{content}</div>;
}

export function MessagePanelRenderer({ panel }: MessagePanelRendererProps) {
    const { applyPendingPanel, isSwitching, pendingPanel, activePanel, setIsSwitching } = useChatStore();
    const { setProfileDialog } = useProfileStore();
    const messagePanelRef = useRef<HTMLDivElement>(null);
    const [panelState, setPanelState] = useState<MessagePanelState | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const previousMessageCountRef = useRef(0);
    const messagesContainerRef = useRef<HTMLElement | null>(null);
    const isLoadingMoreRef = useRef(false);
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    const [replyToVisible, setReplyToVisible] = useState(Boolean(replyTo));
    const [editMessage, setEditMessage] = useState<Message | null>(null);
    const [editVisible, setEditVisible] = useState(Boolean(editMessage));
    const [pendingAction, setPendingAction] = useState<null | { type: "reply" | "edit"; message: Message }>(null);
    const { initiateCall } = useCall();


    // Drag & drop
    const [isDragging, setIsDragging] = useState(false);
    const dragCounterRef = useRef(0);
    const addFilesRef = useRef<null | ((files: File[]) => void)>(null);

    useEffect(() => {
        if (!panel || !panelState) return;

        return () => {
            dragCounterRef.current = 0;
            setIsDragging(false);
        };
    }, [panel, panelState]);

    useEffect(() => {
        if (replyTo) {
            setReplyToVisible(true);
        }
    }, [replyTo]);

    useEffect(() => {
        if (editMessage) {
            setEditVisible(true);
        }
    }, [editMessage]);

    // Handle scroll detection for infinite loading
    useEffect(() => {
        if (!panel || !panelState) return;

        const messagesContainer = document.getElementById("chat-messages");
        if (!messagesContainer) return;

        messagesContainerRef.current = messagesContainer;

        const handleScroll = async () => {
            if (!panel || !panelState || isLoadingMoreRef.current) return;
            
            const container = messagesContainerRef.current;
            if (!container) return;

            // Check if scrolled to top (within 100px threshold)
            if (container.scrollTop <= 100 && panelState.hasMoreMessages && !panelState.isLoadingMore) {
                isLoadingMoreRef.current = true;
                const previousScrollHeight = container.scrollHeight;
                
                try {
                    await panel.loadMoreMessages();
                    
                    // Preserve scroll position after loading
                    requestAnimationFrame(() => {
                        if (container) {
                            const newScrollHeight = container.scrollHeight;
                            container.scrollTop = newScrollHeight - previousScrollHeight;
                        }
                        isLoadingMoreRef.current = false;
                    });
                } catch (error) {
                    console.error("Error loading more messages:", error);
                    isLoadingMoreRef.current = false;
                }
            }
        };

        messagesContainer.addEventListener("scroll", handleScroll);
        return () => {
            messagesContainer.removeEventListener("scroll", handleScroll);
        };
    }, [panel, panelState]);

    // Handle panel state changes
    useEffect(() => {
        if (panel) {
            setPanelState(panel.getState());

            // Store the handler for cleanup
            panel.onStateChange = (newState: MessagePanelState) => {
                setPanelState(newState);
            };

            // Set up WebSocket message handler for this panel
            if (panel.handleWebSocketMessage) {
                setGlobalMessageHandler((message: WebSocketMessage<any>) => panel.handleWebSocketMessage(message));
            }
        } else {
            setPanelState(null);
            setGlobalMessageHandler(null);
        }

        return () => {
            if (panel) {
                if (panel.onStateChange) {
                    panel.onStateChange = null;
                }

                if (typeof panel.destroy === 'function') {
                    panel.destroy();
                }
            }
        };
    }, [panel]);

    // Handle chat switching animation
    useEffect(() => {
        if (isSwitching && pendingPanel) {
            // Apply pending panel when animation starts
            applyPendingPanel();
            // End switching state after a brief delay to allow animation
            setTimeout(() => {
                setIsSwitching(false);
            }, 200);
        }
    }, [isSwitching, pendingPanel, applyPendingPanel, setIsSwitching]);

    // Load messages when panel changes and animation is not running
    useEffect(() => {
        if (!activePanel || isSwitching) return;

        const panelState = activePanel.getState();

        if (panelState.messages.length === 0 && !panelState.isLoading) {
            activePanel.loadMessages();
        }
    }, [activePanel, isSwitching]);

    // Scroll to bottom only when new messages are added
    useEffect(() => {
        if (!panelState || isSwitching) return;

        const currentMessageCount = panelState.messages.length;
        const previousMessageCount = previousMessageCountRef.current;

        const el = messagesEndRef.current;
        if (!el) return;

        // Scroll without animation when messages are initially loaded
        if (previousMessageCount === 0 && currentMessageCount > 0 && !panelState.isLoading) {
            el.scrollIntoView({ behavior: "instant", block: "end" });
        }
        // Scroll with animation when a new message is added
        else if (currentMessageCount > previousMessageCount && previousMessageCount > 0) {
            // Defer to next frame to ensure layout is stable
            const id = requestAnimationFrame(() => {
                el.scrollIntoView({ behavior: "smooth", block: "end" });
            });

            return () => cancelAnimationFrame(id);
        }

        // Update the previous message count
        previousMessageCountRef.current = currentMessageCount;
    }, [panelState?.messages, panelState?.isLoading, isSwitching]);

    function handleCallClick() {
        if (panel && panelState && panel.isDm()) {
            const dmPanel = panel as DMPanel;
            const userId = dmPanel.getDMUserId();
            const username = dmPanel.getDMUsername();

            if (userId && username) {
                initiateCall(userId, username);
            }
        }
    };

    async function handleProfileClick() {
        if (!panel) return;

        try {
            const profileData = await panel.getProfile();
            if (profileData) {
                setProfileDialog(profileData);
            }
        } catch (error) {
            console.error("Failed to get profile:", error);
        }
    }

    const panelKey = activePanel?.getState().title || "empty";

    return (
        <div className={styles.chatContainer}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={panelKey}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={rightPanelStyles.chatWrapper}
                >
                    <div
                        ref={messagePanelRef}
                        className={rightPanelStyles.chatMain}
                        onDragEnter={panel ? (e) => {
                            if (!e.dataTransfer) return;
                            e.preventDefault();
                            e.stopPropagation();
                            dragCounterRef.current += 1;
                            // Only show overlay when actual files are dragged
                            const hasFiles = Array.from(e.dataTransfer.types || []).includes("Files");
                            if (hasFiles) setIsDragging(true);
                        } : undefined}
                        onDragOver={panel ? (e) => {
                            if (!e.dataTransfer) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = "copy";
                        } : undefined}
                        onDragLeave={panel ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
                            if (dragCounterRef.current === 0) setIsDragging(false);
                        } : undefined}
                        onDrop={panel ? (e) => {
                            if (!e.dataTransfer) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const files = Array.from(e.dataTransfer.files || []);
                            if (files.length > 0 && addFilesRef.current) {
                                addFilesRef.current(files);
                            }
                            setIsDragging(false);
                            dragCounterRef.current = 0;
                        } : undefined}>
                        <div className={rightPanelStyles.chatHeader}>
                            <img
                                src={panelState?.profilePicture || defaultAvatar}
                                alt="Avatar"
                                className={rightPanelStyles.chatHeaderAvatar}
                                onClick={handleProfileClick}
                                style={{ cursor: panel ? "pointer" : "default" }}
                            />
                            <div className={rightPanelStyles.chatHeaderInfo}>
                                <div className={rightPanelStyles.infoChat}>
                                    <h4 id="chat-name">{panelState?.title || "Выбор чата"}</h4>
                                    <ChatHeaderText panel={panel} />
                                </div>
                                {panel?.isDm() && (
                                    <MaterialIconButton onClick={handleCallClick} icon="call--filled" />
                                )}
                            </div>
                        </div>

                        {panelState?.isLoading ? (
                            <div className={rightPanelStyles.chatMessages} id="chat-messages">
                                <div style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    height: "100%",
                                    color: "var(--mdui-color-on-surface-variant)"
                                }}>
                                    Загрузка сообщений...
                                </div>
                            </div>
                        ) : panelState && panel ? (
                            <>
                                {panelState.isLoadingMore && (
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        padding: "8px",
                                        color: "var(--mdui-color-on-surface-variant)"
                                    }}>
                                        Загрузка...
                                    </div>
                                )}
                                <ChatMessages
                                    messages={panelState.messages}
                                    isDm={panel.isDm()}
                                    onReplySelect={(message) => {
                                        if (editMessage || editVisible) {
                                            setPendingAction({ type: "reply", message: message });
                                            setEditVisible(false); // onCloseEdit will apply pending
                                        } else {
                                            setReplyTo(message);
                                        }
                                    }}
                                    onEditSelect={(message) => {
                                        if (replyTo || replyToVisible) {
                                            setPendingAction({ type: "edit", message: message });
                                            setReplyToVisible(false); // onCloseReply will apply pending
                                        } else {
                                            setEditMessage(message);
                                        }
                                    }}
                                    onDelete={(id) => panel.handleDeleteMessage(id)}
                                    onRetryMessage={(id) => panel.retryMessage(id)}
                                >
                                    <div ref={messagesEndRef} />
                                </ChatMessages>
                            </>
                        ) : (
                            <div className={rightPanelStyles.chatMessages} id="chat-messages">
                                <div style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    height: "100%",
                                    color: "var(--mdui-color-on-surface-variant)"
                                }}>
                                    Выберите чат на боковой панели, чтобы начать переписку
                                </div>
                            </div>
                        )}

                        {panel && (
                            <ChatInputWrapper
                                    onSendMessage={(text, files) => {
                                        panel.handleSendMessage(text, replyTo?.id, files);
                                        setReplyTo(null);
                                    }}
                                    onSaveEdit={(content) => {
                                        if (editMessage) {
                                            panel.handleEditMessage(editMessage.id, content);
                                            setEditMessage(null);
                                        }
                                    }}
                                    replyTo={replyTo}
                                    replyToVisible={replyToVisible}
                                    onClearReply={() => {
                                        setPendingAction(null);
                                        setReplyToVisible(false);
                                    }}
                                    onCloseReply={() => {
                                        setReplyTo(null);
                                        if (pendingAction && pendingAction.type === "edit") {
                                            setEditMessage(pendingAction.message);
                                            setPendingAction(null);
                                        }
                                    }}
                                    editingMessage={editMessage}
                                    editVisible={editVisible}
                                    onClearEdit={() => {
                                        setPendingAction(null);
                                        setEditVisible(false);
                                    }}
                                    onCloseEdit={() => {
                                        setEditMessage(null);
                                        if (pendingAction && pendingAction.type === "reply") {
                                            setReplyTo(pendingAction.message);
                                            setPendingAction(null);
                                        }
                                    }}
                                    onProvideFileAdder={(adder) => { addFilesRef.current = adder; }}
                                    messagePanelRef={messagePanelRef}
                                    onTyping={() => {
                                        if (panel.isDm()) {
                                            const dmPanel = panel as DMPanel;
                                            dmPanel.handleTyping();
                                        } else {
                                            typingManager.sendTyping();
                                        }
                                    }}
                                    onStopTyping={() => {
                                        if (panel.isDm()) {
                                            const dmPanel = panel as DMPanel;
                                            typingManager.stopDmTypingOnMessage(dmPanel.getRecipientId()!);
                                        } else {
                                            typingManager.stopTypingOnMessage();
                                        }
                                    }}
                                />
                        )}
                    </div>

                    {panel && (
                        <AnimatePresence>
                            {isDragging && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.5 }}
                                    className={rightPanelStyles.fileOverlay}
                                >
                                    <div className={rightPanelStyles.fileOverlayWrapper}>
                                        <div className={rightPanelStyles.fileOverlayInner}>
                                            <MaterialIcon name="upload_file" />
                                            <span>Отпустите файл(ы) для добавления</span>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    )}
                </motion.div>
            </AnimatePresence>

            {/* Profile Dialog */}
            <ProfileDialog />
        </div>
    );
}
