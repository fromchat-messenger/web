import { MessagePanel } from "./MessagePanel";
import api from "@/core/api";
import type { DmEncryptedJSON, DmEnvelope, DMWebSocketMessage, EncryptedMessageJson, Message } from "@/core/types";
import type { UserState, ProfileDialogData } from "@/state/types";
import { formatDMUsername } from "@/pages/chat/hooks/useDM";
import { onlineStatusManager } from "@/core/onlineStatusManager";
import { typingManager } from "@/core/typingManager";

export interface DMPanelData {
    userId: number;
    username: string;
    publicKey: string;
    profilePicture?: string;
    online: boolean;
}

export class DMPanel extends MessagePanel {
    public dmData: DMPanelData | null = null;
    private messagesLoaded: boolean = false;

    constructor(
        user: UserState
    ) {
        super("dm", user);
    }

    isDm(): boolean {
        return true;
    }

    getRecipientId(): number | null {
        return this.dmData?.userId || null;
    }

    async activate(): Promise<void> {
        // Don't load messages immediately during activation to prevent animation freeze
        // Messages will be loaded after the animation completes

        // Subscribe to recipient's online status
        if (this.dmData?.userId) {
            onlineStatusManager.subscribe(this.dmData.userId);
        }
    }

    deactivate(): void {
        // Unsubscribe from recipient's online status
        if (this.dmData?.userId) {
            onlineStatusManager.unsubscribe(this.dmData.userId);
        }
    }

    clearMessages(): void {
        super.clearMessages();
        this.messagesLoaded = false;
    }

    private async parseTextPayload(env: DmEnvelope, decryptedMessages: Message[]) {
        console.log("🔔 DMPanel parsing message:", {
            envelopeId: env.id,
            currentUserId: this.currentUser.currentUser?.id,
            envelopeRecipientId: env.recipientId,
            envelopeSenderId: env.senderId
        });
        const plaintext = await api.chats.dm.decrypt(env, this.currentUser.currentUser?.id);
        const username = formatDMUsername(
            env.senderId,
            env.recipientId,
            this.currentUser.currentUser?.id!,
            this.dmData!.username
        );

        // Try parse JSON payload { type: "text", data: { content, files?, reply_to_id? } }
        let content = plaintext;
        let reply_to_id: number | undefined = undefined;
        try {
            const obj = JSON.parse(plaintext) as DmEncryptedJSON;
            if (obj && obj.type === "text" && obj.data) {
                content = obj.data.content;
                reply_to_id = Number(obj.data.reply_to_id) || undefined;
            }
        } catch {}

        const dmMsg: Message = {
            id: env.id,
            user_id: env.senderId,
            content: content,
            username: username,
            timestamp: env.timestamp,
            is_read: false,
            is_edited: false,
            files: env.files?.map(file => { return {"name": file.name, "encrypted": true, "path": file.path} }) || [],
            reactions: env.reactions || [],

            runtimeData: {
                dmEnvelope: env
            }
        };

        if (reply_to_id) {
            const referenced = decryptedMessages.find(m => m.id === reply_to_id);
            if (referenced) dmMsg.reply_to = referenced;
        }

        return dmMsg;
    }

    async loadMessages(): Promise<void> {
        if (!this.currentUser.authToken || !this.dmData || this.messagesLoaded) return;

        this.setLoading(true);
        try {
            const limit = this.calculateMessageLimit();
            const { messages, has_more } = await api.chats.dm.fetchMessages(this.dmData.userId, this.currentUser.authToken, limit);
            const decryptedMessages: Message[] = [];
            let maxIncomingId = 0;

            for (const env of messages) {
                try {
                    const dmMsg = await this.parseTextPayload(env, decryptedMessages);
                    decryptedMessages.push(dmMsg);

                    if (env.senderId === this.dmData!.userId && env.id > maxIncomingId) {
                        maxIncomingId = env.id;
                    }
                } catch (error) {
                    console.error("Error decrypting message:", error);
                }
            }

            this.clearMessages();
            decryptedMessages.forEach(msg => this.addMessage(msg));
            this.setHasMoreMessages(has_more);

            // Update last read ID
            if (maxIncomingId > 0) {
                this.setLastReadId(this.dmData.userId, maxIncomingId);
            }
            this.messagesLoaded = true;
        } catch (error) {
            console.error("Failed to load DM history:", error);
        } finally {
            this.setLoading(false);
        }
    }

