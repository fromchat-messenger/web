import api from "@/core/api";
import serviceWorker from "./service-worker?worker&url";

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

// Public API functions
export async function initialize(): Promise<boolean> {
    if (isInitialized) {
        return true;
    }

    try {
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
    } catch (error) {
        console.error("Failed to initialize notification service:", error);
        return false;
    }
}

export async function subscribe(token: string): Promise<boolean> {
    if (!isInitialized) {
        return false;
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

export async function showNotification(_payload: NotificationPayload): Promise<boolean> {
    // Notifications are handled by the service worker when push messages are received from the server
    return false;
}

export async function unsubscribe(): Promise<boolean> {
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
    return "serviceWorker" in navigator && "PushManager" in window;
}
