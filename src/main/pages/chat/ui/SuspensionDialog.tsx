import { StyledDialog } from "@/core/components/StyledDialog";
import { MaterialIcon } from "@/utils/material";
import styles from "@/pages/chat/css/suspension-dialog.module.scss";

interface SuspensionDialogProps {
    reason: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SuspensionDialog({ reason, open, onOpenChange }: SuspensionDialogProps) {
    return (
        <StyledDialog
            open={open}
            onOpenChange={onOpenChange}>
            <div className={styles.suspensionDialogContent}>
                <div className={styles.suspensionIconSection}>
                    <MaterialIcon name="block--filled" className={styles.suspensionIcon} />
                </div>
                
                <div className={styles.suspensionText}>
                    <h2 className={styles.suspensionHeadline}>Аккаунт заблокирован</h2>
                    <p className={styles.suspensionBody}>
                        Ваш аккаунт был заблокирован за нарушение правил сообщества. 
                        Вы не можете отправлять сообщения или взаимодействовать с другими пользователями.
                    </p>
                    {reason && reason !== "No reason provided" && (
                        <div className={styles.suspensionReason}>
                            <strong>Причина блокировки:</strong> 
                            <div className={styles.suspensionReasonText}>
                                {reason}
                            </div>
                        </div>
                    )}
                    <p className={styles.suspensionSecondary}>
                        Если вы считаете, что блокировка была применена по ошибке,
                        <a href="https://t.me/denis0001_dev" target="_blank" rel="noopener noreferrer">обратитесь к администратору</a> для рассмотрения вашего случая.
                    </p>
                </div>
            </div>
        </StyledDialog>
    );
}
