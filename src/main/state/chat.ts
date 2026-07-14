import { create } from "zustand";
import type { Message, User } from "@/core/types";
import { MessagePanel } from "@/pages/chat/ui/right/panels/MessagePanel";
import { PublicChatPanel } from "@/pages/chat/ui/right/panels/PublicChatPanel";
import { DMPanel } from "@/pages/chat/ui/right/panels/DMPanel";
import type { DMPanelData } from "@/pages/chat/ui/right/panels/DMPanel";
import type { ChatTabs, ActiveDM } from "./types";
import { useUserStore } from "./user";

interface ChatStore {
    messages: Message[];
    currentChat: string;
    activeTab: ChatTabs;
    dmUsers: User[];
    activeDm: ActiveDM | null;
    isSwitching: boolean;
    setIsSwitching: (value: boolean) => void;
    activePanel: MessagePanel | null;
    publicChatPanel: PublicChatPanel | null;
    dmPanel: DMPanel | null;
    pendingPanel?: MessagePanel | null;
    addMessage: (message: Message) => void;
    updateMessage: (messageId: number, updatedMessage: Partial<Message>) => void;
    removeMessage: (messageId: number) => void;
    setCurrentChat: (chat: string) => void;
    setActiveTab: (tab: ChatTabs) => void;
    setDmUsers: (users: User[]) => void;
    setActiveDm: (dm: ActiveDM | null) => void;
    clearMessages: () => void;
    setActivePanel: (panel: MessagePanel | null) => void;
    setPendingPanel: (panel: MessagePanel | null) => void;
    applyPendingPanel: () => void;
    switchToPublicChat: (chatName: string) => Promise<void>;
    switchToDM: (dmData: DMPanelData) => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
    messages: [],
    currentChat: "Общий чат",
    activeTab: "chats",
    dmUsers: [],
    activeDm: null,
    isSwitching: false,
    setIsSwitching: (value: boolean) => set({ isSwitching: value }),
    activePanel: null,
    publicChatPanel: null,
    dmPanel: null,
    pendingPanel: null,
    addMessage: (message: Message) => set((state) => {
        const messageExists = state.messages.some(msg => msg.id === message.id);
        if (messageExists) {
            return state;
        }
        return {
            messages: [...state.messages, message]
        };
    }),
    updateMessage: (messageId: number, updatedMessage: Partial<Message>) => set((state) => ({
        messages: state.messages.map(msg =>
            msg.id === messageId ? { ...msg, ...updatedMessage } : msg
        )
    })),
    removeMessage: (messageId: number) => set((state) => ({
        messages: state.messages.filter(msg => msg.id !== messageId)
    })),
    clearMessages: () => set({ messages: [] }),
    setCurrentChat: (chat: string) => set({ currentChat: chat }),
    setActiveTab: (tab: ChatTabs) => set({ activeTab: tab }),
    setDmUsers: (users: User[]) => set({ dmUsers: users }),
    setActiveDm: (dm: ActiveDM | null) => set({ activeDm: dm }),
    setActivePanel: (panel: MessagePanel | null) => {
        const state = get();
        if (state.activePanel && state.activePanel !== panel) {
            state.activePanel.deactivate();
        }
        return set({ activePanel: panel });
    },
    setPendingPanel: (panel: MessagePanel | null) => set({ pendingPanel: panel }),
    applyPendingPanel: () => {
        const state = get();
        if (state.activePanel) {
            state.activePanel.deactivate();
        }
        return set((state) => ({
            activePanel: state.pendingPanel || state.activePanel,
            publicChatPanel: (state.pendingPanel instanceof PublicChatPanel)
                ? (state.pendingPanel as PublicChatPanel)
                : state.publicChatPanel,
            dmPanel: (state.pendingPanel instanceof DMPanel)
                ? (state.pendingPanel as DMPanel)
                : state.dmPanel,
            currentChat: state.pendingPanel ? state.pendingPanel.getState().title || state.currentChat : state.currentChat,
            pendingPanel: null
        }));
    },
    switchToPublicChat: async (chatName: string) => {
        const { user } = useUserStore.getState();
        const state = get();

        if (!user.authToken) return;

        state.setIsSwitching(true);

        let publicChatPanel = state.publicChatPanel;
        if (!publicChatPanel) {
            publicChatPanel = new PublicChatPanel(chatName, user);
        } else {
            publicChatPanel.setChatName(chatName);
            publicChatPanel.setAuthToken(user.authToken);
            publicChatPanel.clearMessages();
        }

        await publicChatPanel.activate();

        set({
            pendingPanel: publicChatPanel,
            activeTab: "chats"
        });
    },
    switchToDM: async (dmData: DMPanelData) => {
        const { user } = useUserStore.getState();
        const state = get();

        if (!user.authToken) return;

        state.setIsSwitching(true);

        let dmPanel = state.dmPanel;
        if (!dmPanel) {
            dmPanel = new DMPanel(user);
        } else {
            dmPanel.setAuthToken(user.authToken);
            dmPanel.clearMessages();
        }

        dmPanel.setDMData(dmData);

        await dmPanel.activate();

        set({
            pendingPanel: dmPanel,
            activeDm: {
                userId: dmData.userId,
                username: dmData.username,
                publicKey: dmData.publicKey
            },
            activeTab: "chats"
        });
    }
}));
