import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "../user/auth";
import { getCurrentKeys } from "../user/auth";
import { request } from "@/core/websocket";
import type { DmEnvelope, User } from "@/core/types";
import { ub64 } from "@/utils/utils";
import { fetchUserPublicKey } from "../crypto/identity";
import { fetchUsers, searchUsers } from "../user/search";
import { deriveWrappingKey, importAesGcmKey, aesGcmDecrypt } from "@fromchat/protocol";
import tweetnacl from "tweetnacl";

/**
 * Unwrap a MEK using the appropriate wrapping key for the current user
 */
export async function unwrapMek(wrappedMekB64: string, envelope: DmEnvelope, userId?: number): Promise<Uint8Array> {
    const keys = getCurrentKeys();
    if (!keys) throw new Error("Keys not initialized");

    // Determine context based on whether we're sender or recipient
    const currentUserId = userId || parseInt(localStorage.getItem('userId') || '0');
    const isRecipient = envelope.recipientId === currentUserId;
    const context = isRecipient ? "recipient_wrap_key" : "sender_wrap_key";

    // Derive wrapping key from our public key
    const salt = new Uint8Array(16).fill(0); // 16 zero bytes salt
    const wrappingKeyRaw = await deriveWrappingKey(keys.publicKey, salt, new TextEncoder().encode(context));
    const wrappingKey = await importAesGcmKey(wrappingKeyRaw);

    // Unwrap the MEK using AES-256-GCM
    const wrappedMekBytes = ub64(wrappedMekB64);
    const mekNonce = wrappedMekBytes.slice(0, 12);
    const mekCiphertext = wrappedMekBytes.slice(12);

    return await aesGcmDecrypt(wrappingKey, mekNonce, mekCiphertext);
}

export async function decrypt(envelope: DmEnvelope, userId?: number): Promise<string> {
    try {
        // Use the wrapped MEK provided for this user
        const wrappedMekB64 = envelope.wrapped_mek_b64;
        if (!wrappedMekB64) throw new Error("No wrapped MEK available for decryption");

        // Unwrap the MEK using shared logic
        const mek = await unwrapMek(wrappedMekB64, envelope, userId);

        // Decrypt the message using the unwrapped MEK
        // Server encrypts with AES-GCM, so client decrypts with AES-GCM
        // envelope.iv_b64 and envelope.ciphertext_b64 are base64-encoded separately
        const messageKey = await importAesGcmKey(mek);
        const messageNonce = ub64(envelope.iv_b64 || "");
        const messageCiphertext = ub64(envelope.ciphertext_b64);

        const plaintext = await aesGcmDecrypt(messageKey, messageNonce, messageCiphertext);
        const result = new TextDecoder().decode(plaintext);

        return result;
    } catch (error) {
        console.error("❌ Failed to decrypt DM envelope:", error);
        console.error("Error details:", {
            envelope: envelope,
            userId: userId,
            localStorageUserId: localStorage.getItem('userId')
        });
        throw error;
    }
}

export async function fetchMessages(userId: number, token: string, limit: number = 50, beforeId?: number): Promise<{ messages: DmEnvelope[]; has_more: boolean }> {
    let url = `${API_BASE_URL}/dm/history/${userId}?limit=${limit}`;
    if (beforeId) {
        url += `&before_id=${beforeId}`;
    }
    const response = await globalThis.fetch(url, {
        headers: getAuthHeaders(token, true)
    });
    if (!response.ok) return { messages: [], has_more: false };
    const data = await response.json();
    return { messages: data.messages || [], has_more: data.has_more ?? false };
}

/**
 * Get the transport public key from the server
 */
