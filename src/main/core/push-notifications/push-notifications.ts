import api from "@/core/api";
import { isElectron } from "@/core/electron/electron";
import { websocket } from "@/core/websocket";
import type { NewMessageWebSocketMessage, WebSocketMessage } from "@/core/types";
import serviceWorker from "./service-worker?worker&url";
import logo from "@/images/logo.svg";

export interface PushSubscriptionData {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export interface NotificationPayload {
    title: string;
    body: string;
    icon?: string;
    image?: string;
    tag?: string;
    data?: any;
}

// Global state
let isInitialized = false;
let registration: ServiceWorkerRegistration | null = null;
let subscription: PushSubscription | null = null;
let isElectronReceiverRunning = false;
let messageListener: ((event: MessageEvent) => void) | null = null;

// Helper functions
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

async function subscribeToWebPush(): Promise<PushSubscription | null> {
    if (!registration) {
        throw new Error("Service Worker not initialized");
    }

    try {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(
                "BPFs0EYyE2XqAuY8vQ8B_ZggkJVhf9NmtKqSPtIKqy7lU0yGcM5qfpBz2ESRxNmC_CPbzoLbhKfF8fkKCFUwIjo"
            ).slice().buffer
        });

        console.log("Push subscription successful");
        return subscription;
    } catch (error) {
        console.error("Push subscription failed:", error);
        return null;
    }
}

async function sendSubscriptionToServer(token: string): Promise<boolean> {
    if (!subscription) {
        throw new Error("No push subscription available");
    }

    const subscriptionData: PushSubscriptionData = {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: arrayBufferToBase64(subscription.getKey("p256dh")!),
            auth: arrayBufferToBase64(subscription.getKey("auth")!)
        }
    };

    try {
        await api.push.subscription.subscribe(subscriptionData, token);
        return true;
    } catch (error) {
        console.error("Failed to send subscription to server:", error);
        return false;
    }
}

async function showMessageNotification(message: any): Promise<void> {
    try {
        await showNotification({
            title: `New message from ${message.username}`,
            body: message.content.length > 100
                ? message.content.substring(0, 100) + "..."
                : message.content,
            icon: message.profile_picture || logo,
            tag: `message_${message.id}`,
            data: {
                type: "public_message",
                message_id: message.id,
                sender_id: message.user_id,
                sender_username: message.username
            }
        });
    } catch (error) {
        console.error("Failed to show message notification:", error);
    }
}

async function handleWebSocketMessage(response: WebSocketMessage<any>): Promise<void> {
    // Handle notifications for new messages
    if (response.type === "newMessage" && response.data) {
        const newResponse = response as NewMessageWebSocketMessage;
        await showMessageNotification(newResponse.data);
    }
}

// Public API functions
export async function initialize(): Promise<boolean> {
    if (isInitialized) {
        return true;
    }

    try {
        if (isElectron) {
            // For Electron, we just need to request permission
            const permission = await window.electronInterface.notifications.requestPermission();
            isInitialized = permission === "granted";
            return isInitialized;
        } else {
            // For web browsers, initialize service worker and push manager
            if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
                console.log("Push messaging is not supported");
                return false;
            }

            try {
                registration = await navigator.serviceWorker.register(serviceWorker, { type: "module" });
                console.log("Service Worker registered successfully");

                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                    await subscribeToWebPush();
                    isInitialized = true;
                }
                return isInitialized;
            } catch (error) {
                console.error("Service Worker registration failed:", error);
                return false;
            }
        }
    } catch (error) {
        console.error("Failed to initialize notification service:", error);
        return false;
    }
}

export async function subscribe(token: string): Promise<boolean> {
    if (!isInitialized) {
        return false;
    }

    if (isElectron) {
        // In Electron, we don't need server-side subscription
        return true;
    }

    // If subscription doesn't exist, try to get it from the push manager or create a new one
    if (!subscription && registration) {
        try {
            // Try to get existing subscription first
            subscription = await registration.pushManager.getSubscription();
            // If no existing subscription, create a new one
            if (!subscription) {
                subscription = await subscribeToWebPush();
            }
        } catch (error) {
            console.error("Failed to get or create subscription:", error);
            subscription = await subscribeToWebPush();
        }
    }

    return await sendSubscriptionToServer(token);
}

export async function showNotification(payload: NotificationPayload): Promise<boolean> {
    if (isElectron) {
        try {
            return await window.electronInterface.notifications.show({
                title: payload.title,
                body: payload.body,
                icon: payload.icon,
                tag: payload.tag
            });
        } catch (error) {
            console.error("Failed to show Electron notification:", error);
            return false;
        }
    }

    // For web browsers, notifications are handled by the service worker
    // when push messages are received from the server
    return false;
}

export async function unsubscribe(): Promise<boolean> {
    if (isElectron) {
        // In Electron, we don't need to unsubscribe from server
        return true;
    }

    if (!subscription) {
        return true;
    }

    try {
        const result = await subscription.unsubscribe();
        subscription = null;
        return result;
    } catch (error) {
        console.error("Failed to unsubscribe:", error);
        return false;
    }
}

export function isSupported(): boolean {
    if (isElectron) {
        return true; // Electron always supports notifications
    }
    return "serviceWorker" in navigator && "PushManager" in window;
}

// Electron-specific functions
export async function startElectronReceiver(): Promise<void> {
    if (!isElectron || isElectronReceiverRunning) {
        return;
    }

    isElectronReceiverRunning = true;

    // Add our own message listener to the existing WebSocket
    messageListener = (event: MessageEvent) => {
        try {
            const response: WebSocketMessage<any> = JSON.parse(event.data);
            handleWebSocketMessage(response);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    };

    websocket.addEventListener('message', messageListener);
}

export function stopElectronReceiver(): void {
    if (!isElectron) {
        return;
    }

    isElectronReceiverRunning = false;

    // Remove our message listener
    if (messageListener) {
        websocket.removeEventListener('message', messageListener);
        messageListener = null;
    }
}