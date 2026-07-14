import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./account";

export interface BlocklistResponse {
    words: string[];
}

export interface BlocklistUpdateRequest {
    words: string[];
}

export interface BlocklistUpdateResponse {
    added?: string[];
    removed?: string[];
    words: string[];
}

/**
 * Fetches the current blocklist (admin only)
 */
export async function getBlocklist(token: string): Promise<BlocklistResponse> {
    const res = await fetch(`${API_BASE_URL}/moderation/blocklist`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) throw new Error("Failed to fetch blocklist");
    return await res.json();
}

/**
 * Adds words to the blocklist (admin only)
 */
export async function addToBlocklist(words: string[], token: string): Promise<BlocklistUpdateResponse> {
    const res = await fetch(`${API_BASE_URL}/moderation/blocklist`, {
        method: "POST",
        headers: getAuthHeaders(token, true),
        body: JSON.stringify({ words })
    });
    if (!res.ok) throw new Error("Failed to add to blocklist");
    return await res.json();
}

/**
 * Removes words from the blocklist (admin only)
 */
export async function removeFromBlocklist(words: string[], token: string): Promise<BlocklistUpdateResponse> {
    const res = await fetch(`${API_BASE_URL}/moderation/blocklist`, {
        method: "DELETE",
        headers: getAuthHeaders(token, true),
        body: JSON.stringify({ words })
    });
    if (!res.ok) throw new Error("Failed to remove from blocklist");
    return await res.json();
}

