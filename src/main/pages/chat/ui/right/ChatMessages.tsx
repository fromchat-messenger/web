import { Message } from "./Message";
import { useUserStore } from "@/state/user";
import type { Message as MessageType } from "@/core/types";
import { MessageContextMenu, type ContextMenuState } from "./MessageContextMenu";
import { useState, type ReactNode } from "react";
import { request } from "@/core/websocket";
import type { AddReactionRequest, AddDmReactionRequest } from "@/core/types";
import { confirm } from "mdui/functions/confirm";
import styles from "@/pages/chat/css/right-panel.module.scss";

interface ChatMessagesProps {
    messages?: MessageType[];
    isDm?: boolean;
    children?: ReactNode;
    onReplySelect?: (message: MessageType) => void;
    onEditSelect?: (message: MessageType) => void;
    onDelete?: (id: number) => void;
    onRetryMessage?: (messageId: number) => void;
}

export function ChatMessages({ messages = [], children, isDm = false, onReplySelect, onEditSelect, onDelete, onRetryMessage }: ChatMessagesProps) {
    const { user } = useUserStore();

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        isOpen: false,
        message: null,
        position: { x: 0, y: 0 }
    });

    function handleContextMenu(e: React.MouseEvent, message: MessageType) {
        e.preventDefault();
        setContextMenu({
            isOpen: true,
            message,
            position: { x: e.clientX, y: e.clientY }
        });
    };

    function handleContextMenuOpenChange(isOpen: boolean) {
        setContextMenu(prev => ({
            ...prev,
            isOpen
        }));
    };

    function handleEdit(message: MessageType) {
        if (onEditSelect) onEditSelect(message);
    };

    function handleReply(message: MessageType) {
        if (onReplySelect) onReplySelect(message);
    };

    async function handleDelete(message: MessageType) {
        try {
            await confirm({
                headline: "Удалить сообщение?",
                confirmText: "Удалить",
                cancelText: "Отменить",
                onConfirm: () => onDelete?.(message.id)
            });
        } catch (error) {
            // User cancelled
        }
    }

    function handleRetry(message: MessageType) {
        if (onRetryMessage) {
            onRetryMessage(message.id);
        }
    }

    async function handleReactionClick(messageId: number, emoji: string) {
        if (!user.authToken) return;

        try {
            if (isDm) {
                // For DM messages, we need to find the dm_envelope_id from the message
                const message = messages.find(m => m.id === messageId);
                const dmEnvelopeId = message?.runtimeData?.dmEnvelope?.id;

                if (dmEnvelopeId) {
                    await request<AddDmReactionRequest["data"]>({
                        type: "addDmReaction",
                        credentials: { scheme: "Bearer", credentials: user.authToken },
                        data: {
                            dm_envelope_id: dmEnvelopeId,
                            emoji: emoji
                        }
                    });
                }
            } else {
                // For regular chat messages
                await request<AddReactionRequest["data"]>({
                    type: "addReaction",
                    credentials: { scheme: "Bearer", credentials: user.authToken },
                    data: {
                        message_id: messageId,
                        emoji: emoji
                    }
                });
            }
        } catch (error) {
            console.error("Failed to add reaction:", error);
        }
    }



    return (
        <>
            <div className={styles.chatMessages} id="chat-messages">
                {messages.map((message: MessageType) => (
                    <Message
                        key={message.id}
                        message={message}
                        isAuthor={isDm ?
                            (message.runtimeData?.dmEnvelope?.senderId === user.currentUser?.id) :
                            (message.user_id === user.currentUser?.id)
                        }
                        onContextMenu={handleContextMenu}
                        onReactionClick={handleReactionClick}
                        isDm={isDm} />
                ))}
                {children}
            </div>

            {/* Context Menu */}
            {contextMenu.message && (
                <MessageContextMenu
                    message={contextMenu.message}
                    isAuthor={isDm ?
                        (contextMenu.message.runtimeData?.dmEnvelope?.senderId === user.currentUser?.id) :
                        (contextMenu.message.user_id === user.currentUser?.id)
                    }
                    onEdit={handleEdit}
                    onReply={handleReply}
                    onDelete={handleDelete}
                    onRetry={handleRetry}
                    onReactionClick={handleReactionClick}
                    position={contextMenu.position}
                    isOpen={contextMenu.isOpen}
                    onOpenChange={handleContextMenuOpenChange}
                />
            )}
        </>
    );
}
