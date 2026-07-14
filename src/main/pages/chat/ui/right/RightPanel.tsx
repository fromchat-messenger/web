import { useChatStore } from "@/state/chat";
import { MessagePanelRenderer } from "./MessagePanelRenderer";

export function RightPanel() {
    const { activePanel } = useChatStore();

    return <MessagePanelRenderer panel={activePanel} />
}