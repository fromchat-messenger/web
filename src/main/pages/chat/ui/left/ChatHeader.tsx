import { PRODUCT_NAME } from "@/core/config";
import useProfile from "@/pages/chat/hooks/useProfile";
import defaultAvatar from "@/images/default-avatar.png";
import { useState } from "react";
import { useUserStore } from "@/state/user";
import { useProfileStore } from "@/state/profile";
import { MinimizedCallBar } from "@/pages/chat/ui/right/calls/MinimizedCallBar";
import styles from "@/pages/chat/css/left-panel.module.scss";
import logoIcon from "@/images/logo.svg";

export function ChatHeader({ headerRef }: { headerRef?: React.RefObject<HTMLElement | null> }) {
    const { profileData } = useProfile();
    const { user } = useUserStore();
    const { setProfileDialog } = useProfileStore();
    const [profilePictureUrl, setProfilePictureUrl] = useState(profileData?.profile_picture || defaultAvatar);

    function handleProfileClick() {
        setProfileDialog({
            userId: user.currentUser?.id,
            username: profileData?.username || "Пользователь",
            display_name: profileData?.display_name || "Пользователь",
            profilePicture: profileData?.profile_picture,
            bio: profileData?.description,
            memberSince: user.currentUser?.created_at,
            online: user.currentUser?.online,
            isOwnProfile: true
        });
    };

    return (
        <>
            <header className={styles.chatHeaderLeft} ref={headerRef}>
                <img src={logoIcon} alt="Logo" className={styles.logo} />
                <div className={styles.productName}>{PRODUCT_NAME}</div>
                <div className={styles.profile}>
                    <a href="#" id="profile-open" onClick={handleProfileClick}>
                        <img
                            src={profilePictureUrl}
                            alt=""
                            id="preview1"
                            onError={() => setProfilePictureUrl(defaultAvatar)} />
                    </a>
                </div>
            </header>
            <MinimizedCallBar />
        </>
    );
}