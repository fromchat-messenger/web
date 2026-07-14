import api from "@/core/api";
import type { CallSignalingMessage, WrappedSessionKeyPayload } from "@/core/types";
import { request } from "@/core/websocket";
import { wrapCallSessionKeyForRecipient, unwrapCallSessionKeyFromSender, rotateCallSessionKey } from "./encryption";
import { importAesGcmKey } from "@fromchat/protocol";
import E2EEWorker from "./e2eeWorker?worker";
import { delay } from "@/utils/utils";

// Constants
const DEFAULT_ICE_SERVERS = [{ urls: "stun:fromchat.ru:3478" }];
const KEY_ROTATION_INTERVAL = 10 * 60 * 1000; // 10 minutes
const NEGOTIATION_DELAY = 100; // ms

/**
 * WebRTC Call class for managing individual call instances
 */
export class WebRTCCall {
    private _peerConnection!: RTCPeerConnection;
    localStream: MediaStream | null = null;
    private localVideoStream: MediaStream | null = null;
    private screenShareStream: MediaStream | null = null;
    readonly remoteUserId: number;
    remoteUsername: string = "";
    isEnding?: boolean = false;
    private isMuted?: boolean = false;
    private isLocalVideoEnabled: boolean = false;
    private isScreenSharing: boolean = false;
    private isRemoteScreenSharing: boolean = false; // Track remote screen share state from signaling
    private isRemoteVideoEnabled: boolean = false; // Track remote video state from signaling
    isNegotiating?: boolean = false;
    // Insertable Streams E2EE
    private _sessionKey: Uint8Array | null = null;
    private _sessionId: string;
    private keyRotationTimer?: NodeJS.Timeout;
    private transformedSenders: Set<RTCRtpSender> = new Set();
    private transformedReceivers: Set<RTCRtpReceiver> = new Set();
    // Track specific senders for proper routing when both video and screen share are active
    private videoSender?: RTCRtpSender | null = null;
    private screenShareSender?: RTCRtpSender | null = null;
    // Track the number of video tracks received for each type
    private receivedVideoTrackCount: number = 0;
    private receivedScreenShareTrackCount: number = 0;

    // -------------------
    // Getters and setters
    // -------------------

    get peerConnection(): RTCPeerConnection {
        return this._peerConnection;
    }

    private set peerConnection(value: RTCPeerConnection) {
        this._peerConnection = value;
    }

    get sessionId(): string {
        return this._sessionId;
    }

    private set sessionId(value: string) {
        this._sessionId = value;
    }

    get sessionKey(): Uint8Array | null {
        return this._sessionKey;
    }

    private set sessionKey(value: Uint8Array | null) {
        this._sessionKey = value;
    }


    // -------------------
    // Core initialization
    // -------------------

    constructor(userId: number) {
        this.remoteUserId = userId;
        this._sessionId = crypto.randomUUID();
    }

    /**
     * Initializes the peer connection with proper ICE servers and sets up event listeners
     */
    async initialize(): Promise<void> {
        this.peerConnection = new RTCPeerConnection({
            iceServers: DEFAULT_ICE_SERVERS
        });

        this.setupEventListeners();
    }

    /**
     * Sets up all peer connection event listeners
     */
    private setupEventListeners(): void {
        // Add ICE candidate event listener for sending
        this.peerConnection.addEventListener("icecandidate", async (event) => {
            if (event.candidate) {
                const { candidate, sdpMLineIndex, sdpMid } = event.candidate;

                try {
                    await sendSignalingMessage({
                        type: "call_ice_candidate",
                        fromUserId: 0,
                        toUserId: this.remoteUserId,
                        data: { candidate, sdpMLineIndex, sdpMid }
                    });
                } catch (error) {
                    console.error("Failed to send ICE candidate:", error);
                }
            }
        });

        this.peerConnection.addEventListener("iceconnectionstatechange", () => {
            // ICE connection state changed
        });

        this.peerConnection.addEventListener("signalingstatechange", () => {
            // Signaling state changed
        });

        // Handle renegotiation when tracks are added/removed
        this.peerConnection.addEventListener("negotiationneeded", async () => {
            try {
                // Prevent multiple simultaneous negotiations
                if (this.isNegotiating) {
                    return;
                }

                // Skip if we're in "stable" state and haven't finished the initial handshake
                if (this.peerConnection.signalingState !== "stable") {
                    return;
                }

                this.isNegotiating = true;

                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);

                await sendSignalingMessage({
                    type: "call_offer",
                    fromUserId: 0,
                    toUserId: this.remoteUserId,
                    data: offer
                });

                this.isNegotiating = false;
            } catch (error) {
                console.error("Failed to handle negotiation:", error);
                this.isNegotiating = false;
            }
        });

