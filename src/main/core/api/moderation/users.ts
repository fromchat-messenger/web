import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "../user/auth";

/**
 * Toggles verification status for a user (owner only)
 */
export async function verify(userId: number, token: string): Promise<{verified: boolean} | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/user/${userId}/verify`, {
            method: 'POST',
            headers: getAuthHeaders(token, true)
        });

        if (response.ok) {
            return await response.json();
        }

        return null;
    } catch (error) {
        console.error('Error verifying user:', error);
        return null;
    }
}

/**
 * Suspends a user account (admin only)
 */
export async function suspend(userId: number, reason: string, token: string): Promise<{status: string; message: string; reason: string} | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/user/${userId}/suspend`, {
            method: 'POST',
            headers: getAuthHeaders(token, true),
            body: JSON.stringify({ reason })
        });

        if (response.ok) {
            return await response.json();
        }

        return null;
    } catch (error) {
        console.error('Error suspending user:', error);
        return null;
    }
}

/**
 * Unsuspends a user account (admin only)
 */
export async function unsuspend(userId: number, token: string): Promise<{status: string; message: string} | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/user/${userId}/unsuspend`, {
            method: 'POST',
            headers: getAuthHeaders(token, true)
        });

        if (response.ok) {
            return await response.json();
        }

        return null;
    } catch (error) {
        console.error('Error unsuspending user:', error);
        return null;
    }
}

/**
 * Deletes a user account (admin only)
 */
export async function deleteUser(userId: number, token: string): Promise<{status: string; message: string} | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/user/${userId}/delete`, {
            method: 'POST',
            headers: getAuthHeaders(token, true)
        });

        if (response.ok) {
            return await response.json();
        }

        return null;
    } catch (error) {
        console.error('Error deleting user:', error);
        return null;
    }
}


