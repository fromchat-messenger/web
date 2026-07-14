import { contextBridge, ipcRenderer } from "electron";
import type { ElectronInterface, NotificationShowOptions, Platform } from "./electron.d.ts";

contextBridge.exposeInMainWorld("electronInterface", {
    desktop: true,
    platform: process.platform as Platform,
    notifications: {
        requestPermission: () => ipcRenderer.invoke("request-notification-permission"),
        show: (options: NotificationShowOptions) => ipcRenderer.invoke("show-notification", options)
    }
} satisfies ElectronInterface);