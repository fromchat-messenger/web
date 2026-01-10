import { MessagePanel } from "./MessagePanel";
import { request } from "@/core/websocket";
import type { ChatWebSocketMessage, Message, ReactionUpdateWebSocketMessage } from "@/core/types";
import type { UserState, ProfileDialogData } from "@/state/types";
import api from "@/core/api";

export class PublicChatPanel extends MessagePanel {
    private messagesLoaded: boolean = false;

    constructor(
        chatName: string,
        currentUser: UserState
    ) {
        super(`public-${chatName}`, currentUser);
        this.updateState({
            title: chatName,
            online: true // Public chats are always "online"
        });
    }

    isDm(): boolean {
        return false;
    }

    async activate(): Promise<void> {
        // Don't load messages immediately during activation to prevent animation freeze
        // Messages will be loaded after the animation completes
    }

    deactivate(): void {
        // Public chat doesn't need special cleanup
    }

    clearMessages(): void {
        super.clearMessages();
        this.messagesLoaded = false;
    }

    async loadMessages(): Promise<void> {
        if (!this.currentUser.authToken || this.messagesLoaded) return;

        this.setLoading(true);
        try {
            const limit = this.calculateMessageLimit();
            const { messages, has_more } = await api.chats.general.fetchMessages(this.currentUser.authToken, limit);
            if (messages && messages.length > 0) {
                this.clearMessages();
                messages.forEach((msg: Message) => {
                    this.addMessage(msg);
                });
            }
            this.setHasMoreMessages(has_more);
            this.messagesLoaded = true;
        } catch (error) {
            console.error("Error loading public chat messages:", error);
        } finally {
            this.setLoading(false);
        }
    }

    async loadMoreMessages(): Promise<void> {
        if (!this.currentUser.authToken || !this.state.hasMoreMessages || this.state.isLoadingMore) return;

        const messages = this.getMessages();
        if (messages.length === 0) return;

        const oldestMessage = messages[0];
        this.setLoadingMore(true);
        try {
            const limit = this.calculateMessageLimit();
            const { messages: newMessages, has_more } = await api.chats.general.fetchMessages(
                this.currentUser.authToken,
                limit,
                oldestMessage.id
            );
            if (newMessages && newMessages.length > 0) {
                // Prepend older messages (they come in reverse chronological order)
                this.updateState({
                    messages: [...newMessages.reverse(), ...messages]
                });
            }
            this.setHasMoreMessages(has_more);
        } catch (error) {
            console.error("Error loading more public chat messages:", error);
        } finally {
            this.setLoadingMore(false);
        }
    }

    protected async sendMessage(content: string, replyToId?: number, files: File[] = []): Promise<void> {
        if (!this.currentUser.authToken || (!content.trim() && files.length === 0)) return;

        if (files.length === 0) {
            await api.chats.general.send(content, replyToId ?? null, this.currentUser.authToken);
        } else {
            await api.chats.general.sendWithFiles(content, replyToId ?? null, files, this.currentUser.authToken);
        }
    }

    // Handle incoming WebSocket messages
    async handleWebSocketMessage(response: ChatWebSocketMessage | ReactionUpdateWebSocketMessage): Promise<void> {
        switch (response.type) {
            case 'messageEdited':
                if (response.data) {
                    this.updateMessage(response.data.id, response.data);
                }
                break;
            case 'messageDeleted':
                if (response.data && response.data.message_id) {
                    this.removeMessage(response.data.message_id);
                }
                break;
            case 'newMessage':
                if (response.data) {
                    const newMsg = response.data;

                    // Check if this is a confirmation of a message we sent
                    const isOurMessage = newMsg.user_id === this.currentUser.currentUser?.id;
                    if (isOurMessage) {
                        // This is our message being confirmed, find the temp message and replace it
                        const tempMessages = this.getMessages().filter(m => m.id === -1 && m.runtimeData?.sendingState?.tempId);
                        for (const tempMsg of tempMessages) {
                            if (tempMsg.runtimeData?.sendingState?.retryData?.content === newMsg.content) {
                                this.handleMessageConfirmed(tempMsg.runtimeData.sendingState.tempId!, newMsg);
                                return;
                            }
                        }
                    }

                    this.addMessage(newMsg);
                }
                break;
            case 'reactionUpdate':
                if (response.data) {
                    this.updateMessageReactions(response.data.message_id, response.data.reactions);
                }
                break;
        }
    };

    // Reset for chat switching
    reset(): void {
        this.messagesLoaded = false;
        this.clearMessages();
    }

    // Update chat name
    setChatName(chatName: string): void {
        this.updateState({
            id: `public-${chatName}`,
            title: chatName
        });
    }

    // Update auth token
    setAuthToken(authToken: string): void {
        this.currentUser.authToken = authToken;
    }

    async handleEditMessage(messageId: number, content: string): Promise<void> {
        if (!this.currentUser.authToken) return;
        try {
            await request({
                type: "editMessage",
                data: {
                    message_id: messageId,
                    content: content
                },
                credentials: {
                    scheme: "Bearer",
                    credentials: this.currentUser.authToken
                }
            });
        } catch (error) {
            console.error("Failed to edit message:", error);
        }
    }

    async handleDeleteMessage(id: number): Promise<void> {
        // Remove message immediately from UI
        this.deleteMessageImmediately(id);

        // Fire and forget server deletion; UI already updated
        await request({
            type: "deleteMessage",
            data: { message_id: id },
            credentials: {
                scheme: "Bearer",
                credentials: this.currentUser.authToken!
            }
        });
    }

    async getProfile(): Promise<ProfileDialogData | null> {
        return {
            username: "general",
            display_name: "Общий чат",
            bio: "Общаемся со всеми пользователями FromChat!",
            isOwnProfile: false
        };
    }
}