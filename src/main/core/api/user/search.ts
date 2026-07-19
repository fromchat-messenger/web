import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./auth";
import type { User } from "@/core/types";

/**
 * Searches for users by username query
 */
export async function searchUsers(query: string, token: string): Promise<User[]> {
    if (query.length < 2) return [];

    const res = await fetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.users || [];
}

/**
 * Fetches a user by ID
 */
export async function get(userId: number, token: string): Promise<User | null> {
    const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) return null;
    return await res.json();
}