    async loadMoreMessages(): Promise<void> {
        if (!this.currentUser.authToken || !this.dmData || !this.state.hasMoreMessages || this.state.isLoadingMore) return;

        const messages = this.getMessages();
        if (messages.length === 0) return;

        const oldestMessage = messages[0];
        const oldestEnvelope = oldestMessage.runtimeData?.dmEnvelope;
        if (!oldestEnvelope) return;

        this.setLoadingMore(true);
        try {
            const limit = this.calculateMessageLimit();
            const { messages: newEnvelopes, has_more } = await api.chats.dm.fetchMessages(
                this.dmData.userId,
                this.currentUser.authToken,
                limit,
                oldestEnvelope.id
            );
            
            if (newEnvelopes && newEnvelopes.length > 0) {
                const decryptedMessages: Message[] = [];
                for (const env of newEnvelopes) {
                    try {
                        const dmMsg = await this.parseTextPayload(env, decryptedMessages);
                        decryptedMessages.push(dmMsg);
                    } catch (error) {
                        console.error("Error decrypting message:", error);
                    }
                }
                
                // Prepend older messages (they come in reverse chronological order)
                this.updateState({
                    messages: [...decryptedMessages.reverse(), ...messages]
                });
            }
            this.setHasMoreMessages(has_more);
        } catch (error) {
            console.error("Failed to load more DM messages:", error);
        } finally {
            this.setLoadingMore(false);
        }
    }

    protected async sendMessage(content: string, replyToId?: number, files: File[] = []): Promise<void> {
        if (!this.currentUser.authToken || !this.dmData || (!content.trim() && files.length === 0)) return;

        if (files.length === 0) {
            await api.chats.dm.send(
                this.dmData.userId,
                this.dmData.publicKey,
                content.trim(),
                this.currentUser.authToken,
                replyToId
            );
        } else {
            await api.chats.dm.sendWithFiles(
                this.dmData.userId,
                this.dmData.publicKey,
                files,
                content.trim(),
                this.currentUser.authToken,
                replyToId
            );
        }
    }

    // Set DM conversation data
    setDMData(dmData: DMPanelData): void {
        this.dmData = dmData;
        this.messagesLoaded = false;
        this.updateState({
            id: `dm-${dmData.userId}`,
            title: dmData.username,
            profilePicture: dmData.profilePicture,
            online: dmData.online
        });
    }


    // Handle incoming WebSocket DM messages
    async handleWebSocketMessage(response: DMWebSocketMessage): Promise<void> {
        if (response.type === "dmNew" && this.dmData) {
            const envelope = response.data;

            // If this is for the active DM conversation
            if (envelope.senderId === this.dmData.userId || envelope.recipientId === this.dmData.userId) {
                try {
                    const dmMsg = await this.parseTextPayload(envelope, this.getMessages());

                    // Check if this is a confirmation of a message we sent
                    const isOurMessage = envelope.senderId !== this.dmData.userId;
                    if (isOurMessage) {
                        // This is our message being confirmed, find the temp message and replace it
                        const tempMessages = this.getMessages().filter(m => m.id === -1 && m.runtimeData?.sendingState?.tempId);
                        for (const tempMsg of tempMessages) {
                            if (tempMsg.runtimeData?.sendingState?.retryData?.content === dmMsg.content) {
                                this.handleMessageConfirmed(tempMsg.runtimeData.sendingState.tempId!, dmMsg);
                                return;
                            }
                        }
                    }

                    this.addMessage(dmMsg);

                    // Update last read if it's from the other user
                    if (envelope.senderId === this.dmData.userId) {
                        this.setLastReadId(this.dmData.userId, Math.max(this.getLastReadId(this.dmData.userId), envelope.id));
                    }
                } catch (error) {
                    console.error("Failed to decrypt incoming DM:", error);
                }
            }
        }
        if (response.type === "dmEdited" && this.dmData) {
            const { id, iv, ciphertext, wrappedMk } = response.data;
            try {
                // Decrypt new content in-place
                const plaintext = await api.chats.dm.decrypt(
                    {
                        id,
                        senderId: 0,
                        recipientId: 0,
                        iv_b64: iv,
                        ciphertext_b64: ciphertext,
                        wrapped_mek_b64: wrappedMk,
                        timestamp: new Date().toISOString()
                    },
                    this.currentUser.currentUser?.id
                );
                let content = plaintext;
                let files: Message["files"] | undefined = undefined;
                try {
                    const obj = JSON.parse(plaintext) as EncryptedMessageJson;
                    if (obj.type === "text" && obj.data) {
                        content = obj.data.content;
                        files = obj.data.files;
                    }
                } catch {}
                const updates: Partial<Message> = { content, is_edited: true, files };
                this.updateMessage(id, updates);
            } catch (e) {
                this.updateMessage(id, { is_edited: true });
            }
        }
        if (response.type === "dmDeleted" && this.dmData) {
            const { id } = response.data;
            this.removeMessage(id);
        }
        if (response.type === "dmReactionUpdate" && this.dmData) {
            const { dm_envelope_id, reactions } = response.data;
            this.updateMessageReactions(dm_envelope_id, reactions);
        }
    };