async function getTransportPublicKey(): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/dm/key/transport/public`);
    if (!response.ok) throw new Error(`Failed to fetch transport key: HTTP ${response.status}`);
    const data = await response.json();
    return data.public_key_b64;
}

/**
 * Encrypt message using transport key (client-side only)
 */
function encryptWithTransportKey(plaintext: string, transportPublicKeyB64: string): { client_public_key_b64: string; nonce_b64: string; ciphertext_b64: string } {
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const ephemeralKeypair = tweetnacl.box.keyPair();
    const transportPublicKeyBytes = new Uint8Array(
        atob(transportPublicKeyB64)
            .split("")
            .map((c: string) => c.charCodeAt(0))
    );
    
    const nonce = tweetnacl.randomBytes(24);
    const ciphertext = tweetnacl.box(plaintextBytes, nonce, transportPublicKeyBytes, ephemeralKeypair.secretKey);
    
    return {
        client_public_key_b64: btoa(String.fromCharCode.apply(null, Array.from(ephemeralKeypair.publicKey) as number[])),
        nonce_b64: btoa(String.fromCharCode.apply(null, Array.from(nonce) as number[])),
        ciphertext_b64: btoa(String.fromCharCode.apply(null, Array.from(ciphertext) as number[]))
    };
}

export async function send(recipientId: number, recipientPublicKeyB64: string, plaintext: string, authToken: string, replyToId?: number, attachments?: Array<{name:string,path:string,wrapped_mek_b64?:string,nonce_b64?:string}>): Promise<void> {
    // Get keys
    const keys = getCurrentKeys();
    if (!keys) throw new Error("Keys not initialized");
    
    const transportPublicKeyB64 = await getTransportPublicKey();
    
    // Client-side transport encryption only
    const { client_public_key_b64, nonce_b64, ciphertext_b64 } = encryptWithTransportKey(plaintext, transportPublicKeyB64);
    
    // Get sender's public key (from current keys)
    const senderPublicKeyB64 = keys.publicKey ? btoa(String.fromCharCode.apply(null, Array.from(keys.publicKey) as number[])) : "";
    
    // Send to server (server will handle envelope encryption)
    const bodyPayload: any = {
        recipient_id: recipientId,
        client_public_key_b64,
        transport_nonce_b64: nonce_b64,
        transport_ciphertext_b64: ciphertext_b64,
        sender_public_key_b64: senderPublicKeyB64,
        recipient_public_key_b64: recipientPublicKeyB64,
        reply_to_id: replyToId
    };
    if (attachments && attachments.length > 0) bodyPayload["files"] = attachments;

    const response = await fetch(`${API_BASE_URL}/dm/send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(authToken, true)
        },
        body: JSON.stringify(bodyPayload)
    });
    
    if (!response.ok) throw new Error(`Failed to send DM: HTTP ${response.status}`);
}


