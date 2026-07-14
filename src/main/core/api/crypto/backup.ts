import { API_BASE_URL } from "@/core/config";
import type { BackupBlob } from "@/core/types";
import api from "@/core/api";

/**
 * Fetches the current user's backup blob
 */
export async function fetchBackupBlob(token: string): Promise<string | null> {
    const headers = api.user.auth.getAuthHeaders(token, true);
    const res = await fetch(`${API_BASE_URL}/crypto/backup`, {
        method: "GET",
        headers
    });
    if (res.ok) {
        const response: BackupBlob = await res.json();
        return response.blob;
    } else {
        return null;
    }
}

/**
 * Uploads the current user's backup blob
 */
export async function uploadBackupBlob(blobJson: string, token: string): Promise<void> {
    const payload: BackupBlob = { blob: blobJson }

    const headers = api.user.auth.getAuthHeaders(token, true);
    const res = await fetch(`${API_BASE_URL}/crypto/backup`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to upload backup blob");
}


