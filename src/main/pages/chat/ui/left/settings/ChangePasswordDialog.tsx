import { useState } from "react";
import { StyledDialog } from "@/core/components/StyledDialog";
import type { DialogProps } from "@/core/types";
import { useUserStore } from "@/state/user";
import api from "@/core/api";
import { MaterialButton, MaterialIconButton, MaterialSwitch, MaterialTextField } from "@/utils/material";
import styles from "@/pages/chat/css/changePasswordDialog.module.scss";

export default function ChangePasswordDialog({ isOpen, onOpenChange }: DialogProps) {
    const { user } = useUserStore();
    
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [logoutAll, setLogoutAll] = useState(true);
    const [busy, setBusy] = useState(false);

    return (
        <StyledDialog open={isOpen} onOpenChange={onOpenChange} className="change-password-dialog">
            <div className={styles.cpdContainer}>
                <div className={styles.cpdTitlebar}>
                    <MaterialIconButton icon="close" onClick={() => onOpenChange(false)}></MaterialIconButton>
                    <div className={styles.cpdTitle}>Изменить пароль</div>
                </div>
                <div className={styles.cpdContent}>
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!user.authToken || !user.currentUser?.username) return;
                        if (!current || !next || next !== confirm) return;
                        setBusy(true);
                        try {
                            await api.user.auth.changePassword(user.authToken, user.currentUser?.username, current, next, logoutAll);
                            setCurrent("");
                            setNext("");
                            setConfirm("");
                            onOpenChange(false);
                        } finally {
                            setBusy(false);
                        }
                    }}>
                        <MaterialTextField
                            name="cpd-current-password"
                            label="Текущий пароль"
                            type="password"
                            value={current}
                            onInput={(e) => setCurrent(e.target.value)} 
                            variant="outlined"
                            toggle-password
                            required />
                        <MaterialTextField
                            name="cpd-new-password"
                            label="Новый пароль"
                            type="password"
                            value={next}
                            onInput={(e) => setNext(e.target.value)}
                            variant="outlined"
                            toggle-password
                            required />
                        <MaterialTextField
                            name="cpd-confirm-password"
                            label="Подтвердите пароль"
                            type="password"
                            value={confirm}
                            onInput={(e) => setConfirm(e.target.value)}
                            variant="outlined"
                            toggle-password
                            required />
                        <div className={styles.cpdLogoutAll}>
                            <MaterialSwitch 
                                name="cpd-logout-all" 
                                checked={logoutAll} 
                                onInput={(e) => setLogoutAll(e.target.checked)} />
                            <label htmlFor="cpd-logout-all">Выйти на всех устройствах (кроме текущего)</label>
                        </div>
                        <div className={styles.cpdActions}>
                            <MaterialButton type="submit" disabled={busy}>Сохранить</MaterialButton>
                        </div>
                    </form>
                </div>
            </div>
        </StyledDialog>
    );
}