        // Handle remote stream
        this.peerConnection.addEventListener("track", async (event) => {
            const [remoteStream] = event.streams;
            if (remoteStream) {
                const track = event.track;

                // Apply E2EE transform to all tracks - video now uses header-preserving encryption
                if (this.sessionKey && window.RTCRtpScriptTransform) {
                    try {
                        const receiver = this.peerConnection.getReceivers().find(r => r.track === track);
                        if (receiver && !this.transformedReceivers.has(receiver)) {
                            const key = await importAesGcmKey(this.sessionKey);
                            receiver.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: 'decrypt', sessionId: this.sessionId });
                            this.transformedReceivers.add(receiver);
                        }
                    } catch (error) {
                        console.error("Failed to apply E2EE to received track:", error);
                    }
                }

                // Determine stream type based on track kind and signaling state
                if (track.kind === "video") {
                    let isScreenShare = false;
                    let isVideo = false;

                    if (this.isRemoteScreenSharing && this.isRemoteVideoEnabled) {
                        // Both active - route based on which one we haven't received yet
                        // Simple logic: if we haven't received video yet, this is video
                        // if we haven't received screen share yet, this is screen share
                        if (this.receivedVideoTrackCount === 0) {
                            isVideo = true;
                            this.receivedVideoTrackCount++;
                        } else if (this.receivedScreenShareTrackCount === 0) {
                            isScreenShare = true;
                            this.receivedScreenShareTrackCount++;
                        } else {
                            // Both already received - this might be a track replacement
                            isScreenShare = true;
                        }
                    } else if (this.isRemoteScreenSharing) {
                        isScreenShare = true;
                        this.receivedScreenShareTrackCount++;
                    } else if (this.isRemoteVideoEnabled) {
                        isVideo = true;
                        this.receivedVideoTrackCount++;
                    }

                    if (isScreenShare) {
                        if (callbacks.onRemoteScreenShare) {
                            callbacks.onRemoteScreenShare(this.remoteUserId, remoteStream);
                        }
                    } else if (isVideo) {
                        if (callbacks.onRemoteVideoStream) {
                            callbacks.onRemoteVideoStream(this.remoteUserId, remoteStream);
                        }
                    }
                } else if (track.kind === "audio") {
                    // Handle remote audio (existing behavior)
                    if (callbacks.onRemoteStream) {
                        callbacks.onRemoteStream(this.remoteUserId, remoteStream);
                    }
                }
            }
        });

        // Handle connection state changes
        this.peerConnection.addEventListener("connectionstatechange", () => {
            // WebRTC connection state changed
            if (callbacks.onCallStateChange) {
                callbacks.onCallStateChange(this.remoteUserId, this.peerConnection.connectionState);
            }

            // Clean up only on permanent failures
            // Don't end on "disconnected" - ICE can recover from temporary disconnections
            if (this.peerConnection.connectionState === "failed" ||
                this.peerConnection.connectionState === "closed") {
                // Only send end call message if we're not already cleaning up
                if (!this.isEnding) {
                    this.isEnding = true;
                    endCall(this.remoteUserId);
                }
            }
        });
    }


    // ----------
    // Management
    // ----------

    /**
     * Toggles mute state for this call
     */
    toggleMute(): boolean {
        if (!this.localStream) {
            return false;
        }

        if (!this.isMuted) {
            // Mute: Stop the track completely (no green dot)
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.stop();
                this.localStream.removeTrack(audioTrack);
            }

            // Create a silent audio track using Web Audio API
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const audioContext = new AudioContextClass();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            // Set gain to 0 (silent)
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);

            // Connect nodes
            oscillator.connect(gainNode);

            // Create a MediaStreamDestination to get a MediaStream
            const destination = audioContext.createMediaStreamDestination();
            gainNode.connect(destination);

            // Start the oscillator (but it's silent due to gain = 0)
            oscillator.start();

            // Add the silent track to maintain WebRTC connection
            const silentTrack = destination.stream.getAudioTracks()[0];
            if (silentTrack) {
                this.localStream.addTrack(silentTrack);
            }

            this.isMuted = true;
            return true; // Muted
        } else {
            // Unmute: Re-enable microphone by getting new audio stream
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(newStream => {
                    // Remove any existing audio tracks from the stream
                    this.localStream!.getAudioTracks().forEach(track => track.stop());

                    // Get the new active track
                    const newAudioTrack = newStream.getAudioTracks()[0];

                    // Replace the track in the peer connection
                    const sender = this.peerConnection.getSenders().find(s =>
                        s.track && s.track.kind === 'audio'
                    );

                    if (sender) {
                        // Replace the track in the existing sender
                        sender.replaceTrack(newAudioTrack);
                    } else {
                        // Add the track to the peer connection if no sender exists
                        this.peerConnection.addTrack(newAudioTrack, this.localStream!);
                    }

                    // Add the track to the local stream
                    this.localStream!.addTrack(newAudioTrack);

                    this.isMuted = false;
                })
                .catch(error => {
                    console.error("Failed to re-enable microphone:", error);
                });
            return false; // Unmuted
        }
    }

    /**
     * Toggles video for this call
     */
    async toggleVideo(): Promise<boolean> {
        if (!this.isLocalVideoEnabled) {
            // Enable video
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });

                this.localVideoStream = videoStream;
                this.isLocalVideoEnabled = true;

                // Add video track to peer connection
                const videoTrack = videoStream.getVideoTracks()[0];
                const sender = this.peerConnection.addTrack(videoTrack, videoStream);
                this.videoSender = sender;

                // Apply E2EE transform with header-preserving encryption for video
                if (this.sessionKey && window.RTCRtpScriptTransform) {
                    try {
                        const key = await importAesGcmKey(this.sessionKey);
                        const sender = this.peerConnection.getSenders().find(s => s.track === videoTrack);
                        if (sender && !this.transformedSenders.has(sender)) {
                            sender.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: "encrypt", sessionId: this.sessionId });
                            this.transformedSenders.add(sender);
                        }
                    } catch (error) {
                        console.error("Failed to apply E2EE to video:", error);
                        throw error; // Fail securely
                    }
                }

                // Notify local video stream handler
                if (callbacks.onLocalVideoStream) {
                    callbacks.onLocalVideoStream(this.remoteUserId, videoStream);
                }

                // Send signaling message to notify remote peer
                await sendSignalingMessage({
                    type: "call_video_toggle",
                    fromUserId: 0,
                    toUserId: this.remoteUserId,
                    data: { enabled: true }
                });

                return true;
            } catch (error) {
                console.error("Failed to enable video:", error);
                return false;
            }
        } else {
            // Disable video
            if (this.localVideoStream) {
                this.localVideoStream.getTracks().forEach(track => {
                    track.stop();
                    // Remove track from peer connection
                    const senders = this.peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track === track);
                    if (videoSender) {
                        this.peerConnection.removeTrack(videoSender);
                        this.transformedSenders.delete(videoSender);
                        // Clear sender reference
                        if (this.videoSender === videoSender) {
                            this.videoSender = null;
                        }
                    }
                });
                this.localVideoStream = null;
            }

            this.isLocalVideoEnabled = false;

            // Notify local video stream handler
            if (callbacks.onLocalVideoStream) {
                callbacks.onLocalVideoStream(this.remoteUserId, null);
            }

            // Send signaling message to notify remote peer
            await sendSignalingMessage({
                type: "call_video_toggle",
                fromUserId: 0,
                toUserId: this.remoteUserId,
                data: { enabled: false }
            });

            return false;
        }
    }

    /**
     * Toggles screen sharing for this call
     */
    async toggleScreenShare(): Promise<boolean> {
        if (!this.isScreenSharing) {
            // Enable screen sharing
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        width: { ideal: 1920, max: 3840 },
                        height: { ideal: 1080, max: 2160 },
                        frameRate: { ideal: 60, max: 60 }
                    },
                    audio: false
                });

                // Set a special ID to identify screen share streams
                try {
                    Object.defineProperty(screenStream, "id", {
                        value: `screen-${crypto.randomUUID()}`,
                        writable: false,
                        configurable: true
                    });
                } catch (e) {
                    // Use default stream ID
                }

                this.screenShareStream = screenStream;
                this.isScreenSharing = true;

                // Add screen share track to peer connection
                const videoTrack = screenStream.getVideoTracks()[0];

                // Handle when user stops sharing via browser UI
                videoTrack.addEventListener("ended", async () => {

                    // Clean up screen share state
                    if (this.screenShareStream) {
                        this.screenShareStream.getTracks().forEach(t => t.stop());
                        this.screenShareStream = null;
                    }
                    this.isScreenSharing = false;

                    // Remove screen share track from peer connection
                    const senders = this.peerConnection.getSenders();
                    const screenSender = senders.find(sender =>
                        sender.track && sender.track.kind === 'video' &&
                        sender.track.readyState === 'ended' &&
                        this.transformedSenders.has(sender)
                    );

                    if (screenSender) {
                        await this.peerConnection.removeTrack(screenSender);
                        this.transformedSenders.delete(screenSender);
                    }

                    // Notify local screen share handler
                    if (callbacks.onLocalScreenShare) {
                        callbacks.onLocalScreenShare(this.remoteUserId, null);
                    }

                    // Notify state change handler
                    if (callbacks.onScreenShareStateChange) {
                        callbacks.onScreenShareStateChange(this.remoteUserId, false);
                    }

                    // Send signaling message to remote peer
                    await sendSignalingMessage({
                        type: "call_screen_share_toggle",
                        fromUserId: 0, // Will be set by server
                        toUserId: this.remoteUserId,
                        data: { enabled: false }
                    });
                });

                // Send signaling message FIRST to notify remote peer before adding track
                // This ensures the receiver knows it's screen share before the track arrives
                await sendSignalingMessage({
                    type: "call_screen_share_toggle",
                    fromUserId: 0,
                    toUserId: this.remoteUserId,
                    data: { enabled: true }
                });

                // Small delay to ensure signaling message is processed before track arrives
                await delay(NEGOTIATION_DELAY);

                const sender = this.peerConnection.addTrack(videoTrack, screenStream);
                this.screenShareSender = sender;

                // CRITICAL: Apply E2EE transform IMMEDIATELY after track is added
                if (this.sessionKey && window.RTCRtpScriptTransform) {
                    try {
                        const key = await importAesGcmKey(this.sessionKey);
                        const sender = this.peerConnection.getSenders().find(s => s.track === videoTrack);

                        if (sender && !this.transformedSenders.has(sender)) {
                            sender.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: "encrypt", sessionId: this.sessionId });
                            this.transformedSenders.add(sender);
                        }
                    } catch (error) {
                        console.error("Failed to apply E2EE to screen share:", error);
                        throw error; // Fail securely
                    }
                }

                // Notify local screen share handler
                if (callbacks.onLocalScreenShare) {
                    callbacks.onLocalScreenShare(this.remoteUserId, screenStream);
                }

                return true;
            } catch (error) {
                console.error("Failed to enable screen sharing:", error);
                return false;
            }
        } else {
            // Disable screen sharing
            if (this.screenShareStream) {
                this.screenShareStream.getTracks().forEach(track => {
                    track.stop();
                    // Remove track from peer connection
                    const senders = this.peerConnection.getSenders();
                    const screenSender = senders.find(s => s.track === track);
                    if (screenSender) {
                        this.peerConnection.removeTrack(screenSender);
                        this.transformedSenders.delete(screenSender);
                        // Clear sender reference
                        if (this.screenShareSender === screenSender) {
                            this.screenShareSender = null;
                        }
                    }
                });
                this.screenShareStream = null;
            }

            this.isScreenSharing = false;

            // Notify local screen share handler
            if (callbacks.onLocalScreenShare) {
                callbacks.onLocalScreenShare(this.remoteUserId, null);
            }

            // Send signaling message to notify remote peer
            await sendSignalingMessage({
                type: "call_screen_share_toggle",
                fromUserId: 0,
                toUserId: this.remoteUserId,
                data: { enabled: false }
            });

            return false;
        }
    }


    // ---------
    // Lifecycle
    // ---------

    /**
     * Sets session key for this call
     */
    async setSessionKey(keyBytes: Uint8Array): Promise<void> {
        this.sessionKey = keyBytes;

        await this.applyE2EETransforms();

        // Start key rotation timer (rotate every 10 minutes for long calls)
        if (this.keyRotationTimer) {
            clearInterval(this.keyRotationTimer);
        }

        this.keyRotationTimer = setInterval(async () => {
            await this.rotateSessionKey();
        }, KEY_ROTATION_INTERVAL);
    }

    /**
     * Rotates session key for this call
     */
    private async rotateSessionKey(): Promise<void> {
        if (!this.sessionKey) return;

        try {
            // Generate new session key
            const newSessionKey = await rotateCallSessionKey();

            // Update the call with new session key
            this.sessionKey = newSessionKey.key;

            // Reapply E2EE transforms with new key
            await this.applyE2EETransforms();
        } catch (error) {
            console.error("Failed to rotate session key:", error);
        }
    }

    /**
     * Applies E2EE transforms to this call
     */
    private async applyE2EETransforms(): Promise<void> {
        try {
            if (!this.sessionKey || !window.RTCRtpScriptTransform) {
                return;
            }

            const key = await importAesGcmKey(this.sessionKey);

            // Apply to receivers that don't already have transforms
            const receivers = this.peerConnection.getReceivers();
            for (const receiver of receivers) {
                if (receiver.track && !this.transformedReceivers.has(receiver)) {
                    receiver.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: 'decrypt', sessionId: this.sessionId });
                    this.transformedReceivers.add(receiver);
                }
            }

            // Apply to senders that don't already have transforms
            const senders = this.peerConnection.getSenders();
            for (const sender of senders) {
                if (sender.track && !this.transformedSenders.has(sender)) {
                    sender.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: 'encrypt', sessionId: this.sessionId });
                    this.transformedSenders.add(sender);
                }
            }
        } catch (error) {
            console.error("Failed to apply E2EE transforms:", error);
        }
    }

    /**
     * Creates E2EE transform for this call
     */
    async createE2EETransform(sessionKey: Uint8Array, sessionId?: string): Promise<void> {
        try {
            if (!sessionKey || !window.RTCRtpScriptTransform) {
                return;
            }

            const key = await importAesGcmKey(sessionKey);

            // Apply to receivers that don't already have transforms
            const receivers = this.peerConnection.getReceivers();
            for (const receiver of receivers) {
                if (receiver.track && !this.transformedReceivers.has(receiver)) {
                    receiver.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: 'decrypt', sessionId });
                    this.transformedReceivers.add(receiver);
                }
            }

            // Apply to senders that don't already have transforms
            const senders = this.peerConnection.getSenders();
            for (const sender of senders) {
                if (sender.track && !this.transformedSenders.has(sender)) {
                    sender.transform = new RTCRtpScriptTransform(new E2EEWorker(), { key, mode: 'encrypt', sessionId });
                    this.transformedSenders.add(sender);
                }
            }
        } catch (error) {
            console.error("Failed to create E2EE transform:", error);
            // Fail securely - throw to prevent call from continuing without E2EE
            throw error;
        }
    }

    /**
     * Sets remote video enabled state
     */
    setRemoteVideoEnabled(enabled: boolean): void {
        this.isRemoteVideoEnabled = enabled;
        // Reset counter when feature is disabled
        if (!enabled) {
            this.receivedVideoTrackCount = 0;
        }
    }

    /**
     * Sets remote screen sharing state
     */
    setRemoteScreenSharing(enabled: boolean): void {
        this.isRemoteScreenSharing = enabled;
        // Reset counter when feature is disabled
        if (!enabled) {
            this.receivedScreenShareTrackCount = 0;
        }
    }

    /**
     * Cleans up this call
     */
    cleanup(): void {
        // Clear key rotation timer
        if (this.keyRotationTimer) {
            clearInterval(this.keyRotationTimer);
        }

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }

        // Stop local video stream
        if (this.localVideoStream) {
            this.localVideoStream.getTracks().forEach(track => track.stop());
        }

        // Stop screen share stream
        if (this.screenShareStream) {
            this.screenShareStream.getTracks().forEach(track => track.stop());
        }
    }
}

