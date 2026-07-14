import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./account";
import type { User } from "@/core/types";

/**
 * Fetches a list of all users (excluding current user)
 */
export async function fetchUsers(token: string): Promise<User[]> {
    const res = await fetch(`${API_BASE_URL}/users`, { headers: getAuthHeaders(token, true) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.users || [];
}

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

