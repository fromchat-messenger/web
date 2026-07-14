import { LeftPanel } from "./left/LeftPanel";
import { RightPanel } from "./right/RightPanel";
import useDownloadAppScreen from "@/core/hooks/useDownloadAppScreen";
import { CallWindow } from "./right/calls/CallWindow";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserStore } from "@/state/user";
import { useProfileStore } from "@/state/profile";
import api from "@/core/api";
import styles from "@/pages/chat/css/layout.module.scss";

export default function ChatPage() {
    const { navigate: navigateDownloadApp } = useDownloadAppScreen();
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useUserStore();
    const { setProfileDialog } = useProfileStore();
    const processedProfile = useRef<string | null>(null);

    // Handle profile links ONLY from navigation state (from SmartCatchAll)
    useEffect(() => {
        async function handleProfileLink() {
            if (!user.authToken) return;

            // Only process profile links that come from navigation state (SmartCatchAll)
            // This prevents re-processing on page refresh
            if (!location.state?.profileInfo) return;

            const profileInfo = location.state.profileInfo;
            
            // Create a unique key for this profile
            const profileKey = profileInfo.userId
                ? `user_${profileInfo.userId}`
                : `username_${profileInfo.username}`;
            
            // Skip if we've already processed this exact profile
            if (processedProfile.current === profileKey) return;
            
            processedProfile.current = profileKey; // Mark this specific profile as processed
            
            try {
                let userProfile;
                
                if (profileInfo.userId) {
                    // Fetch by user ID
                    userProfile = await api.user.profile.fetchById(user.authToken, profileInfo.userId);
                } else if (profileInfo.username) {
                    // Fetch by username
                    userProfile = await api.user.profile.fetchByUsername(user.authToken, profileInfo.username);
                }
                
                if (userProfile) {
                    setProfileDialog({
                        ...userProfile,
                        userId: userProfile.id,
                        memberSince: userProfile.created_at,
                        isOwnProfile: userProfile.id === user.currentUser?.id
                    });
                }
                
                // Clear the navigation state to prevent re-processing on refresh
                navigate(location.pathname, { replace: true, state: null });
            } catch (error) {
                console.error("Failed to fetch user profile from URL:", error);
            }
        }

        handleProfileLink();
    }, [location.state, user.authToken, user.currentUser?.id, navigate, location.pathname]);

    if (navigateDownloadApp) return navigateDownloadApp;

    return (
        <div className={styles.chatInterface}>
            <div className={styles.allContainer}>
                <LeftPanel />
                <RightPanel />
            </div>
            <CallWindow />
        </div>
    );
}