// Global state
export const callbacks = {
    onCallStateChange: null as ((userId: number, state: string) => void) | null,
    onRemoteStream: null as ((userId: number, stream: MediaStream) => void) | null,
    onLocalVideoStream: null as ((userId: number, stream: MediaStream | null) => void) | null,
    onRemoteVideoStream: null as ((userId: number, stream: MediaStream | null) => void) | null,
    onLocalScreenShare: null as ((userId: number, stream: MediaStream | null) => void) | null,
    onRemoteScreenShare: null as ((userId: number, stream: MediaStream | null) => void) | null,
    onScreenShareStateChange: null as ((userId: number, isSharing: boolean) => void) | null,
}

const calls: Map<number, WebRTCCall> = new Map();

/**
 * Sends a signaling message via WebSocket
 */
async function sendSignalingMessage(message: CallSignalingMessage) {
    await request({
        type: "call_signaling",
        credentials: {
            scheme: "Bearer",
            credentials: api.user.auth.getAuthToken()!
        },
        data: message
    });
}


async function createPeerConnection(userId: number): Promise<WebRTCCall> {
    const call = new WebRTCCall(userId);
    await call.initialize();
    calls.set(userId, call);
    return call;
}

/**
 * Initiates a call to the specified user
 * @param userId - The ID of the user to call
 * @param username - The username of the user to call
 * @returns Promise that resolves to true if call was initiated successfully
 */
