import { API_BASE_URL } from "@/core/config";
import { getAuthHeaders } from "./index";

export interface DeviceInfo {
    session_id: string;
    device_name?: string;
    device_type?: string;
    os_name?: string;
    os_version?: string;
    browser_name?: string;
    browser_version?: string;
    brand?: string;
    model?: string;
    created_at?: string;
    last_seen?: string;
    revoked?: boolean;
    current?: boolean;
}

export async function listDevices(token: string): Promise<DeviceInfo[]> {
    const res = await fetch(`${API_BASE_URL}/devices`, { headers: getAuthHeaders(token, true) });
    if (!res.ok) throw new Error("Failed to fetch devices");
    const data = await res.json();
    return data.devices as DeviceInfo[];
}

export async function revokeDevice(token: string, sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/devices/${sessionId}`, { method: "DELETE", headers: getAuthHeaders(token, true) });
    if (!res.ok) throw new Error("Failed to revoke device");
}

export async function logoutAllOtherDevices(token: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/devices/logout-all`, { method: "POST", headers: getAuthHeaders(token, true) });
    if (!res.ok) throw new Error("Failed to logout all devices");
}

