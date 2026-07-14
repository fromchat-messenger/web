import { useChatStore } from "@/state/chat";
import defaultAvatar from "@/images/default-avatar.png";

export function ChatMainHeader() {
    const { currentChat } = useChatStore();

    return (
        <div className="chat-header">
            <img src={defaultAvatar} alt="Avatar" className="chat-header-avatar" />
            <div className="chat-header-info">
                <div className="info-chat">
                    <h4 id="chat-name">{currentChat}</h4>
                    <p>
                        <span className="online-status"></span>
                        Онлайн
                    </p>
                </div>
            </div>
        </div>
    );
}