export async function initiateCall(userId: number, username: string): Promise<boolean> {
    try {
        // Get user media
        const localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        // Create peer connection
        const call = await createPeerConnection(userId);
        if (!call) return false;

        call.localStream = localStream;
        call.remoteUsername = username;

        // Add tracks to peer connection
        localStream.getTracks().forEach(track => call.peerConnection.addTrack(track, localStream));

        // Enable insertable streams encryption on sender side if supported
        try {
            if (call.peerConnection.getSenders().length > 0 && window.RTCRtpScriptTransform) {
                const senders = call.peerConnection.getSenders();
                for (const sender of senders) {
                    if (!sender.track || sender.track.kind !== "audio") continue;
                    // just mark; actual key set after wrap/send
                }
            }
        } catch {}

        // Send call invite
        await sendSignalingMessage({
            type: "call_invite",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            data: {
                fromUsername: username
            }
        });

        return true;
    } catch (error) {
        console.error("Failed to initiate call:", error);
        cleanupCall(userId);
        return false;
    }
}

export async function sendCallSessionKey(userId: number, sessionKeyHash: string): Promise<void> {
    try {
        await sendSignalingMessage({
            type: "call_session_key",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            sessionKeyHash,
            data: {}
        });
    } catch (error) {
        console.error("Failed to send call session key:", error);
    }
}

