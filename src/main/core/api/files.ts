import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./user/auth";

export const normal = {
    /**
     * Gets the URL for a normal (unencrypted) file
     */
    url(filename: string): string {
        return `${API_BASE_URL}/uploads/files/normal/${filename}`;
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
        return `${API_BASE_URL}/uploads/files/encrypted/${filename}`;
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

