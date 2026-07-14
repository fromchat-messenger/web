import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./account";
import { request } from "@/core/websocket";
import type { DmEnvelope, User } from "@/core/types";
import { fetchUserPublicKey } from "./crypto";
import { fetchUsers, searchUsers } from "./users";

export async function decryptDm(envelope: DmEnvelope): Promise<string> {
    const { decrypt } = await import("./chats/dm");
    return decrypt(envelope);
}

export async function fetchDMHistory(userId: number, token: string, limit: number = 50): Promise<DmEnvelope[]> {
    const response = await fetch(`${API_BASE_URL}/dm/history/${userId}?limit=${limit}`, {
        headers: getAuthHeaders(token, true)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.messages || [];
}

// Re-export user functions for convenience
export { fetchUsers, searchUsers, fetchUserPublicKey };

export async function sendDMViaWebSocket(recipientId: number, recipientPublicKeyB64: string, plaintext: string, authToken: string, replyToId?: number): Promise<void> {
    const { send } = await import("./chats/dm");
    return send(recipientId, recipientPublicKeyB64, plaintext, authToken, replyToId);
}


export async function deleteDmEnvelope(id: number, recipientId: number, authToken: string): Promise<void> {
    await request({
        type: "dmDelete",
        credentials: { scheme: "Bearer", credentials: authToken },
        data: { id, recipientId }
    });
}

export interface DMConversationResponse {
    user: User;
    lastMessage: DmEnvelope;
    unreadCount: number;
}

export async function fetchDMConversations(token: string): Promise<DMConversationResponse[]> {
    const res = await fetch(`${API_BASE_URL}/dm/conversations`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.conversations || [];
}