export async function sendWrappedCallSessionKey(userId: number, sessionKey: Uint8Array, sessionKeyHash: string): Promise<void> {
    try {
        const recipientPublicKey = await api.chats.dm.fetchUserPublicKey(userId, api.user.auth.getAuthToken()!);
        if (!recipientPublicKey) {
            console.warn("No recipient public key for", userId);
            return;
        }
        const wrapped = await wrapCallSessionKeyForRecipient(recipientPublicKey, sessionKey);
        await sendSignalingMessage({
            type: "call_session_key",
            fromUserId: 0,
            toUserId: userId,
            sessionKeyHash,
            data: { wrappedSessionKey: wrapped }
        });
    } catch (e) {
        console.error("Failed to send wrapped session key:", e);
    }
}

export async function setSessionKey(userId: number, keyBytes: Uint8Array): Promise<void> {
    const call = calls.get(userId);
    if (!call) {
        console.error("setSessionKey: No call found for user", userId);
        return;
    }

    await call.setSessionKey(keyBytes);
}


export async function receiveWrappedSessionKey(
    fromUserId: number,
    wrappedPayload: WrappedSessionKeyPayload,
    sessionKeyHash?: string
): Promise<void> {
    try {
        const senderPublicKey = await api.chats.dm.fetchUserPublicKey(fromUserId, api.user.auth.getAuthToken()!);
        if (!senderPublicKey) {
            console.error("Failed to get sender public key");
            return;
        }
        if (!wrappedPayload || !sessionKeyHash) {
            console.error("Missing wrapped payload or session key hash");
            return;
        }

        // Unwrap the session key from the encrypted payload
        const unwrappedSessionKey = await unwrapCallSessionKeyFromSender(senderPublicKey, {
            salt: wrappedPayload.salt,
            iv2: wrappedPayload.iv2,
            wrapped: wrappedPayload.wrapped
        });

        // Use the unwrapped session key directly (both sides should have the same key)
        await setSessionKey(fromUserId, unwrappedSessionKey);
    } catch (e) {
        console.error("Failed to unwrap session key:", e);
    }
}

