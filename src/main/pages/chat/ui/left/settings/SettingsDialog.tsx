import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { DialogProps } from "@/core/types";
import { StyledDialog } from "@/core/components/StyledDialog";
import { NotificationsPanel } from "./NotificationsPanel";
import { DevicesPanel } from "./DevicesPanel";
import { SecurityPanel } from "./SecurityPanel";
import { AccountPanel } from "./AccountPanel";
import { MaterialList, MaterialListItem, MaterialIconButton } from "@/utils/material";
import styles from "@/pages/chat/css/settings-dialog.module.scss";

interface SettingsSection {
    title: string;
    icon: string;
    component: React.ReactNode;
}

export function SettingsDialog({ isOpen, onOpenChange }: DialogProps) {
    const sections: SettingsSection[] = [
        {
            title: "Notifications",
            icon: "notifications",
            component: <NotificationsPanel />
        },
        {
            title: "Devices",
            icon: "devices",
            component: <DevicesPanel />
        },
        {
            title: "Security",
            icon: "lock",
            component: <SecurityPanel />
        },
        {
            title: "Account",
            icon: "account_circle",
            component: <AccountPanel onClose={() => onOpenChange(false)} />
        }
    ];
    
    const [activeSection, setActiveSection] = useState<number>(0);

    return (
        <>
            <StyledDialog open={isOpen} onOpenChange={onOpenChange} className={styles.settingsDialog}>
                <div className={styles.settingsDialogInner}>
                    <div className={styles.settingsHeader}>
                        <MaterialIconButton icon="close" onClick={() => onOpenChange(false)} />
                        <h2 className={styles.settingsTitle}>Settings</h2>
                    </div>

                    <div className={styles.settingsLayout}>
                        <div className={styles.sidebar}>
                            <MaterialList>
                                {sections.map((section, index) => (
                                    <MaterialListItem 
                                        key={index}
                                        onClick={() => setActiveSection(index)}
                                        active={activeSection === index}
                                        rounded
                                        headline={section.title}
                                        icon={section.icon}
                                    />
                                ))}
                            </MaterialList>
                        </div>

                        <div className={styles.contentPanel}>
                            <AnimatePresence mode="wait">
                                {sections.map((section, index) => (
                                    activeSection === index && (
                                        <motion.div
                                            key={index}
                                            className={styles.panelContent}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -20 }}
                                            transition={{ duration: 0.2, ease: "easeInOut" }}
                                        >
                                            {section.component}
                                        </motion.div>
                                    )
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </StyledDialog>
        </>
    );
}