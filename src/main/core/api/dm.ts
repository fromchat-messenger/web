import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./account";
import { request } from "@/core/websocket";
import type { DmEnvelope, User } from "@/core/types";
import { fetchUserPublicKey } from "./crypto";
import { searchUsers } from "./users";

/**
 * Decrypt a DM envelope using client-side MEK unwrapping.
 * This delegates to the chats/dm module which has the updated implementation.
 */
export async function decryptDm(envelope: DmEnvelope): Promise<string> {
    // Import and use the updated implementation from chats/dm
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
export { searchUsers, fetchUserPublicKey };

/**
 * Send DM via WebSocket using transport encryption.
 * This delegates to the HTTP endpoint which handles envelope encryption on server.
 */
export async function sendDMViaWebSocket(recipientId: number, recipientPublicKeyB64: string, plaintext: string, authToken: string, replyToId?: number): Promise<void> {
    // Import and use the updated implementation from chats/dm
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

// ============================================================================
// Envelope Encryption (Private DMs with compliance support)
// ============================================================================

interface TransportKey {
    key_id: string;
    public_key_b64: string;
    created_at: number;
}

interface TransportEncryptedMessage {
    client_public_key_b64: string;
    nonce_b64: string;
    ciphertext_b64: string;
}

let cachedTransportKey: TransportKey | null = null;

/**
 * Fetch current transport public key from messaging service.
 * Caches result with validation.
 */
export async function getTransportPublicKey(): Promise<TransportKey> {
    if (cachedTransportKey) {
        return cachedTransportKey;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/dm/key/transport/public`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data: TransportKey = await response.json();
        cachedTransportKey = data;
        return data;
    } catch (error) {
        console.error("Failed to fetch transport public key:", error);
    }

    throw new Error("Failed to fetch transport public key");
}

/**
 * Encrypt a message using the transport public key (X25519 + ChaCha20).
 */
function encryptMessageWithTransportKey(
    plaintext: string | Uint8Array,
    transportPublicKeyB64: string
): { nonce_b64: string; ciphertext_b64: string; client_public_key_b64: string } {
    const tweetnacl = require("tweetnacl");

    // Convert plaintext to bytes if string
    const plaintextBytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;

    // Generate ephemeral keypair for this message
    const ephemeralKeypair = tweetnacl.box.keyPair();

    // Decode transport public key
    const transportPublicKeyBytes = new Uint8Array(
        atob(transportPublicKeyB64)
            .split("")
            .map((c: string) => c.charCodeAt(0))
    );

    // Perform ECDH (shared secret via tweetnacl's box)
    const nonce = tweetnacl.randomBytes(24);
    const ciphertext = tweetnacl.box(plaintextBytes, nonce, transportPublicKeyBytes, ephemeralKeypair.secretKey);

    // Encode to base64
    const nonce_b64 = btoa(String.fromCharCode.apply(null, Array.from(nonce) as number[]));
    const ciphertext_b64 = btoa(String.fromCharCode.apply(null, Array.from(ciphertext) as number[]));
    const client_public_key_b64 = btoa(
        String.fromCharCode.apply(null, Array.from(ephemeralKeypair.publicKey) as number[])
    );

    return { nonce_b64, ciphertext_b64, client_public_key_b64 };
}

/**
 * Encrypt plaintext with transport public key for sending to server.
 * Server will handle envelope encryption (MEK generation and wrapping).
 */
export async function encryptMessageForTransport(plaintext: string): Promise<TransportEncryptedMessage> {
    const transportKey = await getTransportPublicKey();
    return encryptMessageWithTransportKey(plaintext, transportKey.public_key_b64);
}

/**
 * Send an encrypted DM message using envelope encryption.
 * Client encrypts with transport key, server handles envelope encryption.
 */
export async function sendEncryptedDM(
    recipientId: number,
    plaintext: string,
    token: string,
    replyToId?: number
): Promise<void> {
    try {
        // Client-side transport encryption
        const { client_public_key_b64, nonce_b64, ciphertext_b64 } =
            await encryptMessageForTransport(plaintext);

        // Send to server
        const response = await fetch(`${API_BASE_URL}/dm/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...getAuthHeaders(token, true)
            },
            body: JSON.stringify({
                recipient_id: recipientId,
                client_public_key_b64,
                transport_nonce_b64: nonce_b64,
                transport_ciphertext_b64: ciphertext_b64,
                reply_to_id: replyToId,
            }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.error("Failed to send encrypted DM:", error);
        throw error;
    }
}

/**
 * Get encrypted conversation history with another user.
 */
export async function getEncryptedConversation(
    otherUserId: number,
    token: string,
    limit: number = 50,
    offset: number = 0
): Promise<any[]> {
    try {
        const url = new URL(`${API_BASE_URL}/dm/conversation/${otherUserId}`);
        url.searchParams.append("limit", String(limit));
        url.searchParams.append("offset", String(offset));

        const response = await fetch(url.toString(), {
            headers: getAuthHeaders(token, true)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch encrypted conversation with user ${otherUserId}:`, error);
        throw error;
    }
}

/**
 * Delete an encrypted message.
 */
export async function deleteEncryptedDM(messageId: number, token: string): Promise<void> {
    try {
        const response = await fetch(`${API_BASE_URL}/dm/${messageId}`, {
            method: "DELETE",
            headers: getAuthHeaders(token, true)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.error(`Failed to delete encrypted DM ${messageId}:`, error);
        throw error;
    }
}

/**
 * Clear cached keys (useful on logout).
 */
export function clearCachedKeys(): void {
    cachedTransportKey = null;
}
