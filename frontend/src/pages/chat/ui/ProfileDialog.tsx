import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useProfileStore } from "@/state/profile";
import { useUserStore } from "@/state/user";
import type { ProfileDialogData } from "@/state/types";
import defaultAvatar from "@/images/default-avatar.png";
import { confirm } from "mdui/functions/confirm";
import { prompt } from "mdui/functions/prompt";
import api from "@/core/api";
import { RichTextArea } from "@/core/components/RichTextArea";
import { StatusBadge } from "@/core/components/StatusBadge";
import { VerifyButton } from "@/core/components/VerifyButton";
import { onlineStatusManager } from "@/core/onlineStatusManager";
import { OnlineStatus } from "./right/OnlineStatus";
import { Input } from "@/core/components/Input";
import { StyledDialog } from "@/core/components/StyledDialog";
import { MaterialButton, MaterialFab, MaterialIcon } from "@/utils/material";
import { displayNameForUser, isDeletedPeer } from "@/core/userDisplay";
import { DeletedUserAvatar } from "@/core/DeletedUserAvatar";
import { parseApiTimestamp } from "@/utils/utils";
import styles from "@/pages/chat/css/profile-dialog.module.scss";

interface SectionProps {
    type: string;
    icon: string;
    label: string;
    error?: string;
    value?: string;
    onChange?: (value: string) => void;
    readOnly: boolean;
    placeholder?: string;
    textArea?: boolean;
}

function Section({ type, icon, label, error, value, onChange, readOnly, placeholder, textArea = false }: SectionProps) {
    let valueComponent: ReactNode = null;

    if (onChange) {
        if (textArea) {
            valueComponent = (
                <RichTextArea
                    text={value || ""}
                    onTextChange={onChange}
                    placeholder={placeholder}
                    className={styles.value}
                    rows={1}
                    readOnly={readOnly} />
            );
        } else {
            valueComponent = (
                <input
                    className={styles.value}
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    readOnly={readOnly} />
            );
        }
    } else {
        valueComponent = <span className={styles.value}>{value}</span>
    }

    return (
        <div className={`${styles.section} ${type} ${error ? styles.error : ''}`}>
            <MaterialIcon name={icon} />
            <div className={styles.contentContainer}>
                <label className={styles.label}>{label}</label>
                {valueComponent}
                {error && (
                    <div className={styles.errorMessage}>{error}</div>
                )}
            </div>
        </div>
    )
}

