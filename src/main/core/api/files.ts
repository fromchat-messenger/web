import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./user/auth";

/**
 * Resolve a server attachment path to a fetchable URL.
 * Strips a legacy `/api` prefix, then joins to the API base (or same-origin `/api` in the browser).
 */
export function resolveAttachmentUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    let relative = path.startsWith("/") ? path : `/${path}`;
    if (relative.startsWith("/api/") || relative === "/api") {
        relative = relative.slice(4) || "/";
    }
    // Same-origin `/api` keeps Vite/Caddy proxies working for <img> + cookie auth.
    if (typeof window !== "undefined" && !API_BASE_URL.startsWith("http")) {
        const base = API_BASE_URL.replace(/\/$/, "") || "/api";
        return `${base}${relative}`;
    }
    if (typeof window !== "undefined") {
        return `/api${relative}`;
    }
    return `${API_BASE_URL.replace(/\/$/, "")}${relative}`;
}

export const normal = {
    /**
     * Gets the URL for a normal (unencrypted) file
     */
    url(filename: string): string {
        return resolveAttachmentUrl(`/uploads/files/normal/${filename}`);
    },

    /**
     * Fetches a normal file (unencrypted)
     */
    async fetch(filename: string, token: string): Promise<Blob> {
        const res = await fetch(this.url(filename), {
            headers: getAuthHeaders(token, false)
        });
        if (!res.ok) throw new Error("Failed to fetch file");
        return await res.blob();
    }
};

export const encrypted = {
    /**
     * Gets the URL for an encrypted file
     */
    url(filename: string): string {
        return resolveAttachmentUrl(`/uploads/files/encrypted/${filename}`);
    },

    /**
     * Fetches an encrypted file
     */
    async fetch(filename: string, token: string): Promise<Blob> {
        const res = await fetch(this.url(filename), {
            headers: getAuthHeaders(token, false)
        });
        if (!res.ok) throw new Error("Failed to fetch encrypted file");
        return await res.blob();
    }
};

