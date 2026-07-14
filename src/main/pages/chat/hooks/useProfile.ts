import { useState, useCallback, useEffect } from "react";
import { useUserStore } from "@/state/user";
import api from "@/core/api";
import type { ProfileData } from "@/core/api/user/profile";
import { showSuccess, showError } from "@/utils/notification";

export default function useProfile() {
    const { user } = useUserStore();
    const [profileData, setProfileData] = useState<ProfileData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    // Load profile data
    const loadProfileData = useCallback(async () => {
        if (!user.authToken) return;

        setIsLoading(true);
        try {
            const data = await api.user.profile.get(user.authToken);
            if (data) {
                setProfileData(data);
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            showError('Ошибка при загрузке профиля');
        } finally {
            setIsLoading(false);
        }
    }, [user.authToken]);

    // Update profile
    const updateProfileData = useCallback(async (data: Partial<ProfileData>) => {
        if (!user.authToken) return false;

        setIsUpdating(true);
        try {
            const success = await api.user.profile.update(user.authToken, data);
            if (success) {
                // Reload profile data to get updated information
                await loadProfileData();
                showSuccess('Профиль обновлен!');
                return true;
            } else {
                showError('Ошибка при обновлении профиля');
                return false;
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            showError('Ошибка при обновлении профиля');
            return false;
        } finally {
            setIsUpdating(false);
        }
    }, [user.authToken, loadProfileData]);

    // Upload profile picture
    const uploadProfilePictureData = useCallback(async (file: Blob) => {
        if (!user.authToken) return false;

        setIsUpdating(true);
        try {
            const result = await api.user.profile.uploadPicture(user.authToken, file);
            if (result) {
                // Update profile data with new picture URL
                setProfileData(prev => prev ? {
                    ...prev,
                    profile_picture: result.profile_picture_url
                } : null);
                showSuccess('Фото профиля обновлено!');
                return true;
            } else {
                showError('Ошибка при загрузке фото');
                return false;
            }
        } catch (error) {
            console.error('Error uploading profile picture:', error);
            showError('Ошибка при загрузке фото');
            return false;
        } finally {
            setIsUpdating(false);
        }
    }, [user.authToken]);

    // Load profile data when user is authenticated
    useEffect(() => {
        if (user.authToken) {
            loadProfileData();
        }
    }, [user.authToken, loadProfileData]);

    return {
        profileData,
        isLoading,
        isUpdating,
        loadProfileData,
        updateProfileData,
        uploadProfilePictureData
    };
}
