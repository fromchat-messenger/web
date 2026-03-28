import { create } from "zustand";
import type { User } from "@/core/types";
import api from "@/core/api";
import { API_BASE_URL } from "@/core/config";
import { initialize, subscribe, startElectronReceiver, isSupported } from "@/core/push-notifications/push-notifications";
import { isElectron } from "@/core/electron/electron";
import { onlineStatusManager } from "@/core/onlineStatusManager";
import { typingManager } from "@/core/typingManager";
import type { UserState } from "./types";

interface UserStore {
    user: UserState;
    setUser: (token: string, user: User) => void;
    logout: () => void;
    restoreFromStorage: () => Promise<void>;
    setSuspended: (reason: string) => void;
}

export const useUserStore = create<UserStore>((set) => ({
    user: {
        currentUser: null,
        authToken: null,
        isSuspended: false,
        suspensionReason: null
    },
    setUser: (token: string, user: User) => {
        set({
            user: {
                currentUser: user,
                authToken: token,
                isSuspended: user.suspended || false,
                suspensionReason: user.suspension_reason || null
            }
        });

        onlineStatusManager.setAuthToken(token);
        typingManager.setAuthToken(token);

        try {
            localStorage.setItem('authToken', token);
            localStorage.setItem('currentUser', JSON.stringify(user));
        } catch (error) {
            console.error('Failed to store credentials in localStorage:', error);
        }

        // Ping will be sent automatically on WebSocket reconnect
        // No need to send here to avoid duplicate pings
    },
    logout: () => {
        try {
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
        } catch (error) {
            console.error('Failed to clear localStorage:', error);
        }

        onlineStatusManager.setAuthToken(null);
        typingManager.setAuthToken(null);
        onlineStatusManager.cleanup();
        typingManager.cleanup();

        set({
            user: {
                currentUser: null,
                authToken: null,
                isSuspended: false,
                suspensionReason: null
            }
        });
    },
    restoreFromStorage: async () => {
        try {
            const token = localStorage.getItem('authToken');

            if (token) {
                const fullResponse = await fetch(`${API_BASE_URL}/user/profile`, {
                    headers: api.user.auth.getAuthHeaders(token, true)
                });
                if (fullResponse.ok) {
                    const user: User = await fullResponse.json();
                    api.user.auth.restoreKeys();
                    try {
                        await api.user.auth.syncPublicKeyToServerIfMissing(token);
                    } catch (e) {
                        console.error("Public key sync to server failed:", e);
                    }

                    if (user.suspended) {
                        set({
                            user: {
                                currentUser: user,
                                authToken: token,
                                isSuspended: true,
                                suspensionReason: user.suspension_reason || null
                            }
                        });
                        return;
                    }

                    set({
                        user: {
                            currentUser: user,
                            authToken: token,
                            isSuspended: false,
                            suspensionReason: null
                        }
                    });

                    onlineStatusManager.setAuthToken(token);
                    typingManager.setAuthToken(token);

                    // Ping will be sent automatically on WebSocket reconnect
                    // No need to send here to avoid duplicate pings

                    try {
                        if (isSupported()) {
                            const initialized = await initialize();
                            if (initialized) {
                                await subscribe(token);

                                if (isElectron) {
                                    await startElectronReceiver();
                                }
                            }
                        }
                    } catch (e) {
                        console.error("Notification setup failed (restored):", e);
                    }
                } else {
                    throw new Error("Unable to authenticate");
                }
            }
        } catch (error) {
            console.error('Failed to restore user from localStorage:', error);
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
        }
    },
    setSuspended: (reason: string) => set((state) => ({
        user: {
            ...state.user,
            isSuspended: true,
            suspensionReason: reason
        }
    }))
}));
