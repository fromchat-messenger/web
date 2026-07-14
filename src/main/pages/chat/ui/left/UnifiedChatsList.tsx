import { useState, useEffect, useCallback, useMemo } from "react";
import { useUserStore } from "@/state/user";
import { useChatStore } from "@/state/chat";
import { useDM, type DMUser } from "@/pages/chat/hooks/useDM";
import api from "@/core/api";
import { StatusBadge } from "@/core/components/StatusBadge";
import type { Message, VerificationStatus } from "@/core/types";
import { websocket } from "@/core/websocket";
import { onlineStatusManager } from "@/core/onlineStatusManager";
import { OnlineIndicator } from "@/pages/chat/ui/right/OnlineIndicator";
import defaultAvatar from "@/images/default-avatar.png";
import { MaterialBadge, MaterialCircularProgress, MaterialIcon, MaterialList, MaterialListItem } from "@/utils/material";
import { displayNameForUser, isDeletedPeer } from "@/core/userDisplay";
import { DeletedUserAvatar } from "@/core/DeletedUserAvatar";
import styles from "@/pages/chat/css/left-panel.module.scss";

interface PublicChat {
    id: string;
    name: string;
    type: "public";
    lastMessage?: Message;
}

interface DMConversation {
    id: number;
    userId: number;
    username: string;
    display_name: string;
    profile_picture?: string;
    online?: boolean;
    type: "dm";
    lastMessage?: string;
    unreadCount: number;
    publicKey?: string | null;
    verified?: boolean;
    verification_status?: VerificationStatus;
}

type ChatItem = PublicChat | DMConversation;

const PUBLIC_CHAT: PublicChat = { 
    id: "general",
    name: "Общий чат", 
    type: "public" 
};