/**
 * Accepts an incoming call from the specified user
 * @param userId - The ID of the user who initiated the call
 * @returns Promise that resolves to true if call was accepted successfully
 */
export async function acceptCall(userId: number): Promise<boolean> {
    try {
        let call = calls.get(userId);
        if (!call) {
            // Create call object if it doesn't exist (for race conditions)
            call = await createPeerConnection(userId);
            if (!call) return false;
        }

        // Get user media and attach (only if not already attached)
        if (!call.localStream) {
            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            call.localStream = localStream;
            localStream.getTracks().forEach(track => call!.peerConnection.addTrack(track, localStream));
        }

        // Notify initiator that callee accepted; initiator will generate offer
        await sendSignalingMessage({
            type: "call_accept",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            data: {}
        });

        return true;
    } catch (error) {
        console.error("Failed to accept call:", error);
        cleanupCall(userId);
        return false;
    }
}

export async function rejectCall(userId: number): Promise<void> {
    await sendSignalingMessage({
        type: "call_reject",
        fromUserId: 0, // Will be set by server
        toUserId: userId,
        data: {}
    });

    cleanupCall(userId);
}

export async function endCall(userId: number): Promise<void> {
    const call = calls.get(userId);
    if (call && !call.isEnding) {
        call.isEnding = true;

        // Send call end message
        await sendSignalingMessage({
            type: "call_end",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            data: {}
        });

        cleanupCall(userId);
    }
}

