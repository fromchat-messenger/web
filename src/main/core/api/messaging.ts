import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./account";
import type { Message, Messages, SendMessageRequest } from "@/core/types";
import { request } from "@/core/websocket";

class HttpError extends Error {
    status: number;
    detail: string;

    constructor(message: string, status: number, detail: string) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.detail = detail;
    }
}

/**
 * Fetches public chat messages
 */
export async function fetchMessages(token: string, limit: number = 50, beforeId?: number): Promise<Message[]> {
    let url = `${API_BASE_URL}/get_messages?limit=${limit}`;
    if (beforeId) {
        url += `&before_id=${beforeId}`;
    }
    const response = await fetch(url, {
        headers: getAuthHeaders(token, true)
    });
    if (!response.ok) return [];
    const data: Messages = await response.json();
    return data.messages || [];
}

/**
 * Sends a public chat message via WebSocket
 */
export async function sendMessage(content: string, replyToId: number | null, authToken: string): Promise<void> {
    await request({
        data: {
            content: content.trim(),
            reply_to_id: replyToId ?? null
        },
        credentials: {
            scheme: "Bearer",
            credentials: authToken
        },
        type: "sendMessage"
    } satisfies SendMessageRequest);
}

/**
 * Sends a public chat message with files via HTTP
 */
export async function sendMessageWithFiles(
    content: string,
    replyToId: number | null,
    files: File[],
    authToken: string
): Promise<void> {
    const form = new FormData();
    form.append("payload", JSON.stringify({
        content: content.trim(),
        reply_to_id: replyToId ?? null
    } satisfies SendMessageRequest["data"]));
    for (const f of files) form.append("files", f, f.name);
    const res = await fetch(`${API_BASE_URL}/send_message`, {
        method: "POST",
        headers: getAuthHeaders(authToken, false),
        body: form
    });
    if (!res.ok) {
        let errorDetail = "Failed to send message with files";
        try {
            const errorJson = await res.json();
            errorDetail = errorJson.detail || errorDetail;
        } catch {
            const errorText = await res.text();
            errorDetail = errorText || errorDetail;
        }
        throw new HttpError(errorDetail, res.status, errorDetail);
    }
}

/**
 * Edits a public chat message
 */
export async function editMessage(messageId: number, newContent: string, authToken: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/edit_message/${messageId}`, {
        method: "PUT",
        headers: getAuthHeaders(authToken, true),
        body: JSON.stringify({ content: newContent })
    });
    if (!res.ok) {
        let errorDetail = "Failed to edit message";
        try {
            const errorJson = await res.json();
            errorDetail = errorJson.detail || errorDetail;
        } catch {
            const errorText = await res.text();
            errorDetail = errorText || errorDetail;
        }
        throw new HttpError(errorDetail, res.status, errorDetail);
    }
}

/**
 * Deletes a public chat message
 */
export async function deleteMessage(messageId: number, authToken: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/delete_message/${messageId}`, {
        method: "DELETE",
        headers: getAuthHeaders(authToken, true)
    });
    if (!res.ok) throw new Error("Failed to delete message");
}

