/**
 * @fileoverview Typing indicator manager for real-time typing status
 * @description Handles typing indicators for public chat and DMs via WebSocket
 * @author Cursor
 * @version 1.0.0
 */

import { request } from "./websocket";
import type {
    TypingWebSocketMessage,
    StopTypingWebSocketMessage,
    DmTypingWebSocketMessage,
    StopDmTypingWebSocketMessage,
    TypingRequest,
    StopTypingRequest,
    DmTypingRequest,
    StopDmTypingRequest
} from "./types";
import { usePresenceStore } from "@/state/presence";

/**
 * Manages typing indicators for public chat and DMs
 */
export class TypingManager {
    private authToken: string | null = null;
    private typingTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private readonly TYPING_TIMEOUT = 3000; // 3 seconds

    /**
     * Set the authentication token for WebSocket requests
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Send typing indicator for public chat
     */
    async sendTyping(): Promise<void> {
        if (!this.authToken) return;

        try {
            const message: TypingRequest = {
                type: "typing",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {}
            };

            await request(message);
            this.scheduleStopTyping("public");
        } catch (error) {
            console.error("Failed to send typing indicator:", error);
        }
    }

    /**
     * Send stop typing indicator for public chat
     */
    async sendStopTyping(): Promise<void> {
        if (!this.authToken) return;

        try {
            const message: StopTypingRequest = {
                type: "stopTyping",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {}
            };

            await request(message);
            this.clearStopTypingTimeout("public");
        } catch (error) {
            console.error("Failed to send stop typing indicator:", error);
        }
    }

    /**
     * Send typing indicator for DM
     */
    async sendDmTyping(recipientId: number): Promise<void> {
        if (!this.authToken) return;

        try {
            const message: DmTypingRequest = {
                type: "dmTyping",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {
                    recipientId
                }
            };

            await request(message);
            this.scheduleStopDmTyping(recipientId);
        } catch (error) {
            console.error("Failed to send DM typing indicator:", error);
        }
    }

    /**
     * Send stop typing indicator for DM
     */
    async sendStopDmTyping(recipientId: number): Promise<void> {
        if (!this.authToken) return;

        try {
            const message: StopDmTypingRequest = {
                type: "stopDmTyping",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {
                    recipientId
                }
            };

            await request(message);
            this.clearStopTypingTimeout(`dm_${recipientId}`);
        } catch (error) {
            console.error("Failed to send stop DM typing indicator:", error);
        }
    }

    /**
     * Handle incoming typing indicator from WebSocket
     */
    handleTyping(message: TypingWebSocketMessage): void {
        const { addTypingUser } = usePresenceStore.getState();
        addTypingUser(message.data.userId, message.data.username);
    }

    /**
     * Handle incoming stop typing indicator from WebSocket
     */
    handleStopTyping(message: StopTypingWebSocketMessage): void {
        const { removeTypingUser } = usePresenceStore.getState();
        removeTypingUser(message.data.userId);
    }

    /**
     * Handle incoming DM typing indicator from WebSocket
     */
    handleDmTyping(message: DmTypingWebSocketMessage): void {
        const { setDmTypingUser } = usePresenceStore.getState();
        setDmTypingUser(message.data.userId, true);
    }

    /**
     * Handle incoming stop DM typing indicator from WebSocket
     */
    handleStopDmTyping(message: StopDmTypingWebSocketMessage): void {
        const { setDmTypingUser } = usePresenceStore.getState();
        setDmTypingUser(message.data.userId, false);
    }

    /**
     * Schedule automatic stop typing after timeout
     */
    private scheduleStopTyping(context: string): void {
        this.clearStopTypingTimeout(context);

        const timeout = setTimeout(async () => {
            if (context === "public") {
                await this.sendStopTyping();
            }
            this.typingTimeouts.delete(context);
        }, this.TYPING_TIMEOUT);

        this.typingTimeouts.set(context, timeout);
    }

    /**
     * Schedule automatic stop DM typing after timeout
     */
    private scheduleStopDmTyping(recipientId: number): void {
        const context = `dm_${recipientId}`;
        this.clearStopTypingTimeout(context);

        const timeout = setTimeout(async () => {
            await this.sendStopDmTyping(recipientId);
            this.typingTimeouts.delete(context);
        }, this.TYPING_TIMEOUT);

        this.typingTimeouts.set(context, timeout);
    }

    /**
     * Clear stop typing timeout
     */
    private clearStopTypingTimeout(context: string): void {
        const timeout = this.typingTimeouts.get(context);
        if (timeout) {
            clearTimeout(timeout);
            this.typingTimeouts.delete(context);
        }
    }

    /**
     * Immediately stop typing for public chat (called when message is sent)
     */
    async stopTypingOnMessage(): Promise<void> {
        this.clearStopTypingTimeout("public");
        await this.sendStopTyping();
    }

    /**
     * Immediately stop DM typing (called when message is sent)
     */
    async stopDmTypingOnMessage(recipientId: number): Promise<void> {
        this.clearStopTypingTimeout(`dm_${recipientId}`);
        await this.sendStopDmTyping(recipientId);
    }

    /**
     * Cleanup all timeouts
     */
    cleanup(): void {
        this.typingTimeouts.forEach(timeout => clearTimeout(timeout));
        this.typingTimeouts.clear();
    }
}

// Global instance
export const typingManager = new TypingManager();
