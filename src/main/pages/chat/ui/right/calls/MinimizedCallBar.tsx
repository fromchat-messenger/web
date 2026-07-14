import { useCallStore } from "@/state/call";
import useCall from "@/pages/chat/hooks/useCall";
import defaultAvatar from "@/images/default-avatar.png";
import { MaterialIconButton } from "@/utils/material";

export function MinimizedCallBar() {
    const { call, toggleCallMinimized } = useCallStore();
    const { endCall, toggleMute } = useCall();

    function getGradientClass() {
        switch (call.status) {
            case "calling":
                return "gradient-calling";
            case "connecting":
                return "gradient-connecting";
            case "active":
                return "gradient-active";
            default:
                return "gradient-default";
        }
    }

    function getStatusText() {
        switch (call.status) {
            case "calling":
                return "Calling...";
            case "connecting":
                return "Connecting...";
            case "active":
                return "Active";
            default:
                return "";
        }
    }

    if (!call.isActive || !call.isMinimized) {
        return null;
    }

    return (
        <div className={`minimized-call-bar ${getGradientClass()}`} onClick={toggleCallMinimized}>
            <div className="call-info">
                <img src={defaultAvatar} alt="Avatar" className="avatar" />
                <div className="user-details">
                    <span className="username">{call.remoteUsername}</span>
                    <span className="status">{getStatusText()}</span>
                </div>
            </div>

            <div className="call-actions" onClick={(e) => e.stopPropagation()}>
                {call.status === "calling" && !call.isInitiator ? (
                    <MaterialIconButton onClick={endCall} icon="call_end" />
                ) : (
                    <>
                        <MaterialIconButton onClick={toggleMute} icon={call.isMuted ? "mic_off" : "mic"} />
                        <MaterialIconButton onClick={endCall} icon="call_end" />
                    </>
                )}
            </div>
        </div>
    );
}
