import { useState, useEffect } from "react";
import { useImmer } from "use-immer";
import { MaterialList, MaterialListItem, MaterialButton, MaterialCircularProgress } from "@/utils/material";
import { useUserStore } from "@/state/user";
import api from "@/core/api";
import type { DeviceInfo } from "@/core/api/user/devices";
import { confirm } from "mdui/functions/confirm";
import { parseApiTimestamp } from "@/utils/utils";
import styles from "@/pages/chat/css/settings-dialog.module.scss";

export function DevicesPanel() {
    const { user } = useUserStore();
    const authToken = user?.authToken ?? null;
    const [devices, updateDevices] = useImmer<DeviceInfo[]>([]);
    const [devicesLoading, setDevicesLoading] = useState(false);
    const [revokingDevices, setRevokingDevices] = useImmer<Set<string>>(new Set());

    useEffect(() => {
        if (authToken) {
            loadDevices();
        }
    }, [authToken]);

    async function loadDevices() {
        if (!authToken) return;
        
        setDevicesLoading(true);
        try {
            const deviceList = await api.user.devices.list(authToken);
            updateDevices(deviceList);
        } catch (error) {
            console.error("Failed to load devices:", error);
        } finally {
            setDevicesLoading(false);
        }
    }

    async function handleRevokeDevice(sessionId: string) {
        if (!authToken) return;

        try {
            await confirm({
                headline: "Revoke Device?",
                description: "This will log out this device. You will need to log in again on this device.",
                confirmText: "Revoke",
                cancelText: "Cancel"
            });

            setRevokingDevices(draft => {
                draft.add(sessionId);
            });

            await api.user.devices.revoke(authToken, sessionId);
            await loadDevices();
        } catch (error) {
            if (error !== "cancelled") {
                console.error("Failed to revoke device:", error);
            }
        } finally {
            setRevokingDevices(draft => {
                draft.delete(sessionId);
            });
        }
    }

    async function handleLogoutAll() {
        if (!authToken) return;

        try {
            await confirm({
                headline: "Logout All Other Devices?",
                description: "This will log you out on all other devices. You will remain logged in on this device.",
                confirmText: "Logout All",
                cancelText: "Cancel"
            });

            await api.user.devices.revokeAll(authToken);
            await loadDevices();
        } catch (error) {
            if (error !== "cancelled") {
                console.error("Failed to logout all devices:", error);
            }
        }
    }

    function formatDeviceInfo(device: DeviceInfo): string {
        const parts: string[] = [];
        if (device.device_name) parts.push(device.device_name);
        if (device.os_name) parts.push(device.os_name);
        if (device.browser_name) parts.push(device.browser_name);
        return parts.length > 0 ? parts.join(" • ") : device.device_type || "Unknown device";
    }

    function formatLastSeen(dateStr: string | undefined): string {
        if (!dateStr) return "Never";
        const date = parseApiTimestamp(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
        
        return date.toLocaleDateString();
    }

    if (devicesLoading) {
        return (
            <>
                <h3 className={styles.panelTitle}>Devices</h3>
                <div className={styles.loadingContainer}>
                    <MaterialCircularProgress />
                </div>
            </>
        );
    }

    return (
        <>
            <h3 className={styles.panelTitle}>Devices</h3>
            <MaterialList>
                {devices.map((device) => (
                    <MaterialListItem 
                        key={device.session_id} 
                        className={styles.clickableItem}
                        headline={formatDeviceInfo(device)}
                        description={device.current ? "Current" : "Last seen: " + formatLastSeen(device.last_seen)}
                        icon={device.current ? "smartphone" : "phone_android"}
                        onClick={() => handleRevokeDevice(device.session_id)}
                        disabled={revokingDevices.has(device.session_id)}
                    />
                ))}
            </MaterialList>
            {devices.filter(d => !d.current).length > 0 && (
                <div className={styles.sectionActions}>
                    <MaterialButton 
                        onClick={handleLogoutAll}
                        variant="tonal"
                    >
                        Logout All Other Devices
                    </MaterialButton>
                </div>
            )}
        </>
    );
}

