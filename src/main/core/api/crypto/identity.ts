import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "../user/auth";
import type { UploadPublicKeyRequest } from "@/core/types";
import { b64, ub64 } from "@/utils/utils";

/**
 * Fetches the current user's public key
 */
export async function fetchPublicKey(token: string): Promise<Uint8Array | null> {
    const headers = getAuthHeaders(token, true);
    const res = await fetch(`${API_BASE_URL}/crypto/public-key`, { method: "GET", headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.publicKey) return null;
    return ub64(data.publicKey);
}

/**
 * Uploads the current user's public key
 */
export async function uploadPublicKey(publicKey: Uint8Array, token: string): Promise<void> {
    const payload: UploadPublicKeyRequest = {
        publicKey: b64(publicKey)
    }

    const headers = getAuthHeaders(token, true);
    const res = await fetch(`${API_BASE_URL}/crypto/public-key`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to upload public key");
}

/**
 * Fetches another user's public key by user ID
 */
export async function fetchUserPublicKey(userId: number, token: string): Promise<string | null> {
    const res = await fetch(`${API_BASE_URL}/crypto/public-key/of/${userId}`, { headers: getAuthHeaders(token, true) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey;
}


