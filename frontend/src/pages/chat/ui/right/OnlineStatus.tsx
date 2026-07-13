/**
 * @fileoverview Online status component for showing user online status
 * @description Displays online/offline status with last seen timestamp
 * @author Cursor
 * @version 1.0.0
 */

import { usePresenceStore } from "@/state/presence";
import { useUserStore } from "@/state/user";
import { formatDeletedUserLastSeen, isEpochLastSeen } from "@/core/userDisplay";
import { parseApiTimestamp } from "@/utils/utils";
import styles from "@/pages/chat/css/TypingIndicators.module.scss";

interface OnlineStatusProps {
    userId: number;
    showLastSeen?: boolean;
}

export function OnlineStatus({ userId, showLastSeen = false }: OnlineStatusProps) {
    const { onlineStatuses } = usePresenceStore();
    const { user } = useUserStore();
    const status = userId === user.currentUser?.id ? { online: true, lastSeen: new Date().toISOString() } : onlineStatuses.get(userId);

    function formatLastSeen(lastSeen: string): string {
        if (isEpochLastSeen(lastSeen)) {
            return formatDeletedUserLastSeen();
        }
        const date = parseApiTimestamp(lastSeen);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) {
            return "только что";
        } else if (diffMins < 60) {
            return `${diffMins} мин. назад`;
        } else if (diffHours < 24) {
            return `${diffHours} ч. назад`;
        } else if (diffDays < 7) {
            return `${diffDays} дн. назад`;
        } else {
            return date.toLocaleDateString();
        }
    }

    return (
        <div className={styles.onlineStatus}>
            <div className={`${styles.statusDot} ${status?.online ? styles.online : styles.offline}`}></div>
            <span className={styles.statusText}>
                {!status ? "Загрузка..." : status?.online ? "В сети" : "Не в сети"}
            </span>
            {showLastSeen && status && !status.online && (
                <span className="last-seen">
                    {formatLastSeen(status.lastSeen)}
                </span>
            )}
        </div>
    );
}
