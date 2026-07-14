import { create } from "zustand";
import type { CallStatus, CallState } from "./types";

interface CallStore {
    call: CallState;
    startCall: (userId: number, username: string) => void;
    endCall: () => void;
    setCallStatus: (status: CallStatus) => void;
    toggleMute: () => void;
    toggleCallMinimize: () => void;
    receiveCall: (userId: number, username: string) => void;
    setCallEncryption: (sessionKeyHash: string, encryptionEmojis: string[]) => void;
    setCallSessionKeyHash: (sessionKeyHash: string) => void;
    toggleVideo: () => void;
    toggleScreenShare: () => void;
    setRemoteVideoEnabled: (enabled: boolean) => void;
    setRemoteScreenSharing: (enabled: boolean) => void;
    toggleCallMinimized: () => void;
}

const initialCallState: CallState = {
    isActive: false,
    status: "ended",
    startTime: null,
    isMuted: false,
    remoteUserId: null,
    remoteUsername: null,
    isInitiator: false,
    isMinimized: false,
    sessionKeyHash: null,
    encryptionEmojis: [],
    isVideoEnabled: false,
    isRemoteVideoEnabled: false,
    isSharingScreen: false,
    isRemoteScreenSharing: false
};

export const useCallStore = create<CallStore>((set) => ({
    call: initialCallState,
    startCall: (userId: number, username: string) => set({
        call: {
            ...initialCallState,
            isActive: true,
            status: "calling",
            remoteUserId: userId,
            remoteUsername: username,
            isInitiator: true
        }
    }),
    endCall: () => set({ call: initialCallState }),
    setCallStatus: (status: CallStatus) => set((state) => ({
        call: {
            ...state.call,
            status,
            startTime: status === "active" && !state.call.startTime ? Date.now() : state.call.startTime
        }
    })),
    toggleMute: () => set((state) => ({
        call: {
            ...state.call,
            isMuted: !state.call.isMuted
        }
    })),
    toggleCallMinimize: () => set((state) => ({
        call: {
            ...state.call,
            isMinimized: !state.call.isMinimized
        }
    })),
    receiveCall: (userId: number, username: string) => set({
        call: {
            ...initialCallState,
            isActive: true,
            status: "calling",
            remoteUserId: userId,
            remoteUsername: username,
            isInitiator: false
        }
    }),
    setCallEncryption: (sessionKeyHash: string, encryptionEmojis: string[]) => set((state) => ({
        call: {
            ...state.call,
            sessionKeyHash,
            encryptionEmojis
        }
    })),
    setCallSessionKeyHash: (sessionKeyHash: string) => set((state) => ({
        call: {
            ...state.call,
            sessionKeyHash
        }
    })),
    toggleVideo: () => set((state) => ({
        call: {
            ...state.call,
            isVideoEnabled: !state.call.isVideoEnabled
        }
    })),
    toggleScreenShare: () => set((state) => ({
        call: {
            ...state.call,
            isSharingScreen: !state.call.isSharingScreen
        }
    })),
    setRemoteVideoEnabled: (enabled: boolean) => set((state) => ({
        call: {
            ...state.call,
            isRemoteVideoEnabled: enabled
        }
    })),
    setRemoteScreenSharing: (enabled: boolean) => set((state) => ({
        call: {
            ...state.call,
            isRemoteScreenSharing: enabled
        }
    })),
    toggleCallMinimized: () => set((state) => ({
        call: {
            ...state.call,
            isMinimized: !state.call.isMinimized
        }
    }))
}));
