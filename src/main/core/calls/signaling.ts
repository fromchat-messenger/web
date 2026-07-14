import type { CallSignalingMessage, CallAcceptData, CallRejectData, CallOfferData, CallAnswerData, CallIceCandidateData, CallEndData, CallVideoToggleData, CallScreenShareToggleData, CallInviteMessageData } from "@/core/types";
import * as WebRTC from "./webrtc";

export interface CallState {
    receiveCall: (userId: number, username: string) => void;
    endCall: () => void;
    setCallSessionKeyHash: (sessionKeyHash: string) => void;
    setRemoteVideoEnabled: (enabled: boolean) => void;
    setRemoteScreenSharing: (enabled: boolean) => void;
}

/**
 * Handles incoming WebSocket messages related to call signaling
 */
export class CallSignalingHandler {
    private getState: () => CallState;

    constructor(getState: () => CallState) {
        this.getState = getState;
    }

    /**
     * Routes incoming call signaling messages to appropriate handlers
     */
    handleWebSocketMessage(message: CallSignalingMessage) {
        const { data } = message;
        if (!data) {
            return;
        }

        switch (message.type) {
            case "call_invite":
                this.handleCallInvite(message, data as CallInviteMessageData);
                break;
            case "call_accept":
                this.handleCallAccept(data as CallAcceptData);
                break;
            case "call_reject":
                this.handleCallReject(data as CallRejectData);
                break;
            case "call_offer":
                this.handleCallOffer(message, data as CallOfferData);
                break;
            case "call_answer":
                this.handleCallAnswer(message, data as CallAnswerData);
                break;
            case "call_ice_candidate":
                this.handleIceCandidate(message, data as CallIceCandidateData);
                break;
            case "call_end":
                this.handleCallEnd(data as CallEndData);
                break;
            case "call_session_key":
                this.handleCallSessionKey(message);
                break;
            case "call_video_toggle":
                this.handleVideoToggle(message, data as CallVideoToggleData);
                break;
            case "call_screen_share_toggle":
                this.handleScreenShareToggle(message, data as CallScreenShareToggleData);
                break;
        }
    }

    /**
     * Handles incoming call invitation
     */
    private async handleCallInvite(message: CallSignalingMessage, data: CallInviteMessageData) {
        const { fromUsername } = data;
        const fromUserId = message.fromUserId;
        const state = this.getState();

        // First, create the peer connection in WebRTC service
        await WebRTC.handleIncomingCall(fromUserId, fromUsername);

        // Then show incoming call UI
        state.receiveCall(fromUserId, fromUsername);
    }

    /**
     * Handles call acceptance from remote peer
     */
    private async handleCallAccept(data: CallAcceptData) {
        const { fromUserId } = data;
        // Initiator should create and send offer now
        try {
            await WebRTC.onRemoteAccepted(fromUserId);
        } catch (error) {
            console.error("Failed to proceed after accept:", error);
        }
    }

    /**
     * Handles call rejection from remote peer
     */
    private handleCallReject(data: CallRejectData) {
        const state = this.getState();
        const { fromUserId } = data;

        // Clean up WebRTC connection first
        if (fromUserId) {
            WebRTC.cleanupCall(fromUserId);
        }

        // End the call
        state.endCall();
    }

    private async handleCallOffer(message: CallSignalingMessage, data: CallOfferData) {
        await WebRTC.handleCallOffer(message.fromUserId, data);
    }

    private async handleCallAnswer(message: CallSignalingMessage, data: CallAnswerData) {
        await WebRTC.handleCallAnswer(message.fromUserId, data);
    }

    private async handleIceCandidate(message: CallSignalingMessage, data: CallIceCandidateData) {
        await WebRTC.handleIceCandidate(message.fromUserId, data);
    }

    private handleCallEnd(data: CallEndData) {
        const state = this.getState();
        const { fromUserId } = data;

        // Clean up WebRTC connection first
        if (fromUserId) {
            WebRTC.cleanupCall(fromUserId);
        }

        // End the call
        state.endCall();
    }

    private handleCallSessionKey(message: CallSignalingMessage) {
        const state = this.getState();
        const { sessionKeyHash, data } = message;
        if (sessionKeyHash) {
            state.setCallSessionKeyHash(sessionKeyHash);
        }
        if (data && 'wrappedSessionKey' in data && data.wrappedSessionKey && message.fromUserId) {
            WebRTC.receiveWrappedSessionKey(message.fromUserId, data.wrappedSessionKey, sessionKeyHash);
        }
    }

    private handleVideoToggle(message: CallSignalingMessage, data: CallVideoToggleData) {
        const state = this.getState();

        if (data && typeof data.enabled === "boolean" && message.fromUserId) {
            // Update Zustand state (for UI)
            state.setRemoteVideoEnabled(data.enabled);
            // Update WebRTC internal state (for track routing)
            WebRTC.setRemoteVideoEnabled(message.fromUserId, data.enabled);
        } else {
            console.warn("Invalid toggle data:", data);
        }
    }

    private handleScreenShareToggle(message: CallSignalingMessage, data: CallScreenShareToggleData) {
        const state = this.getState();

        if (data && typeof data.enabled === "boolean" && message.fromUserId) {
            // Update Zustand state (for UI)
            state.setRemoteScreenSharing(data.enabled);
            // Update WebRTC internal state (for track routing)
            WebRTC.setRemoteScreenSharing(message.fromUserId, data.enabled);
        } else {
            console.warn("Invalid toggle data:", data);
        }
    }
}
