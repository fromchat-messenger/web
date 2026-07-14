/**
 * @fileoverview Application configuration constants
 * @description Contains all configuration values used throughout the application
 * @author Cursor
 * @version 1.0.0
 */

const DEFAULT_API_BASE_URL = import.meta.env.DEV
    ? "http://localhost:8300"
    : "https://api.fromchat.ru";

function resolveApiBaseUrl(): string {
    return import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;
}

function stripUrlProtocol(value: string): string {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function resolveWsHost(apiBaseUrl: string): string {
    const explicit = import.meta.env.VITE_API_WS_BASE_URL;
    if (explicit) {
        return stripUrlProtocol(explicit);
    }

    if (apiBaseUrl.startsWith("/")) {
        const path = apiBaseUrl.replace(/\/$/, "");
        if (typeof window !== "undefined") {
            return `${window.location.host}${path}`;
        }
        return `localhost:8301${path}`;
    }

    try {
        return new URL(apiBaseUrl).host;
    } catch {
        return stripUrlProtocol(apiBaseUrl);
    }
}

function resolveWsProtocol(apiBaseUrl: string): "ws:" | "wss:" {
    if (apiBaseUrl.startsWith("https:")) {
        return "wss:";
    }
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
        return "wss:";
    }
    return "ws:";
}

export const BASE_DOMAIN = "fromchat.ru";
export const API_BASE_URL = resolveApiBaseUrl();
export const API_WS_BASE_URL = resolveWsHost(API_BASE_URL);

export function getChatWebSocketUrl(): string {
    return `${resolveWsProtocol(API_BASE_URL)}//${API_WS_BASE_URL}/chat/ws`;
}

export const PRODUCT_NAME = "FromChat";
export const MINIMUM_WIDTH = 800;
