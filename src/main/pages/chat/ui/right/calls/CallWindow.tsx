import { useState, useEffect } from "react";
import { useCallStore } from "@/state/call";
import { useUserStore } from "@/state/user";
import useCall from "@/pages/chat/hooks/useCall";
import defaultAvatar from "@/images/default-avatar.png";
import { createPortal } from "react-dom";
import { id } from "@/utils/utils";
import { MaterialIconButton } from "@/utils/material";
import { motion, AnimatePresence } from "motion/react";
import styles from "@/pages/chat/css/callWindow.module.scss";

export function CallWindow() {
    const { call, toggleCallMinimized } = useCallStore();
    const { user } = useUserStore();
    const {
        acceptCall,
        rejectCall,
        remoteAudioRef,
        endCall,
        toggleMute,
        toggleVideo,
        toggleScreenShare,
        localVideoRef,
        remoteVideoRef,
        localScreenShareRef,
        remoteScreenShareRef
    } = useCall();
    const [pipPosition, setPipPosition] = useState({ x: window.innerWidth - 420, y: window.innerHeight - 320 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [callDuration, setCallDuration] = useState(0);

    const status = call.status;
    const remoteUsername = call.remoteUsername;
    const isInitiator = call.isInitiator;
    const isMuted = call.isMuted;

    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (call.status === "active" && call.startTime) {
            interval = setInterval(() => {
                setCallDuration(Math.floor((Date.now() - call.startTime!) / 1000));
            }, 1000);
        } else {
            setCallDuration(0);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [call.status, call.startTime]);


    // Handle dragging for PiP mode
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging && call.isMinimized) {
                setPipPosition({
                    x: e.clientX - dragOffset.x,
                    y: e.clientY - dragOffset.y
                });
            }
        };

        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
            }
        };

        if (isDragging) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, call.isMinimized, dragOffset]);


    function formatDuration(seconds: number) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function getStatusText() {
        switch (status) {
            case "calling":
                return "Calling...";
            case "connecting":
                return "Connecting...";
            case "active":
                return formatDuration(callDuration);
            default:
                return "";
        }
    }

    function getGradientClass() {
        switch (status) {
            case "calling":
                return styles.gradientCalling;
            case "connecting":
                return styles.gradientConnecting;
            case "active":
                return styles.gradientActive;
            default:
                return styles.gradientDefault;
        }
    }


    const isMinimized = call.isMinimized;

    return (
        createPortal(
            <>
                <audio
                    ref={remoteAudioRef}
                    className={styles.remoteAudio}
                    autoPlay
                    playsInline
                    controls />

                <AnimatePresence>
                    {call.isActive && (
                        <motion.div
                            className={`${styles.callWindow} ${isMinimized ? styles.minimized : styles.maximized} ${isDragging ? styles.dragging : ""} ${getGradientClass()}`}
                            style={isMinimized ? {
                                left: pipPosition.x,
                                top: pipPosition.y
                            } : {}}
                            initial={false}
                            exit={isMinimized ?
                                { opacity: 0, scale: 0.7 } :
                                { opacity: 0, y: -100 }
                            }
                            transition={isDragging ? { duration: 0 } : { 
                                opacity: { duration: 0.4 },
                                scale: { duration: 0.4 },
                                y: { duration: 0.4 }
                            }}
                            onMouseDown={(e) => {
                                if (isMinimized) {
                                    if (!e.target.closest("mdui-button-icon")) {
                                        setIsDragging(true);
                                        setDragOffset({
                                            x: e.clientX - pipPosition.x,
                                            y: e.clientY - pipPosition.y
                                        });
                                    }
                                }
                            }}
                        >
                        <div className={styles.callHeader}>
                            <div className={styles.windowControls}>
                                <MaterialIconButton
                                    onClick={toggleCallMinimized}
                                    icon={call.isMinimized ? "open_in_full" : "close_fullscreen"}
                                    className={styles.windowControlBtn}
                                />
                            </div>

                            <div className={styles.callHeaderInfo}>
                                <h3 className={styles.username}>{remoteUsername}</h3>
                                <p className={styles.status}>{getStatusText()}</p>
                                {!call.isMinimized && call.encryptionEmojis.length > 0 && (
                                    <div className={styles.encryptionEmojis}>
                                        {call.encryptionEmojis.map((emoji, index) => (
                                            <span key={index} className={styles.encryptionEmoji}>
                                                {emoji}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`${styles.callContent} ${(call.isSharingScreen || call.isRemoteScreenSharing) ? styles.withScreenShare : ""}`}>
                            {/* Main screen share area - takes most space when active */}
                            <div className={styles.screenShareArea}>
                                {/* Local screen share */}
                                <div
                                    className={`${styles.videoTile} ${styles.screenShareTile} ${styles.localScreenShare}`}
                                    style={{ display: call.isSharingScreen ? "flex" : "none" }}>
                                    <video
                                        ref={localScreenShareRef}
                                        className={`${styles.videoElement} ${styles.screenShareVideo}`}
                                        autoPlay
                                        playsInline
                                        muted />
                                    <div className={styles.tileLabel}>Your Screen</div>
                                </div>

                                {/* Remote screen share */}
                                <div
                                    className={`${styles.videoTile} ${styles.screenShareTile} ${styles.remoteScreenShare}`}
                                    style={{ display: call.isRemoteScreenSharing ? "flex" : "none" }}>
                                    <video
                                        ref={remoteScreenShareRef}
                                        className={`${styles.videoElement} ${styles.screenShareVideo}`}
                                        autoPlay
                                        playsInline />
                                    <div className={styles.tileLabel}>{remoteUsername}&apos;s Screen</div>
                                </div>
                            </div>

                            {/* Video tiles sidebar - appears on right when screen share is active */}
                            <div className={styles.videoTilesSidebar}>
                                {/* Local video tile */}
                                <div className={`${styles.videoTile} ${styles.localVideo}`}>
                                    <video
                                        ref={localVideoRef}
                                        className={styles.videoElement}
                                        autoPlay
                                        playsInline
                                        muted
                                        style={{ display: call.isVideoEnabled ? "block" : "none" }} />
                                    {!call.isVideoEnabled && (
                                        <div className={styles.videoPlaceholder}>
                                            <img src={defaultAvatar} alt="Avatar" className={styles.placeholderAvatar} />
                                            <span className={styles.placeholderUsername}>{user.currentUser?.username || "You"}</span>
                                        </div>
                                    )}
                                    <div className={styles.tileLabel}>You</div>
                                </div>

                                {/* Remote video tile */}
                                <div className={`${styles.videoTile} ${styles.remoteVideo}`}>
                                    <video
                                        ref={remoteVideoRef}
                                        className={styles.videoElement}
                                        autoPlay
                                        playsInline
                                        style={{ display: call.isRemoteVideoEnabled ? "block" : "none" }} />
                                    {!call.isRemoteVideoEnabled && (
                                        <div className={styles.videoPlaceholder}>
                                            <img src={defaultAvatar} alt="Avatar" className={styles.placeholderAvatar} />
                                            <span className={styles.placeholderUsername}>{remoteUsername}</span>
                                        </div>
                                    )}
                                    <div className={styles.tileLabel}>{remoteUsername}</div>
                                </div>
                            </div>
                        </div>

                        <div className={styles.callControls}>
                            {status === "calling" && !isInitiator ? (
                                <>
                                    <MaterialIconButton onClick={acceptCall} icon="call" />
                                    <MaterialIconButton onClick={rejectCall} icon="call_end" />
                                </>
                            ) : (
                                <>
                                    <MaterialIconButton onClick={toggleMute} icon={isMuted ? "mic_off" : "mic"} />
                                    <MaterialIconButton onClick={toggleVideo} icon={call.isVideoEnabled ? "videocam" : "videocam_off"} />
                                    <MaterialIconButton onClick={toggleScreenShare} icon={call.isSharingScreen ? "stop_screen_share" : "screen_share"} />
                                    <MaterialIconButton onClick={endCall} icon="call_end" />
                                </>
                            )}
                        </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </>,
            id("root")
        )
    );
}