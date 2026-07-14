import { useUserStore } from "@/state/user";
import { useRef, useState } from "react";
import { SettingsDialog } from "./settings/SettingsDialog";
import { UsernameSearch } from "./UsernameSearch";
import { UnifiedChatsList } from "./UnifiedChatsList";
import { ChatHeader } from "./ChatHeader";
import { MaterialBottomAppBar, MaterialFab, MaterialIconButton, type MDUIBottomAppBar } from "@/utils/material";
import styles from "@/pages/chat/css/left-panel.module.scss";

function BottomAppBar({ bottomAppBarRef }: { bottomAppBarRef?: React.RefObject<MDUIBottomAppBar | null> }) {
    const [settingsOpen, onSettingsOpenChange] = useState(false);
    const { logout } = useUserStore();

    return (
        <>
            <MaterialBottomAppBar ref={bottomAppBarRef}>
                <MaterialIconButton icon="settings--filled" id="settings-open" onClick={() => onSettingsOpenChange(true)} />
                <div style={{ flexGrow: 1 }} />
                <MaterialIconButton
                    icon="logout--filled"
                    id="logout-btn"
                    onClick={logout}
                    title="Выйти" />
                <MaterialFab icon="edit--filled" />
            </MaterialBottomAppBar>
            <SettingsDialog isOpen={settingsOpen} onOpenChange={onSettingsOpenChange} />
        </>
    );
}

export function LeftPanel() {
    const containerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const bottomAppBarRef = useRef<MDUIBottomAppBar>(null);
    
    return (
        <div className={styles.chatList} ref={containerRef}>
            <ChatHeader headerRef={headerRef} />
            <div className={styles.searchContainer}>
                <UsernameSearch containerRef={containerRef} headerRef={headerRef} bottomAppBarRef={bottomAppBarRef} />
            </div>
            <UnifiedChatsList />
            <BottomAppBar bottomAppBarRef={bottomAppBarRef} />
        </div>
    );
}