    // Reset for DM switching
    reset(): void {
        // Unsubscribe from current recipient's status before switching
        if (this.dmData?.userId) {
            onlineStatusManager.unsubscribe(this.dmData.userId);
        }

        this.dmData = null;
        this.messagesLoaded = false;
        this.clearMessages();
        this.updateState({
            id: "dm",
            title: "Select a user",
            profilePicture: undefined,
            online: false
        });
    }

    // Update auth token
    setAuthToken(authToken: string): void {
        this.currentUser.authToken = authToken;
    }

    // Get DM user ID for call functionality
    getDMUserId(): number | null {
        return this.dmData?.userId || null;
    }

    // Get DM username for call functionality
    getDMUsername(): string | null {
        return this.dmData?.username || null;
    }

    // Handle typing in DM
    handleTyping(): void {
        if (this.dmData?.userId) {
            typingManager.sendDmTyping(this.dmData.userId);
        }
    }

    // Helper functions for localStorage
    private getLastReadId(userId: number): number {
        try {
            const v = localStorage.getItem(`dmLastRead:${userId}`);
            return v ? Number(v) : 0;
        } catch {
            return 0;
        }
    }

    private setLastReadId(userId: number, id: number): void {
        try {
            localStorage.setItem(`dmLastRead:${userId}`, String(id));
        } catch {}
    }

    async handleDeleteMessage(messageId: number): Promise<void> {
        if (!this.currentUser.authToken || !this.dmData) return;

        // Remove message immediately from UI
        this.deleteMessageImmediately(messageId);

        // Fire and forget server deletion; UI already updated
        await api.chats.dm.deleteMessage(messageId, this.dmData.userId, this.currentUser.authToken);
    }

    async handleEditMessage(messageId: number, content: string): Promise<void> {
        if (!this.currentUser.authToken || !this.dmData) return;

        try {
            await api.chats.dm.editMessage(
                messageId,
                this.dmData.publicKey,
                content.trim(),
                this.currentUser.authToken
            );

            // Update the message in the UI
            this.updateMessage(messageId, {
                content: content.trim(),
                is_edited: true
            });

            // Send WebSocket updates will be handled by the server
        } catch (error) {
            console.error("Failed to edit DM:", error);
            throw error;
        }
    }

    async getProfile(): Promise<ProfileDialogData | null> {
        if (!this.dmData || !this.currentUser.authToken) return null;

        try {
            const userProfile = await api.user.profile.fetchById(this.currentUser.authToken, this.dmData.userId);
            if (!userProfile) return null;

            return {
                userId: userProfile.id,
                username: userProfile.username,
                display_name: userProfile.display_name,
                profilePicture: userProfile.profile_picture,
                bio: userProfile.bio,
                memberSince: userProfile.created_at,
                online: userProfile.online,
                isOwnProfile: false
            };
        } catch (error) {
            console.error("Failed to fetch user profile:", error);
            return null;
        }
    }

    updateMessageReactions(dmEnvelopeId: number, reactions: any[]): void {
        const messages = this.getMessages();
        const messageIndex = messages.findIndex(msg =>
            msg.runtimeData?.dmEnvelope?.id === dmEnvelopeId
        );

        if (messageIndex !== -1) {
            const updatedMessage = { ...messages[messageIndex] };
            updatedMessage.reactions = reactions;
            this.updateMessage(updatedMessage.id, { reactions: reactions });
        }
    }
}