export function UnifiedChatsList() {
    const { user } = useUserStore();
    const { switchToPublicChat, switchToDM, activeTab } = useChatStore();
    const { dmUsers, isLoadingUsers, loadUsers } = useDM();
    const [lastMessages, setLastMessages] = useState<Record<string, Message | undefined>>({});

    const loadLastMessages = useCallback(async () => {
        if (!user.authToken) return;

        try {
            const { messages } = await api.chats.general.fetchMessages(user.authToken, 1);
            if (messages?.length > 0) {
                const lastMessage = messages[messages.length - 1];
                setLastMessages({ general: lastMessage });
            }
        } catch (error) {
            console.error("Error loading last messages:", error);
        }
    }, [user.authToken]);

    useEffect(() => {
        if (activeTab === "chats") {
            loadUsers();
            loadLastMessages();
        }
    }, [activeTab, loadUsers, loadLastMessages]);

    const allChats = useMemo<ChatItem[]>(() => {
        return [
            ...dmUsers.map((user: DMUser) => ({
                ...user,
                userId: user.id,
                display_name: displayNameForUser({ ...user, id: user.id }),
                type: "dm" as const
            })), 
            {
                ...PUBLIC_CHAT,
                lastMessage: lastMessages[PUBLIC_CHAT.id]
            }
        ];
    }, [lastMessages, dmUsers]);

    useEffect(() => {
        if (!websocket) return;

        function handleWebSocketMessage(e: MessageEvent) {
            try {
                const msg = JSON.parse(e.data);

                if (msg.type === "newMessage") {
                    const newMessage = msg.data as Message;
                    setLastMessages(prev => ({
                        ...prev,
                        [PUBLIC_CHAT.id]: newMessage
                    }));
                } else if (msg.type === "messageEdited") {
                    const editedMessage = msg.data as Message;
                    setLastMessages(prev => {
                        if (prev[PUBLIC_CHAT.id]?.id === editedMessage.id) {
                            return {
                                ...prev,
                                [PUBLIC_CHAT.id]: editedMessage
                            };
                        }
                        return prev;
                    });
                } else if (msg.type === "messageDeleted") {
                    const deletedMessageId = msg.data?.message_id;
                    setLastMessages(prev => {
                        if (prev[PUBLIC_CHAT.id]?.id === deletedMessageId) {
                            loadLastMessages();
                            return {
                                ...prev,
                                [PUBLIC_CHAT.id]: undefined
                            };
                        }
                        return prev;
                    });
                }
            } catch (error) {
                console.error("Failed to handle WebSocket message in UnifiedChatsList:", error);
            }
        };

        websocket.addEventListener("message", handleWebSocketMessage);
        return () => websocket.removeEventListener("message", handleWebSocketMessage);
    }, [loadLastMessages]);

    useEffect(() => {
        dmUsers.forEach(dmUser => {
            onlineStatusManager.subscribe(dmUser.id);
        });

        return () => {
            dmUsers.forEach(dmUser => {
                onlineStatusManager.unsubscribe(dmUser.id);
            });
        };
    }, [dmUsers]);

    function formatPublicChatMessage(chatId: string): string {
        const lastMessage = lastMessages[chatId];
        if (!lastMessage) return "";

        const isCurrentUser = lastMessage.user_id === user.currentUser?.id;
        const prefix = isCurrentUser ? "Вы: " : `${lastMessage.username}: `;
        const maxLength = 50 - prefix.length;
        const content = lastMessage.content.length > maxLength
            ? lastMessage.content.substring(0, maxLength) + "..."
            : lastMessage.content;

        return prefix + content;
    };

    async function handleDMClick(dmConversation: DMConversation) {
        if (!dmConversation.publicKey) {
            const authToken = useUserStore.getState().user.authToken;
            if (!authToken) return;

            const publicKey = await api.chats.dm.fetchUserPublicKey(dmConversation.id, authToken);
            if (!publicKey) {
                console.error("Failed to get public key for user:", dmConversation.id);
                return;
            }
            dmConversation.publicKey = publicKey;
        }

        await switchToDM({
            userId: dmConversation.id,
            username: dmConversation.username,
            publicKey: dmConversation.publicKey,
            profilePicture: dmConversation.profile_picture,
            online: dmConversation.online || false
        });
    };

    if (isLoadingUsers) {
        return <MaterialCircularProgress />;
    }

    if (user.isSuspended) {
        return (
            <MaterialList className={styles.unifiedChatsList}>
                <MaterialListItem
                    headline="Аккаунт заблокирован"
                    style={{ cursor: "pointer" }}
                >
                    <MaterialIcon name="block--filled" slot="icon" />
                </MaterialListItem>
            </MaterialList>
        );
    }

    return (
        <MaterialList className={styles.unifiedChatsList}>
            {allChats.map((chat) => {
                if (chat.type === "public") {
                    const formattedMessage = formatPublicChatMessage(chat.id);
                    return (
                        <MaterialListItem
                            key={`public-${chat.id}`}
                            headline={chat.name}
                            onClick={() => switchToPublicChat(chat.name)}
                            style={{ cursor: "pointer" }}
                        >
                            {formattedMessage && (
                                <span slot="description" className={styles.listDescription}>
                                    {formattedMessage}
                                </span>
                            )}
                            <img
                                src={defaultAvatar}
                                alt={chat.name}
                                slot="icon"
                                style={{
                                    width: "40px",
                                    height: "40px",
                                    borderRadius: "50%",
                                    objectFit: "cover"
                                }}
                            />
                        </MaterialListItem>
                    );
                }

                const isDeletedDm = isDeletedPeer(chat);
                const displayName = displayNameForUser({ ...chat, id: chat.id });

                return (
                    <MaterialListItem
                        key={`dm-${chat.id}`}
                        headline={displayName}
                        onClick={() => handleDMClick(chat)}
                        style={{ cursor: "pointer" }}
                    >
                        <div slot="headline" className="dm-list-headline">
                            {displayName}
                            {!isDeletedDm && (
                                <StatusBadge
                                    verificationStatus={chat.verification_status}
                                    verified={chat.verified || false}
                                    size="small"
                                />
                            )}
                        </div>
                        <span slot="description" className={styles.listDescription}>
                            {chat.lastMessage || "Нет сообщений"}
                        </span>
                        <div slot="icon" style={{ position: "relative", width: "40px", height: "40px", display: "inline-block" }}>
                            {isDeletedDm ? (
                                <DeletedUserAvatar
                                    userId={chat.id}
                                    className={styles.deletedUserAvatar}
                                    iconClassName={styles.deletedUserAvatarIcon}
                                />
                            ) : (
                                <img
                                    src={chat.profile_picture || defaultAvatar}
                                    alt={displayName}
                                    style={{
                                        width: "40px",
                                        height: "40px",
                                        borderRadius: "50%",
                                        objectFit: "cover",
                                        display: "block"
                                    }}
                                    onError={(e) => {
                                        e.target.src = defaultAvatar;
                                    }}
                                />
                            )}
                            {!isDeletedDm && <OnlineIndicator userId={chat.id} />}
                        </div>
                        {chat.unreadCount > 0 && (
                            <MaterialBadge slot="end-icon">
                                {chat.unreadCount}
                            </MaterialBadge>
                        )}
                    </MaterialListItem>
                );
            })}
        </MaterialList>
    );
}