export async function handleIncomingCall(userId: number, username: string): Promise<void> {
    try {
        // Create peer connection for incoming call
        const call = await createPeerConnection(userId);
        if (!call) return;

        call.remoteUsername = username;
    } catch (error) {
        console.error("Failed to handle incoming call:", error);
        cleanupCall(userId);
    }
}

export async function onRemoteAccepted(userId: number): Promise<void> {
    const call = calls.get(userId);
    if (!call) {
        throw new Error("No call found to accept");
    }

    try {
        // Small delay to ensure remote peer finishes processing the accept
        // This prevents race conditions where our offer arrives before they're ready
        await delay(NEGOTIATION_DELAY);

        // Create offer
        const offer = await call.peerConnection.createOffer();
        await call.peerConnection.setLocalDescription(offer);

        // Send offer to remote peer
        await sendSignalingMessage({
            type: "call_offer",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            data: offer
        });
    } catch (error) {
        console.error("Failed to create offer:", error);
        throw error;
    }
}

export async function handleCallOffer(userId: number, offer: RTCSessionDescriptionInit): Promise<void> {
    let call = calls.get(userId);

    // Handle race condition - offer might arrive before peer connection is created
    if (!call) {
        call = await createPeerConnection(userId);
        if (!call) {
            throw new Error("Failed to create call for offer");
        }
    }

    try {
        // Ensure we have local media before answering
        if (!call.localStream) {
            try {
                const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                call.localStream = localStream;
                localStream.getTracks().forEach(track => call!.peerConnection.addTrack(track, localStream));
            } catch (mediaError) {
                console.error("Failed to get local media:", mediaError);
                // Continue anyway - we can still receive media
            }
        }

        // Set remote description
        await call.peerConnection.setRemoteDescription(offer);

        // Create answer
        const answer = await call.peerConnection.createAnswer();
        await call.peerConnection.setLocalDescription(answer);

        // Attach transforms on callee side if session key is available
        // If not available yet, setSessionKey will apply them when it arrives
        if (call.sessionKey) {
            await call.createE2EETransform(call.sessionKey, call.sessionId);
        }

        // Send answer to remote peer
        await sendSignalingMessage({
            type: "call_answer",
            fromUserId: 0, // Will be set by server
            toUserId: userId,
            data: answer
        });
    } catch (error) {
        console.error("Failed to handle offer:", error);
        throw error;
    }
}

