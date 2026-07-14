/// <reference lib="webworker" />

import logo from "@/images/logo.svg";

declare const self: ServiceWorkerGlobalScope;

interface NotificationPayload {
    title: string;
    body: string;
    icon?: string;
    image?: string;
    tag?: string;
    data?: any;
}

interface NotificationAction {
    action: string;
    title: string;
}

interface NotificationOptions {
    body: string;
    icon: string;
    badge: string;
    image?: string;
    tag: string;
    data?: any;
    actions: NotificationAction[];
    requireInteraction: boolean;
    silent: boolean;
}

// Service Worker for Push Notifications
self.addEventListener("push", function(event: ExtendableEvent) {
    const pushEvent = event as PushEvent;
    if (pushEvent.data) {
        const data: NotificationPayload = pushEvent.data.json();

        const options: NotificationOptions = {
            body: data.body,
            icon: data.icon || logo,
            badge: logo,
            image: data.image,
            tag: data.tag || "message",
            data: data.data,
            actions: [
                {
                    action: "open",
                    title: "Open Chat"
                },
                {
                    action: "close",
                    title: "Close"
                }
            ],
            requireInteraction: true,
            silent: false
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener("notificationclick", function(event: ExtendableEvent) {
    const notificationEvent = event as NotificationEvent;
    notificationEvent.notification.close();

    if (notificationEvent.action === "open" || !notificationEvent.action) {
        event.waitUntil(
            self.clients.matchAll({ type: "window" }).then(function(clientList: readonly WindowClient[]) {
                // If there's already a window open, focus it
                for (let i = 0; i < clientList.length; i++) {
                    const client = clientList[i];
                    if (client.url === self.location.origin && "focus" in client) {
                        return client.focus();
                    }
                }
                // Otherwise, open a new window
                if (self.clients.openWindow) {
                    return self.clients.openWindow(self.location.origin);
                }
            })
        );
    }
});

self.addEventListener("notificationclose", function(_event: ExtendableEvent) {
    // Handle notification close if needed
});
