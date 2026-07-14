import { useState, useRef } from "react";
import { MaterialList, MaterialListItem, MaterialSwitch, type MDUISwitch } from "@/utils/material";
import { useUserStore } from "@/state/user";
import { initialize, subscribe, unsubscribe, isSupported } from "@/core/push-notifications/push-notifications";
import { isElectron } from "@/core/electron/electron";
import api from "@/core/api";
import styles from "@/pages/chat/css/settings-dialog.module.scss";

export function NotificationsPanel() {
    const { user } = useUserStore();
    const authToken = user?.authToken ?? null;
    const [pushEnabled, setPushEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const switchRef = useRef<MDUISwitch>(null);

    async function checkPushStatus() {
        if (!isSupported()) {
            setPushEnabled(false);
            setChecking(false);
            return;
        }

        setChecking(true);
        try {
            let permission: string;
            if (isElectron) {
                permission = await window.electronInterface.notifications.requestPermission();
            } else {
                permission = Notification.permission;
            }
            console.log("checkPushStatus", permission);
            setPushEnabled(permission === "granted");
        } catch (error) {
            console.error("Failed to check push status:", error);
            setPushEnabled(false);
        } finally {
            setChecking(false);
        }
    }

    async function handlePushToggle(enabled: boolean) {
        console.log("handlePushToggle", enabled);
        if (!authToken || !isSupported() || loading) return;

        // Optimistic update
        const previousState = pushEnabled;
        setPushEnabled(enabled);
        setLoading(true);

        try {
            if (enabled) {
                // Initialize push notifications (creates service worker and requests permission)
                const initResult = await initialize();
                if (!initResult) {
                    throw new Error("Failed to initialize push notifications");
                }

                // Subscribe to push notifications (sends subscription to server)
                // The subscribe() function will handle creating/getting the subscription if needed
                const subscribeResult = await subscribe(authToken);
                if (!subscribeResult) {
                    throw new Error("Failed to subscribe to push notifications");
                }

                // Verify the state after subscription - check permission to ensure it's actually granted
                await checkPushStatus();
            } else {
                // Unsubscribe locally first
                const unsubscribed = await unsubscribe();
                if (!unsubscribed) {
                    throw new Error("Failed to unsubscribe locally");
                }

                // Then unsubscribe from server
                await api.push.subscription.unsubscribe(authToken);

                // After unsubscribing, permission is still granted but we're not subscribed
                // So we keep the state as disabled (false)
                setPushEnabled(false);
            }
        } catch (error) {
            console.error("Failed to toggle push notifications:", error);
            // Revert optimistic update
            setPushEnabled(previousState);
            // Re-check actual status to sync with reality
            await checkPushStatus();
        } finally {
            setLoading(false);
        }
    }

    function handleListItemClick(e: React.MouseEvent) {
        if (checking || loading || !isSupported() || e.target === switchRef.current) return;
        handlePushToggle(!pushEnabled);
    }

    return (
        <>
            <h3 className={styles.panelTitle}>Notifications</h3>
            <MaterialList>
                <MaterialListItem 
                    className={styles.clickableItem}
                    headline="Push Notifications"
                    description="Receive notifications for new messages"
                    icon="notifications"
                    onClick={handleListItemClick}>
                    <MaterialSwitch
                        checked={pushEnabled}
                        disabled={!isSupported() || loading || checking}
                        onChange={(e) => handlePushToggle(e.target.checked)}
                        slot="end-icon"
                        ref={switchRef}
                    />
                </MaterialListItem>
            </MaterialList>
        </>
    );
}