export async function handleCallAnswer(userId: number, answer: RTCSessionDescriptionInit): Promise<void> {
    const call = calls.get(userId);
    if (!call) {
        throw new Error("No call found for answer");
    }

    try {
        await call.peerConnection.setRemoteDescription(answer);

        // Reset negotiating flag
        call.isNegotiating = false;

        // Attach transforms on initiator side if session key is available
        // If not available yet, setSessionKey will apply them when it arrives
        if (call.sessionKey) {
            await call.createE2EETransform(call.sessionKey, call.sessionId);
        }

        // Check if there are new receivers with tracks that haven't been notified yet
        // This handles the case where tracks exist but the track event hasn't fired yet
        const receivers = call.peerConnection.getReceivers();
        for (const receiver of receivers) {
            if (receiver.track) {
                const track = receiver.track;

                // Find the stream for this track
                const transceiver = call.peerConnection.getTransceivers().find(t => t.receiver === receiver);
                if (transceiver && transceiver.receiver.track) {
                    // Manually trigger stream handlers for tracks that didn't fire events
                    if (track.kind === "video" && callbacks.onRemoteVideoStream) {
                        // Create a MediaStream from the track
                        const stream = new MediaStream([track]);
                        callbacks.onRemoteVideoStream(userId, stream);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Failed to handle answer:", error);
        throw error;
    }
}

export async function handleIceCandidate(userId: number, candidate: RTCIceCandidateInit): Promise<void> {
    let call = calls.get(userId);
    if (!call) {
        // Don't create peer connection here - ICE candidates will be gathered again after connection is established
        return;
    }

    try {
        await call.peerConnection.addIceCandidate(candidate);
    } catch (error) {
        console.error("Failed to add ICE candidate:", error);
    }
}

export function toggleMute(userId: number): boolean {
    const call = calls.get(userId);
    if (!call) {
        return false;
    }
    return call.toggleMute();
}

export function getCall(userId: number): WebRTCCall | undefined {
    return calls.get(userId);
}

export async function toggleVideo(userId: number): Promise<boolean> {
    const call = calls.get(userId);
    if (!call) {
        return false;
    }
    return await call.toggleVideo();
}

export async function toggleScreenShare(userId: number): Promise<boolean> {
    const call = calls.get(userId);
    if (!call) {
        return false;
    }
    return await call.toggleScreenShare();
}

export function cleanupCall(userId: number): void {
    const call = calls.get(userId);
    if (call) {
        call.cleanup();
        calls.delete(userId);
    }
}

/**
 * Update the remote video enabled state (called when receiving signaling)
 */
export function setRemoteVideoEnabled(userId: number, enabled: boolean): void {
    const call = calls.get(userId);
    if (call) {
        call.setRemoteVideoEnabled(enabled);
    }
}

/**
 * Update the remote screen sharing state (called when receiving signaling)
 */
export function setRemoteScreenSharing(userId: number, enabled: boolean): void {
    const call = calls.get(userId);
    if (call) {
        call.setRemoteScreenSharing(enabled);
    }
}

export function cleanup(): void {
    // Clean up all calls
    for (const userId of calls.keys()) {
        cleanupCall(userId);
    }
    calls.clear();
}