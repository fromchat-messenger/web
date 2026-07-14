import { useCallStore } from "@/state/call";
import { useUserStore } from "@/state/user";
import * as WebRTC from "@/core/calls/webrtc";
import { CallSignalingHandler } from "@/core/calls/signaling";
import { setCallSignalingHandler } from "@/core/websocket";
import { generateCallSessionKey, generateCallEmojis } from "@/core/calls/encryption";
import { createRef, useEffect } from "react";
import { doAfterInteraction } from "@/utils/utils";

// Global refs shared across all instances
let globalRemoteAudioRef = createRef<HTMLAudioElement>();
let globalLocalVideoRef = createRef<HTMLVideoElement>();
let globalRemoteVideoRef = createRef<HTMLVideoElement>();
let globalLocalScreenShareRef = createRef<HTMLVideoElement>();
let globalRemoteScreenShareRef = createRef<HTMLVideoElement>();

export default function useCall() {
    const {
        call,
        startCall,
        endCall,
        setCallStatus,
        toggleMute,
        toggleVideo,
        toggleScreenShare,
        setCallEncryption,
        setCallSessionKeyHash,
        setRemoteVideoEnabled,
        setRemoteScreenSharing,
        receiveCall
    } = useCallStore();
    const { user } = useUserStore();

    const remoteAudioRef = globalRemoteAudioRef;
    const localVideoRef = globalLocalVideoRef;
    const remoteVideoRef = globalRemoteVideoRef;
    const localScreenShareRef = globalLocalScreenShareRef;
    const remoteScreenShareRef = globalRemoteScreenShareRef;

    useEffect(() => {
        // Initialize call signaling handler
        const signalingHandler = new CallSignalingHandler(() => ({
            receiveCall: (userId: number, username: string) => {
                // Use the receiveCall function from state
                receiveCall(userId, username);
            },
            endCall,
            setCallSessionKeyHash,
            setRemoteVideoEnabled,
            setRemoteScreenSharing
        }));
        setCallSignalingHandler(signalingHandler);

        // Set up call state change handler
        WebRTC.callbacks.onCallStateChange = (userId: number, state: string) => {
            const currentCall = call;
            if (currentCall.remoteUserId === userId) {
                switch (state) {
                    case "connecting":
                        setCallStatus("connecting");
                        break;
                    case "connected":
                        setCallStatus("active");
                        break;
                    case "disconnected":
                    case "failed":
                    case "closed":
                        endCall();
                        break;
                }
            }
        };

        // Set up remote audio stream handler
        WebRTC.callbacks.onRemoteStream = (_userId: number, stream: MediaStream) => {
            if (!remoteAudioRef.current) {
                return;
            }
            const el = remoteAudioRef.current;
            try {
                el.srcObject = stream;
                el.muted = false;
                el.volume = 1.0;
                el.autoplay = true;

                // Handle audio events
                el.addEventListener("error", () => {
                    console.warn("[AUDIO] element error", (el.error?.message) || el.error);
                });

                el.play().catch(() => {
                    doAfterInteraction(() => el.play());
                });
            } catch (e) {
                console.warn("failed to attach remote stream:", e);
            }
        };

        // Set up local video stream handler
        WebRTC.callbacks.onLocalVideoStream = (_userId: number, stream: MediaStream | null) => {
            if (!localVideoRef.current) {
                return;
            }
            const el = localVideoRef.current;
            try {
                el.srcObject = stream;
                el.muted = true; // Always mute local video to avoid feedback
                el.autoplay = true;
                if (stream) {
                    el.play().catch((err) => {
                        console.error("Failed to play local video:", err);
                        doAfterInteraction(() => el.play()).catch(() => {});
                    });
                }
            } catch (e) {
                console.warn("failed to attach local video stream:", e);
            }
        };

        // Set up remote video stream handler
        WebRTC.callbacks.onRemoteVideoStream = (_userId: number, stream: MediaStream | null) => {
            if (!remoteVideoRef.current) {
                return;
            }
            const el = remoteVideoRef.current;
            try {
                el.srcObject = stream;
                el.muted = false;
                el.autoplay = true;
                if (stream) {
                    el.play().catch((err) => {
                        console.error("Failed to play remote video:", err);
                        doAfterInteraction(() => el.play()).catch(() => {});
                    });
                }
            } catch (e) {
                console.warn("failed to attach remote video stream:", e);
            }
        };

        // Set up local screen share handler
        WebRTC.callbacks.onLocalScreenShare = (_userId: number, stream: MediaStream | null) => {
            if (!localScreenShareRef.current) {
                return;
            }
            const el = localScreenShareRef.current;
            try {
                el.srcObject = stream;
                el.muted = true;
                el.autoplay = true;
                if (stream) {
                    el.play().catch((err) => {
                        console.error("Failed to play local screen share:", err);
                        doAfterInteraction(() => el.play()).catch(() => {});
                    });
                }
            } catch (e) {
                console.warn("failed to attach local screen share stream:", e);
            }
        };

        // Set up remote screen share handler
        WebRTC.callbacks.onRemoteScreenShare = (_userId: number, stream: MediaStream | null) => {
            if (!remoteScreenShareRef.current) {
                return;
            }
            const el = remoteScreenShareRef.current;
            try {
                el.srcObject = stream;
                el.muted = false;
                el.autoplay = true;
                if (stream) {
                    el.play().catch((err) => {
                        console.error("Failed to play remote screen share:", err);
                        doAfterInteraction(() => el.play()).catch(() => {});
                    });
                }
            } catch (e) {
                console.warn("failed to attach remote screen share stream:", e);
            }
        };

        return () => {
            WebRTC.cleanup();
            setCallSignalingHandler(null);
        };
    }, [user.authToken, call.remoteUserId, setCallStatus, endCall, startCall, setRemoteVideoEnabled, setRemoteScreenSharing]);

    // Watch for session key hash changes and generate emojis
    useEffect(() => {
        if (call.sessionKeyHash && call.encryptionEmojis.length === 0) {
            const emojis = generateCallEmojis(call.sessionKeyHash);
            setCallEncryption(call.sessionKeyHash, emojis);
        }
    }, [call.sessionKeyHash, call.encryptionEmojis.length, setCallEncryption]);

    async function requestAudioPermissions(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });

            // Stop the stream immediately as we just needed permission
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error("Failed to get audio permissions:", error);
            return false;
        }
    }

    async function initiateCall(userId: number, username: string) {
        const hasPermission = await requestAudioPermissions();

        if (!hasPermission) {
            return;
        }

        let sessionKey;
        try {
            // Generate call session key and emojis
            sessionKey = await generateCallSessionKey();
            const emojis = generateCallEmojis(sessionKey.hash);

            // Start the call in state
            startCall(userId, username);
            setCallStatus("calling");
            setCallEncryption(sessionKey.hash, emojis);
        } catch (error) {
            console.error("Failed to generate call encryption:", error);
            endCall();
            return;
        }

        // Initiate WebRTC call
        const success = await WebRTC.initiateCall(userId, username);

        if (success && sessionKey) {
            // Set the session key for ourselves (initiator)
            await WebRTC.setSessionKey(userId, sessionKey.key);

            // Send session key hash to the receiver for visual verification
            await WebRTC.sendCallSessionKey(userId, sessionKey.hash);
            // Also wrap and send the actual session key for E2EE media
            await WebRTC.sendWrappedCallSessionKey(userId, sessionKey.key, sessionKey.hash);
        } else {
            endCall();
        }
    }

    async function acceptCall() {
        if (!call.remoteUserId) {
            return;
        }

        setCallStatus("connecting");
        const success = await WebRTC.acceptCall(call.remoteUserId);

        if (!success) {
            endCall();
        }
    }

    async function rejectCall() {
        if (!call.remoteUserId) {
            return;
        }

        await WebRTC.rejectCall(call.remoteUserId);
        endCall();
    }

    async function handleEndCall() {
        if (call.remoteUserId) {
            await WebRTC.endCall(call.remoteUserId);
        }
        endCall();
    }

    function handleToggleMute() {
        if (call.remoteUserId) {
            const isMuted = WebRTC.toggleMute(call.remoteUserId);
            // Update mute state in store
            if (isMuted !== call.isMuted) {
                toggleMute();
            }
        }
    }

    async function handleToggleVideo() {
        if (call.remoteUserId) {
            const isEnabled = await WebRTC.toggleVideo(call.remoteUserId);
            // Update video state in store
            if (isEnabled !== call.isVideoEnabled) {
                toggleVideo();
            }
        }
    }

    async function handleToggleScreenShare() {
        if (call.remoteUserId) {
            const isEnabled = await WebRTC.toggleScreenShare(call.remoteUserId);
            // Update screen share state in store
            if (isEnabled !== call.isSharingScreen) {
                toggleScreenShare();
            }
        }
    }

    async function handleIncomingCall(userId: number, username: string) {
        // Don't generate session key here - wait for it from the caller
        await WebRTC.handleIncomingCall(userId, username);
    }

    async function handleCallOffer(userId: number, offer: RTCSessionDescriptionInit) {
        await WebRTC.handleCallOffer(userId, offer);
    }

    async function handleCallAnswer(userId: number, answer: RTCSessionDescriptionInit) {
        await WebRTC.handleCallAnswer(userId, answer);
    }

    async function handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
        await WebRTC.handleIceCandidate(userId, candidate);
    }

    async function handleCallSessionKey(sessionKeyHash: string) {
        try {
            // Just generate and display the emojis from the hash
            // The actual session key will arrive via the wrapped key mechanism
            const emojis = generateCallEmojis(sessionKeyHash);
            setCallEncryption(sessionKeyHash, emojis);
        } catch (error) {
            console.error("Failed to generate call emojis from hash:", error);
        }
    }

    return {
        call: call,
        initiateCall,
        acceptCall,
        rejectCall,
        endCall: handleEndCall,
        toggleMute: handleToggleMute,
        toggleVideo: handleToggleVideo,
        toggleScreenShare: handleToggleScreenShare,
        handleIncomingCall,
        handleCallOffer,
        handleCallAnswer,
        handleIceCandidate,
        handleCallSessionKey,
        remoteAudioRef,
        localVideoRef,
        remoteVideoRef,
        localScreenShareRef,
        remoteScreenShareRef
    };
}

