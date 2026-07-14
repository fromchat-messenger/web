import type { Message, WebSocketMessage } from "@/core/types";
import type { UserState, ProfileDialogData } from "@/state/types";
import { alert } from "@/core/components/AlertDialog";

interface HttpError extends Error {
    status?: number;
    detail?: string;
}

export interface MessagePanelState {
    id: string;
    title: string;
    profilePicture?: string;
    online: boolean;
    messages: Message[];
    isLoading: boolean;
    isTyping: boolean;
    hasMoreMessages: boolean;
    isLoadingMore: boolean;
}

export interface MessagePanelCallbacks {
    onSendMessage: (content: string, files: File[]) => void;
    onEditMessage: (messageId: number, content: string) => void;
    onDeleteMessage: (messageId: number) => void;
    onReplyToMessage: (messageId: number, content: string) => void;
    onProfileClick: () => void;
}

export abstract class MessagePanel {
    protected state: MessagePanelState;
    public onStateChange: ((state: MessagePanelState) => void) | null = () => {};
    protected readonly currentUser: UserState;
    private pendingMessages: Map<string, { timeoutId: NodeJS.Timeout; message: Message }> = new Map();

    constructor(
        id: string,
        currentUser: UserState,
    ) {
        this.state = {
            id,
            title: "",
            online: false,
            messages: [],
            isLoading: false,
            isTyping: false,
            hasMoreMessages: false,
            isLoadingMore: false
        };
        this.currentUser = currentUser;
    }

    // Abstract methods that must be implemented by subclasses
    abstract activate(): Promise<void>;
    abstract deactivate(): void;
    abstract loadMessages(): Promise<void>;
    protected abstract sendMessage(content: string, replyToId?: number, files?: File[]): Promise<void>;
    abstract isDm(): boolean;
    abstract handleWebSocketMessage(response: WebSocketMessage<unknown>): Promise<void>;
    abstract getProfile(): Promise<ProfileDialogData | null>;

    // Common methods
    protected updateState(updates: Partial<MessagePanelState>): void {
        this.state = { ...this.state, ...updates };
        if (this.onStateChange) {
            this.onStateChange(this.state);
        }
    }

    protected addMessage(message: Message): void {
        const messageExists = this.state.messages.some(msg => msg.id === message.id);
        if (!messageExists) {
            this.updateState({
                messages: [...this.state.messages, message]
            });
        }
    }

    protected updateMessage(messageId: number, updates: Partial<Message>): void {
        this.updateState({
            messages: this.state.messages.map(msg => {
                // Handle temporary messages (negative IDs) by matching temp ID
                if (messageId === -1 && msg.runtimeData?.sendingState?.tempId) {
                    const pending = this.pendingMessages.get(msg.runtimeData.sendingState.tempId);
                    if (pending) {
                        return { ...pending.message, ...updates };
                    }
                }
                return msg.id === messageId ? { ...msg, ...updates } : msg;
            })
        });
    }

    protected removeMessage(messageId: number): void {
        this.updateState({
            messages: this.state.messages.filter(msg => msg.id !== messageId)
        });
    }

    protected updateMessageReactions(messageId: number, reactions: Message["reactions"]): void {
        this.updateState({
            messages: this.state.messages.map(msg =>
                msg.id === messageId ? { ...msg, reactions } : msg
            )
        });
    }

    protected clearMessages(): void {
        this.updateState({ messages: [] });
    }

    protected setLoading(loading: boolean): void {
        this.updateState({ isLoading: loading });
    }

    protected setTyping(typing: boolean): void {
        this.updateState({ isTyping: typing });
    }

    protected setLoadingMore(loading: boolean): void {
        this.updateState({ isLoadingMore: loading });
    }

    protected setHasMoreMessages(hasMore: boolean): void {
        this.updateState({ hasMoreMessages: hasMore });
    }

    /**
     * Calculate message limit based on viewport height (5x screen height)
     */
    protected calculateMessageLimit(): number {
        const viewportHeight = window.innerHeight;
        return Math.ceil((viewportHeight * 5) / 100);
    }

    /**
     * Load more messages (to be implemented by subclasses)
     */
    abstract loadMoreMessages(): Promise<void>;

    // Getters
    getState(): MessagePanelState {
        return { ...this.state };
    }

    getId(): string {
        return this.state.id;
    }

    getTitle(): string {
        return this.state.title;
    }

    getMessages(): Message[] {
        return [...this.state.messages];
    }

    // ========== PUBLIC API ==========

    // Event handlers
    handleSendMessage(content: string, replyToId?: number, files: File[] = []): void {
        this.sendMessageWithImmediateDisplay(content, replyToId, files);
    }

