import { MaterialList, MaterialListItem } from "@/utils/material";
import { useUserStore } from "@/state/user";
import api from "@/core/api";
import { confirm } from "mdui/functions/confirm";
import styles from "@/pages/chat/css/settings-dialog.module.scss";

interface AccountPanelProps {
    onClose: () => void;
}

export function AccountPanel({ onClose }: AccountPanelProps) {
    const { user, logout } = useUserStore();
    const authToken = user?.authToken;

    async function handleDeleteAccount() {
        if (!authToken) return;

        try {
            await confirm({
                headline: "Удалить аккаунт?",
                description: "Профиль будет удалён без возможности восстановления, логин освободится. Отправленные сообщения могут остаться в чатах.",
                confirmText: "Удалить",
                cancelText: "Отмена"
            });

            await api.user.auth.deleteAccount(authToken);
            logout();
            onClose();
        } catch (error) {
            if (error !== "cancelled") {
                console.error("Failed to delete account:", error);
                alert(error instanceof Error ? error.message : "Failed to delete account");
            }
        }
    }

    return (
        <>
            <h3 className={styles.panelTitle}>Account</h3>
            <MaterialList>
                <MaterialListItem 
                    onClick={logout}
                    className={styles.clickableItem}
                    headline="Logout"
                    description="Sign out of your account"
                    icon="logout"
                />
                <MaterialListItem 
                    onClick={handleDeleteAccount}
                    className={`${styles.clickableItem} ${styles.dangerItem}`}
                    headline="Delete Account"
                    description="Permanently delete your account"
                    icon="delete_forever"
                />
            </MaterialList>
        </>
    );
}

