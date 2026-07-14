import type { Message, User, VerificationStatus } from "@/core/types";
import { MessagePanel } from "@/pages/chat/ui/right/panels/MessagePanel";
import { PublicChatPanel } from "@/pages/chat/ui/right/panels/PublicChatPanel";
import { DMPanel } from "@/pages/chat/ui/right/panels/DMPanel";

export type ChatTabs = "chats" | "channels" | "contacts";

export type CallStatus = "calling" | "connecting" | "active" | "ended";

export interface ProfileDialogData {
    userId?: number;
    username?: string;
    display_name?: string;
    profilePicture?: string;
    bio?: string;
    memberSince?: string;
    online?: boolean;
    isOwnProfile: boolean;
    verified?: boolean;
    verification_status?: VerificationStatus;
    suspended?: boolean;
    suspension_reason?: string | null;
    deleted?: boolean;
}

export interface ActiveDM {
    userId: number;
    username: string;
    publicKey: string | null;
}

export interface CallState {
    isActive: boolean;
    status: CallStatus;
    startTime: number | null;
    isMuted: boolean;
    remoteUserId: number | null;
    remoteUsername: string | null;
    isInitiator: boolean;
    isMinimized: boolean;
    sessionKeyHash: string | null;
    encryptionEmojis: string[];
    isVideoEnabled: boolean;
    isRemoteVideoEnabled: boolean;
    isSharingScreen: boolean;
    isRemoteScreenSharing: boolean;
}

export interface ChatState {
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
    call: CallState;
    profileDialog: ProfileDialogData | null;
    onlineStatuses: Map<number, {online: boolean, lastSeen: string}>;
    typingUsers: Map<number, string>; // userId -> username
    dmTypingUsers: Map<number, boolean>;
}

export interface UserState {
    currentUser: User | null;
    authToken: string | null;
    isSuspended: boolean;
    suspensionReason: string | null;
}