    async retryMessage(messageId: number): Promise<void> {
        const message = this.getMessages().find(m => m.id === messageId);
        if (!message?.runtimeData?.sendingState?.retryData) return;

        const { content, replyToId, files } = message.runtimeData.sendingState.retryData;

        // Create new temp ID for retry
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Update status back to sending and create new temp message
        const retryMessage: Message = {
            ...message,
            id: -1, // Temporary ID
            // Preserve existing files (which may have blob URLs for display)
            files: message.files,
            runtimeData: {
                ...message.runtimeData,
                sendingState: {
                    status: 'sending',
                    tempId,
                    retryData: {
                        content,
                        replyToId,
                        files: files || []
                    }
                }
            }
        };

        // Update the existing message to sending state
        this.updateState({
            messages: this.state.messages.map(msg => {
                if (msg.id === messageId) {
                    return retryMessage;
                }
                return msg;
            })
        });

        const timeoutId = setTimeout(() => {
            this.handleMessageTimeout(tempId);
        }, 10000);

        this.pendingMessages.set(tempId, { timeoutId, message: retryMessage });

        try {
            await this.sendMessage(content, replyToId, files || []);
            // Note: Success will be handled by WebSocket confirmation
        } catch (error) {
            console.error("Failed to retry message:", error);
            // Clear the timeout since we're handling the failure immediately
            clearTimeout(timeoutId);
            this.pendingMessages.delete(tempId);

            // Update message to failed state directly
            this.updateState({
                messages: this.state.messages.map(msg => {
                    if (msg.runtimeData?.sendingState?.tempId === tempId) {
                        return {
                            ...msg,
                            runtimeData: {
                                ...msg.runtimeData,
                                sendingState: {
                                    ...msg.runtimeData.sendingState,
                                    status: 'failed'
                                }
                            }
                        };
                    }
                    return msg;
                })
            });
        }
    }

    handleMessageConfirmed(tempId: string, confirmedMessage: Message): void {
        const pending = this.pendingMessages.get(tempId);
        if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingMessages.delete(tempId);

            // Replace temporary message with confirmed one
            this.updateState({
                messages: this.state.messages.map(msg => {
                    if (msg.runtimeData?.sendingState?.tempId === tempId) {
                        return {
                            ...confirmedMessage,
                            // Preserve files from the temporary message (which have blob URLs for immediate display)
                            files: msg.files,
                            runtimeData: {
                                ...confirmedMessage.runtimeData,
                                sendingState: {
                                    status: 'sent'
                                }
                            }
                        };
                    }
                    return msg;
                })
            });
        }
    }

    protected deleteMessageImmediately(messageId: number): void {
        this.updateState({
            messages: this.state.messages.filter(msg => msg.id !== messageId)
        });
    }

    destroy(): void {
        // Clear all pending timeouts
        this.pendingMessages.forEach(({ timeoutId }) => {
            clearTimeout(timeoutId);
        });
        this.pendingMessages.clear();
    }

    // ========== PRIVATE METHODS ==========

    // Create and display message immediately with sending state
    private async sendMessageWithImmediateDisplay(content: string, replyToId?: number, files: File[] = []): Promise<void> {
        if (!content.trim() && files.length === 0) return;

        // Create temporary message for immediate display
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tempMessage: Message = {
            id: -1, // Temporary negative ID
            user_id: this.currentUser.currentUser?.id ?? -1,
            username: this.currentUser.currentUser?.username ?? "You",
            content: content.trim(),
            is_read: false,
            is_edited: false,
            timestamp: new Date().toISOString(),
            files: files.map(file => ({
                name: file.name,
                path: URL.createObjectURL(file),
                encrypted: false
            })),
            runtimeData: {
                sendingState: {
                    status: 'sending',
                    tempId,
                    retryData: {
                        content: content.trim(),
                        replyToId,
                        files: [...files]
                    }
                }
            }
        };

        // Add reply reference if present
        if (replyToId) {
            const referencedMessage = this.getMessages().find(m => m.id === replyToId);
            if (referencedMessage) {
                tempMessage.reply_to = referencedMessage;
            }
        }

        // Add message immediately
        this.addMessage(tempMessage);

        // Set up timeout for failure
        const timeoutId = setTimeout(() => {
            this.handleMessageTimeout(tempId);
        }, 10000); // 10 seconds timeout

        // Store pending message
        this.pendingMessages.set(tempId, { timeoutId, message: tempMessage });

        // Actually send the message
        try {
            await this.sendMessage(content, replyToId, files);
            // Message sent successfully - will be updated when WebSocket confirms
        } catch (error) {
            console.error("Failed to send message:", error);
            // Remove the temporary message from display
            this.updateState({
                messages: this.state.messages.filter(msg => 
                    msg.runtimeData?.sendingState?.tempId !== tempId
                )
            });
            this.pendingMessages.delete(tempId);
            clearTimeout(timeoutId);
            
            // Check if error has HTTP status code
            const httpError = error as HttpError;
            const httpStatus = httpError.status;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            console.log("Error details:", { httpStatus, errorMessage, error });
            
            // Check for profanity error: HTTP 422 status (Unprocessable Entity)
            // Also check error message as fallback for WebSocket errors
            if (httpStatus === 422 || errorMessage.includes("inappropriate content")) {
                console.log("Showing profanity error dialog");
                void alert("Your message contains inappropriate content and cannot be sent.");
            } else {
                console.log("Error does not match profanity condition:", { httpStatus, errorMessage });
            }
        }
    }

    // Handle message timeout (10 seconds)
    private handleMessageTimeout(tempId: string): void {
        this.updateMessageToFailed(tempId);
    }

    // Helper method to update message to failed state
    private updateMessageToFailed(tempId: string): void {
        const pending = this.pendingMessages.get(tempId);
        if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingMessages.delete(tempId);

            // Update message to failed state
            this.updateState({
                messages: this.state.messages.map(msg => {
                    if (msg.runtimeData?.sendingState?.tempId === tempId) {
                        return {
                            ...msg,
                            runtimeData: {
                                ...msg.runtimeData,
                                sendingState: {
                                    ...msg.runtimeData.sendingState,
                                    status: 'failed'
                                }
                            }
                        };
                    }
                    return msg;
                })
            });
        }
    }

    abstract handleEditMessage(messageId: number, content: string): Promise<void>;
    abstract handleDeleteMessage(messageId: number): Promise<void>;
}