export async function sendWithFiles(
    recipientId: number,
    recipientPublicKeyB64: string,
    files: File[],
    plaintext: string,
    authToken: string,
    replyToId?: number
): Promise<void> {
    if (!files || files.length === 0) {
        throw new Error("No files provided");
    }

    // Get transport key for encryption (shared across message + files)
    const transportKeyResponse = await fetch(`${API_BASE_URL}/dm/key/transport/public`);
    if (!transportKeyResponse.ok) {
        throw new Error("Failed to get transport key");
    }
    const transportKeyData = await transportKeyResponse.json();
    const transportPublicKeyB64 = transportKeyData.public_key_b64;

    const keys = getCurrentKeys();
    if (!keys) throw new Error("Keys not initialized");

    const transportPublicKey = ub64(transportPublicKeyB64);

    // One ephemeral keypair for message + all files (must match messaging service decrypt_transport_blob).
    const ephemeralKeypair = tweetnacl.box.keyPair();
    const messagePlaintextBytes = new TextEncoder().encode(plaintext || "");
    const messageNonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
    const messageCiphertext = tweetnacl.box(
        messagePlaintextBytes,
        messageNonce,
        transportPublicKey,
        ephemeralKeypair.secretKey
    );
    const client_public_key_b64 = btoa(
        String.fromCharCode.apply(null, Array.from(ephemeralKeypair.publicKey) as number[])
    );
    const nonce_b64 = btoa(String.fromCharCode.apply(null, Array.from(messageNonce) as number[]));
    const ciphertext_b64 = btoa(String.fromCharCode.apply(null, Array.from(messageCiphertext) as number[]));

    const senderPublicKeyB64 = keys.publicKey ? btoa(String.fromCharCode.apply(null, Array.from(keys.publicKey) as number[])) : "";

    // Base64 encode helper (chunked)
    const uint8ToB64 = (uint8: Uint8Array): string => {
        const CHUNK = 0x8000;
        let binary = "";
        for (let i = 0; i < uint8.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK)) as number[]);
        }
        return btoa(binary);
    };

    // Transport-encrypt files; server will envelope-encrypt them with the SAME MEK as the message.
    const transport_files: Array<{ encrypted_file_data_b64: string; filename: string; file_size: number }> = [];
    for (const file of files) {
        const fileData = await file.arrayBuffer();
        const transportNonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
        const transportEncrypted = tweetnacl.box(
            new Uint8Array(fileData),
            transportNonce,
            transportPublicKey,
            ephemeralKeypair.secretKey
        );
        const transportEncryptedWithNonce = new Uint8Array(transportNonce.length + transportEncrypted.length);
        transportEncryptedWithNonce.set(transportNonce);
        transportEncryptedWithNonce.set(transportEncrypted, transportNonce.length);

        transport_files.push({
            encrypted_file_data_b64: uint8ToB64(transportEncryptedWithNonce),
            filename: file.name,
            file_size: file.size
        });
    }

    const requestBody = {
        recipient_id: recipientId,
        client_public_key_b64,
        transport_nonce_b64: nonce_b64,
        transport_ciphertext_b64: ciphertext_b64,
        sender_public_key_b64: senderPublicKeyB64,
        recipient_public_key_b64: recipientPublicKeyB64,
        reply_to_id: replyToId,
        transport_files
    };

    const response = await fetch(`${API_BASE_URL}/dm/send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(authToken, true)
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`Failed to send DM: HTTP ${response.status}`);
}


export async function deleteMessage(id: number, recipientId: number, authToken: string): Promise<void> {
    await request({
        type: "dmDelete",
        credentials: { scheme: "Bearer", credentials: authToken },
        data: { id, recipientId }
    });
}

export interface ConversationResponse {
    user: User;
    lastMessage: DmEnvelope;
    unreadCount: number;
}

export async function conversations(token: string): Promise<ConversationResponse[]> {
    const res = await fetch(`${API_BASE_URL}/dm/conversations`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.conversations || [];
}

/**
 * Marks a DM as read
 */
export async function markRead(id: number, authToken: string): Promise<void> {
    await request({
        type: "dmMarkRead",
        credentials: { scheme: "Bearer", credentials: authToken },
        data: { id }
    });
}

export async function editMessage(
    messageId: number,
    recipientPublicKeyB64: string,
    plaintext: string,
    authToken: string
): Promise<void> {
    // Get keys
    const keys = getCurrentKeys();
    if (!keys) throw new Error("Keys not initialized");

    // Get transport key for initial encryption
    const transportPublicKeyB64 = await getTransportPublicKey();

    // Client-side transport encryption (same as sending)
    const { client_public_key_b64, nonce_b64, ciphertext_b64 } = encryptWithTransportKey(plaintext, transportPublicKeyB64);

    // Get sender's public key
    const senderPublicKeyB64 = keys.publicKey ? btoa(String.fromCharCode.apply(null, Array.from(keys.publicKey) as number[])) : "";

    // Send transport-encrypted data to the edit endpoint (it will handle envelope encryption)
    const editResponse = await fetch(`${API_BASE_URL}/dm/edit/${messageId}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(authToken, true)
        },
        body: JSON.stringify({
            client_public_key_b64,
            transport_nonce_b64: nonce_b64,
            transport_ciphertext_b64: ciphertext_b64,
            sender_public_key_b64: senderPublicKeyB64,
            recipient_public_key_b64: recipientPublicKeyB64
        })
    });

    if (!editResponse.ok) throw new Error(`Failed to edit DM: HTTP ${editResponse.status}`);
}

// Re-export user functions for convenience
export { fetchUsers, searchUsers, fetchUserPublicKey };