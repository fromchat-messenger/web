import { useState, useCallback, useEffect } from "react";
import { StyledDialog } from "./StyledDialog";
import { MaterialButton } from "@/utils/material";
import styles from "./css/alert-dialog.module.scss";

interface AlertDialogState {
    open: boolean;
    message: string;
    resolve: (() => void) | null;
}

let alertState: AlertDialogState = {
    open: false,
    message: "",
    resolve: null
};

const listeners = new Set<() => void>();

function notifyListeners() {
    listeners.forEach(listener => listener());
}

/**
 * Drop-in replacement for window.alert() using StyledDialog
 * @param message - The message to display
 * @returns Promise that resolves when the dialog is closed
 */
export function alert(message: string): Promise<void> {
    return new Promise<void>((resolve) => {
        alertState = {
            open: true,
            message,
            resolve: () => {
                alertState.open = false;
                alertState.message = "";
                alertState.resolve = null;
                notifyListeners();
                resolve();
            }
        };
        notifyListeners();
    });
}

/**
 * Internal component that renders the alert dialog
 */
export function AlertDialogProvider() {
    const [, setUpdateKey] = useState(0);
    
    const update = useCallback(() => {
        setUpdateKey(prev => prev + 1);
    }, []);

    useEffect(() => {
        listeners.add(update);
        return () => {
            listeners.delete(update);
        };
    }, [update]);

    const handleClose = () => {
        if (alertState.resolve) {
            alertState.resolve();
        }
    };

    return (
        <StyledDialog
            open={alertState.open}
            onOpenChange={(open) => {
                if (!open) {
                    handleClose();
                }
            }}
            onBackdropClick={handleClose}
            className={styles.alertDialog}
            contentClassName={styles.alertDialogContent}
        >
            <div className={styles.alertDialogMessage}>
                {alertState.message}
            </div>
            <div className={styles.alertDialogActions}>
                <MaterialButton
                    variant="filled"
                    onClick={handleClose}
                >
                    OK
                </MaterialButton>
            </div>
        </StyledDialog>
    );
}
