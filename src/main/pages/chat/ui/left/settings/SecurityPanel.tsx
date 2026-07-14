import { useState } from "react";
import { MaterialList, MaterialListItem } from "@/utils/material";
import ChangePasswordDialog from "./ChangePasswordDialog";
import styles from "@/pages/chat/css/settings-dialog.module.scss";

export function SecurityPanel() {
    const [cpOpen, setCpOpen] = useState(false);

    return (
        <>
            <h3 className={styles.panelTitle}>Security</h3>
            <MaterialList>
                <MaterialListItem 
                    onClick={() => setCpOpen(true)}
                    className={styles.clickableItem}
                    headline="Change Password"
                    description="Change your account password"
                    icon="password"
                />
            </MaterialList>
            <ChangePasswordDialog isOpen={cpOpen} onOpenChange={setCpOpen} />
        </>
    );
}