export function ProfileDialog() {
    const { profileDialog, closeProfileDialog } = useProfileStore();
    const { user, setUser } = useUserStore();
    const [isOpen, setIsOpen] = useState(false);
    const [originalData, setOriginalData] = useState<ProfileDialogData | null>(null);
    const [currentData, setCurrentData] = useState<ProfileDialogData | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [errors, setErrors] = useState<{[key: string]: string}>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Handle dialog open/close based on state
    useEffect(() => {
        if (profileDialog && !isOpen) {
            // Fetch fresh data when opening dialog
            fetchFreshProfileData(profileDialog);
        } else if (!profileDialog && isOpen) {
            setIsOpen(false);
        }
    }, [profileDialog, isOpen]);

    async function fetchFreshProfileData(profileData: ProfileDialogData) {
        if (!user.authToken) return;

        try {
            let freshData = profileData;

            // If it's not the public chat and has a user ID, fetch fresh data
            if (profileData.userId && profileData.username !== "Общий чат") {
                const userProfile = await api.user.profile.fetchById(user.authToken, profileData.userId);
                if (userProfile) {
                    freshData = {
                        ...userProfile,
                        userId: userProfile.id,
                        memberSince: userProfile.created_at,
                        isOwnProfile: profileData.isOwnProfile,
                        deleted: userProfile.deleted,
                        verification_status: userProfile.verification_status,
                        suspended: userProfile.suspended,
                    };
                }
            }

            setOriginalData(freshData);
            setCurrentData(freshData);
            setIsOpen(true);
        } catch (error) {
            console.error("Failed to fetch fresh profile data:", error);
            // Fallback to cached data if fetch fails
            setOriginalData(profileData);
            setCurrentData(profileData);
            setIsOpen(true);
        }
    }



    // Subscribe to user's online status when dialog opens
    useEffect(() => {
        if (isOpen && currentData?.userId && !currentData.isOwnProfile) {
            // Subscribe to the user's status
            onlineStatusManager.subscribe(currentData.userId);

            // Cleanup function to unsubscribe when dialog closes
            return () => {
                if (currentData.userId) {
                    onlineStatusManager.unsubscribe(currentData.userId);
                }
            };
        }
    }, [isOpen, currentData?.userId, currentData?.isOwnProfile]);


    // Validate fields when data changes
    useEffect(() => {
        if (currentData && isOpen) {
            validateFields();
        }
    }, [currentData, isOpen]);

    const hasChanges = useMemo(() => {
        if (!originalData || !currentData) return false;

        // Normalize values for comparison (handle empty strings, undefined, null)
        const normalizeValue = (value: string | undefined | null) => {
            if (value === null || value === undefined) return "";
            return value.trim();
        };

        return (
            normalizeValue(originalData.display_name) !== normalizeValue(currentData.display_name) ||
            normalizeValue(originalData.username) !== normalizeValue(currentData.username) ||
            normalizeValue(originalData.bio) !== normalizeValue(currentData.bio) ||
            originalData.profilePicture !== currentData.profilePicture
        );
    }, [originalData, currentData]);

    async function handleClose() {
        if (hasChanges) {
            try {
                await confirm({
                    headline: "Несохраненные изменения",
                    description: "У вас есть несохраненные изменения. Вы уверены, что хотите закрыть?",
                    confirmText: "Закрыть",
                    cancelText: "Отмена"
                });
                closeProfileDialog();
            } catch {
                // User cancelled, do nothing
            }
        } else {
            closeProfileDialog();
        }
    };


    function handleDisplayNameChange(e: React.ChangeEvent<HTMLInputElement>) {
        if (!currentData) return;
        const newValue = e.target.value;
        setCurrentData({ ...currentData, display_name: newValue });

        // Validate display name in real-time
        validateDisplayName(newValue);
    };

    function handleUsernameChange(value: string) {
        if (!currentData) return;
        setCurrentData({ ...currentData, username: value });

        // Validate username in real-time
        validateUsername(value);
    };

    function handleBioChange(newBio: string) {
        if (!currentData) return;
        setCurrentData({ ...currentData, bio: newBio });
    };

    function handleProfilePictureClick() {
        if (currentData?.isOwnProfile) {
            fileInputRef.current?.click();
        }
    };

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith("image/")) {
            // Open cropper dialog here - for now just update the image
            const reader = new FileReader();
            reader.onload = (event) => {
                const imageUrl = event.target?.result as string;
                if (currentData) {
                    setCurrentData({ ...currentData, profilePicture: imageUrl });
                }
            };
            reader.readAsDataURL(file);
        }
    };

    function validateDisplayName(value: string) {
        let error = "";

        if (!value || value.trim().length === 0) {
            error = "Отображаемое имя не может быть пустым";
        } else if (value.length > 64) {
            error = "Отображаемое имя не может быть длиннее 64 символов";
        }

        setErrors(prev => ({ ...prev, display_name: error }));
    };

    function validateUsername(value: string) {
        let error = "";

        if (!value || value.trim().length === 0) {
            error = "Имя пользователя не может быть пустым";
        } else if (value.length < 3) {
            error = "Имя пользователя должно быть не менее 3 символов";
        } else if (value.length > 20) {
            error = "Имя пользователя не может быть длиннее 20 символов";
        } else if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            error = "Имя пользователя может содержать только английские буквы, цифры, дефисы и подчеркивания";
        }

        setErrors(prev => ({ ...prev, username: error }));
    };

    function validateFields() {
        if (currentData) {
            validateDisplayName(currentData.display_name || "");
            validateUsername(currentData.username || "");
        }

        return !errors.display_name && !errors.username;
    };

    async function handleSave() {
        if (!currentData || !user.authToken || !originalData) return;

        // Validate fields first
        if (!validateFields()) {
            return;
        }

        setIsSaving(true);
        try {
            // Update profile data
            const updateData: any = {};
            if (originalData.display_name !== currentData.display_name) {
                updateData.display_name = currentData.display_name;
            }
            if (originalData.username !== currentData.username) {
                updateData.username = currentData.username;
            }
            if (originalData.bio !== currentData.bio) {
                updateData.description = currentData.bio;
            }

            if (Object.keys(updateData).length > 0) {
                await api.user.profile.update(user.authToken, updateData);
            }

            // Update profile picture if changed
            if (originalData.profilePicture !== currentData.profilePicture && currentData.profilePicture) {
                // Convert data URL to blob if needed
                if (currentData.profilePicture.startsWith("data:")) {
                    const response = await fetch(currentData.profilePicture);
                    const blob = await response.blob();
                    await api.user.profile.uploadPicture(user.authToken, blob);
                }
            }

            // Update the original data to match current data
            setOriginalData(currentData);

            // If this is the current user's profile and username was changed, update the current user data
            if (currentData.isOwnProfile && user.currentUser && user.authToken) {
                const updatedUser = {
                    ...user.currentUser,
                    username: currentData.username || user.currentUser.username,
                    display_name: currentData.display_name || user.currentUser.display_name,
                    bio: currentData.bio || user.currentUser.bio,
                    profile_picture: currentData.profilePicture || user.currentUser.profile_picture
                };
                setUser(user.authToken, updatedUser);
            }

            // Close dialog after successful save
            closeProfileDialog();
        } catch (error) {
            console.error("Failed to save profile:", error);
            // Handle API errors
            if (error instanceof Error && error.message.includes("уже занято")) {
                setErrors({ username: "Это имя пользователя уже занято" });
            } else {
                setErrors({ general: "Ошибка при сохранении профиля" });
            }
        } finally {
            setIsSaving(false);
        }
    }

    function formatDate(dateString: string) {
        return parseApiTimestamp(dateString).toLocaleDateString("ru-RU", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    async function handleSuspend() {
        if (!currentData?.userId || !user.authToken) return;

        const isSuspending = !currentData.suspended;

        try {
            if (isSuspending) {
                const reason = await prompt({
                    headline: "Suspend Account",
                    description: "Enter the reason for suspending this account:",
                    confirmText: "Suspend",
                    cancelText: "Cancel"
                });

                if (reason) {
                    const result = await api.moderation.users.suspend(currentData.userId, reason, user.authToken!);
                    if (result) {
                        closeProfileDialog();
                    } else {
                        console.error("Failed to suspend user");
                    }
                }
            } else {
                // Unsuspend user
                const result = await api.moderation.users.unsuspend(currentData.userId, user.authToken!);
                if (result) {
                    closeProfileDialog();
                } else {
                    console.error("Failed to unsuspend user");
                }
            }
        } catch (error) {
            console.error(`Failed to ${isSuspending ? 'suspend' : 'unsuspend'} user:`, error);
        }
    }

    async function handleDelete() {
        if (!currentData?.userId || !user.authToken) return;

        try {
            await confirm({
                headline: "Delete Account",
                description: "This will permanently delete user data but preserve messages and conversations. If the user is online, they will be immediately logged out. This action cannot be undone.",
                confirmText: "Delete",
                cancelText: "Cancel"
            });

            const result = await api.moderation.users.deleteUser(currentData.userId, user.authToken!);

            if (result) {
                closeProfileDialog();
            } else {
                console.error("Failed to delete user");
            }
        } catch (error) {
            // User cancelled or error occurred
            console.error("Failed to delete user:", error);
        }
    }


    const fabVisible = useMemo(() => {
        let hasErrors = false;
        Object.values(errors).forEach(error => {
            if (error) {
                hasErrors = true;
            }
        });

        return hasChanges && currentData?.isOwnProfile && !isSaving && !hasErrors;
    }, [hasChanges, currentData?.isOwnProfile, isSaving, errors]);

    if (!currentData) return null;

    const isDeletedProfile = isDeletedPeer(currentData);

    return (
        <StyledDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) {
                    handleClose();
                }
            }}
            onBackdropClick={handleClose}
            contentClassName={styles.profileDialogContent}
            afterChildren={
                currentData.isOwnProfile && (
                    <MaterialFab
                        icon="check"
                        className={`${styles.profileDialogFab} ${fabVisible ? styles.visible : ""}`}
                        onClick={handleSave}
                        disabled={isSaving} />
                )
            }
        >
            <div className={styles.profilePictureSection}>
                {isDeletedProfile ? (
                    <DeletedUserAvatar
                        userId={currentData.userId!}
                        className={styles.deletedAvatar}
                        iconClassName={styles.deletedAvatarIcon}
                    />
                ) : (
                    <img
                        className={styles.profilePicture}
                        src={currentData.profilePicture || defaultAvatar}
                        alt="Profile Picture"
                        onError={(e) => {
                            e.target.src = defaultAvatar;
                        }}
                    />
                )}
                
                {currentData.isOwnProfile && !isDeletedProfile && (
                    <div
                        className={styles.profilePictureEditOverlay}
                        onClick={handleProfilePictureClick}
                    >
                        <MaterialIcon name="camera_alt--filled" />
                    </div>
                )}
            </div>

            <div className={`${styles.usernameSection} ${errors.display_name ? styles.error : ''}`}>
                <div className={styles.usernameWithBadge}>
                    <Input
                        autoresizing={true}
                        className={styles.usernameInput}
                        type="text"
                        value={isDeletedProfile ? displayNameForUser(currentData) : currentData.display_name}
                        onChange={handleDisplayNameChange}
                        readOnly={!currentData.isOwnProfile}
                        placeholder="Имя" />
                    
                    {!isDeletedProfile && (
                        <StatusBadge
                            verificationStatus={currentData.verification_status}
                            verified={currentData.verified || false}
                            size="large" />
                    )}
                </div>
                {errors.display_name && (
                    <div className={styles.errorMessage}>{errors.display_name}</div>
                )}
            </div>

            {(currentData?.userId || currentData?.isOwnProfile) && !isDeletedProfile && (
                <div className={styles.onlineStatusSection}>
                    <OnlineStatus userId={currentData.userId || user.currentUser!.id} />
                </div>
            )}

            {/* Admin Actions Section - Hide for deleted users */}
            {!currentData.isOwnProfile && user.currentUser?.id === 1 && !isDeletedProfile && (
                <div className={styles.adminActionsSection}>
                    <h3 className={styles.adminActionsHeader}>Admin Actions</h3>
                    <div className={styles.adminButtons}>
                        <MaterialButton 
                            variant="filled" 
                            color="error"
                            icon={currentData.suspended ? "check_circle--filled" : "block--filled"}
                            onClick={handleSuspend}
                        >
                            {currentData.suspended ? "Unsuspend Account" : "Suspend Account"}
                        </MaterialButton>
                        <MaterialButton 
                            variant="filled" 
                            color="error"
                            icon="delete_forever--filled"
                            onClick={handleDelete}
                        >
                            Delete Account
                        </MaterialButton>
                        <VerifyButton 
                            userId={currentData.userId!}
                            verified={currentData.verified || false}
                            onVerificationChange={(verified) => {
                                setCurrentData({ ...currentData, verified });
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Verify button for non-admin owner */}
            {!currentData.isOwnProfile && currentData.userId && user.currentUser?.id !== 1 && !isDeletedProfile && (
                <div className={styles.verifySection}>
                    <VerifyButton 
                        userId={currentData.userId}
                        verified={currentData.verified || false}
                        onVerificationChange={(verified) => {
                            setCurrentData({ ...currentData, verified });
                        }}
                    />
                </div>
            )}

            {/* Hide profile sections for deleted users */}
            {!isDeletedProfile && (
                <div className={styles.profileSections}>
                    <Section
                        type="username"
                        error={errors.username}
                        icon="alternate_email--filled"
                        label="Имя пользователя:"
                        value={currentData.username}
                        onChange={handleUsernameChange}
                        readOnly={!currentData.isOwnProfile}
                        placeholder="username" />

                    {currentData.bio !== undefined && (
                        <Section
                            type="bio"
                            icon="info--filled"
                            label="О себе:"
                            value={currentData.bio}
                            onChange={handleBioChange}
                            readOnly={!currentData.isOwnProfile}
                            placeholder="Нет информации о себе"
                            textArea />
                    )}

                    {currentData.memberSince && (
                        <Section
                            type="member-since"
                            icon="calendar_month--filled"
                            label="Участник с:"
                            value={formatDate(currentData.memberSince)}
                            readOnly={true} />
                    )}

                    {currentData.verified && (
                        <Section
                            type="verified"
                            icon="verified--filled"
                            label="Верификация:"
                            value="Этот аккаунт - официальное лицо FromChat."
                            readOnly={true}
                        />
                    )}
                </div>
            )}

            

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileSelect}
            />
        </StyledDialog>
    );
}
