/**
 * @fileoverview Online status manager for real-time user status tracking
 * @description Handles subscription to user online statuses via WebSocket
 * @author Cursor
 * @version 1.0.0
 */

import { request } from "./websocket";
import type {
    StatusUpdateWebSocketMessage,
    SubscribeStatusWebSocketMessage,
    UnsubscribeStatusWebSocketMessage
} from "./types";
import { usePresenceStore } from "@/state/presence";

export interface UserStatus {
    online: boolean;
    lastSeen: string;
}

/**
 * Manages online status subscriptions and updates
 */
export class OnlineStatusManager {
    private subscribedUsers: Set<number> = new Set();
    private statusCache: Map<number, UserStatus> = new Map();
    private authToken: string | null = null;

    /**
     * Set the authentication token for WebSocket requests
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Subscribe to a user's online status
     */
    async subscribe(userId: number): Promise<void> {
        if (!this.authToken || this.subscribedUsers.has(userId)) {
            return;
        }

        try {
            const message: SubscribeStatusWebSocketMessage = {
                type: "subscribeStatus",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {
                    userId
                }
            };

            await request(message);
            this.subscribedUsers.add(userId);
        } catch (error) {
            console.error(`Failed to subscribe to user ${userId} status:`, error);
        }
    }

    /**
     * Unsubscribe from a user's online status
     */
    async unsubscribe(userId: number): Promise<void> {
        if (!this.authToken || !this.subscribedUsers.has(userId)) {
            return;
        }

        try {
            const message: UnsubscribeStatusWebSocketMessage = {
                type: "unsubscribeStatus",
                credentials: {
                    scheme: "Bearer",
                    credentials: this.authToken
                },
                data: {
                    userId
                }
            };

            await request(message);
            this.subscribedUsers.delete(userId);
            this.statusCache.delete(userId);
        } catch (error) {
            console.error(`Failed to unsubscribe from user ${userId} status:`, error);
        }
    }

    /**
     * Handle incoming status update from WebSocket
     */
    handleStatusUpdate(message: StatusUpdateWebSocketMessage): void {
        const { userId, online, lastSeen } = message.data;
        this.statusCache.set(userId, { online, lastSeen });

        // Update the global state
        const { updateOnlineStatus } = usePresenceStore.getState();
        updateOnlineStatus(userId, online, lastSeen);
    }

    /**
     * Get cached status for a user
     */
    getStatus(userId: number): UserStatus | undefined {
        return this.statusCache.get(userId);
    }

    /**
     * Get all cached statuses
     */
    getAllStatuses(): Map<number, UserStatus> {
        return new Map(this.statusCache);
    }

    /**
     * Check if subscribed to a user's status
     */
    isSubscribed(userId: number): boolean {
        return this.subscribedUsers.has(userId);
    }

    /**
     * Get all subscribed user IDs
     */
    getSubscribedUsers(): Set<number> {
        return new Set(this.subscribedUsers);
    }

    /**
     * Unsubscribe from all users and clear cache
     */
    async unsubscribeAll(): Promise<void> {
        const unsubscribePromises = Array.from(this.subscribedUsers).map(userId =>
            this.unsubscribe(userId)
        );
        await Promise.all(unsubscribePromises);
        this.subscribedUsers.clear();
        this.statusCache.clear();
    }

    /**
     * Cleanup when component unmounts
     */
    cleanup(): void {
        this.unsubscribeAll();
    }
}

// Global instance
export const onlineStatusManager = new OnlineStatusManager();
