import { create } from "zustand";

interface PresenceStore {
    onlineStatuses: Map<number, {online: boolean, lastSeen: string}>;
    typingUsers: Map<number, string>; // userId -> username
    dmTypingUsers: Map<number, boolean>;
    updateOnlineStatus: (userId: number, online: boolean, lastSeen: string) => void;
    addTypingUser: (userId: number, username: string) => void;
    removeTypingUser: (userId: number) => void;
    setDmTypingUser: (userId: number, isTyping: boolean) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
    onlineStatuses: new Map(),
    typingUsers: new Map(),
    dmTypingUsers: new Map(),
    updateOnlineStatus: (userId: number, online: boolean, lastSeen: string) => set((state) => ({
        onlineStatuses: new Map(state.onlineStatuses).set(userId, { online, lastSeen })
    })),
    addTypingUser: (userId: number, username: string) => set((state) => ({
        typingUsers: new Map(state.typingUsers).set(userId, username)
    })),
    removeTypingUser: (userId: number) => set((state) => {
        const newTypingUsers = new Map(state.typingUsers);
        newTypingUsers.delete(userId);
        return {
            typingUsers: newTypingUsers
        };
    }),
    setDmTypingUser: (userId: number, isTyping: boolean) => set((state) => {
        const newDmTypingUsers = new Map(state.dmTypingUsers);
        if (isTyping) {
            newDmTypingUsers.set(userId, true);
        } else {
            newDmTypingUsers.delete(userId);
        }
        return {
            dmTypingUsers: newDmTypingUsers
        };
    })
}));
