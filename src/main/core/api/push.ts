import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./user/auth";

export interface PushSubscriptionRequest {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export interface PushSubscriptionResponse {
    status: string;
    message: string;
}

export const subscription = {
    /**
     * Subscribes the current user to push notifications
     */
    async subscribe(
        subscription: PushSubscriptionRequest,
        token: string
    ): Promise<PushSubscriptionResponse> {
        const res = await fetch(`${API_BASE_URL}/push/subscribe`, {
            method: "POST",
            headers: getAuthHeaders(token, true),
            body: JSON.stringify(subscription)
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ detail: "Failed to subscribe to push notifications" }));
            throw new Error(error.detail || "Failed to subscribe to push notifications");
        }
        return await res.json();
    },

    /**
     * Unsubscribes the current user from push notifications
     */
    async unsubscribe(token: string): Promise<PushSubscriptionResponse> {
        const res = await fetch(`${API_BASE_URL}/push/unsubscribe`, {
            method: "DELETE",
            headers: getAuthHeaders(token, true)
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ detail: "Failed to unsubscribe from push notifications" }));
            throw new Error(error.detail || "Failed to unsubscribe from push notifications");
        }
        return await res.json();
    }
};

