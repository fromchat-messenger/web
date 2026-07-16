import { formatTime, id, ub64 } from "@/utils/utils";
import type { Attachment, Message as MessageType, Reaction } from "@/core/types";
import defaultAvatar from "@/images/default-avatar.png";
import Quote from "@/core/components/Quote";
import { parse } from "marked";
import { escape as escapeHtml } from "he";
import { useEffect, useState, useRef, useMemo } from "react";
import api from "@/core/api";
import { importAesGcmKey, aesGcmDecrypt } from "@fromchat/protocol";
import { useUserStore } from "@/state/user";
import { useProfileStore } from "@/state/profile";
import { StatusBadge } from "@/core/components/StatusBadge";
import { useImmer } from "use-immer";
import { createPortal } from "react-dom";
import { parseProfileLink } from "@/core/profileLinks";
import { MaterialCircularProgress, MaterialIconButton, MaterialList, MaterialListItem } from "@/utils/material";
import { displayNameForUser, isRedactedPeer } from "@/core/userDisplay";
import { DeletedUserAvatar } from "@/core/DeletedUserAvatar";
import styles from "@/pages/chat/css/Message.module.scss";
import replyPreviewStyles from "@/pages/chat/css/reply-preview.module.scss";

interface MessageReactionsProps {
    reactions?: Reaction[];
    onReactionClick: (emoji: string) => void;
    messageId?: number; // Add messageId to ensure unique keys
}

function Reactions({ reactions, onReactionClick, messageId }: MessageReactionsProps) {
    const { user } = useUserStore();
    const [visibleReactions, setVisibleReactions] = useState<Reaction[]>([]);
    const [animatingReactions, setAnimatingReactions] = useState<Set<string>>(new Set());
    const [isVisible, setIsVisible] = useState(false);

    // Handle reactions with animation
    useEffect(() => {
        if (!reactions || reactions.length === 0) {
            // If we have visible reactions, animate them out
            if (visibleReactions.length > 0) {
                visibleReactions.forEach(reaction => {
                    setAnimatingReactions(prev => new Set(prev).add(reaction.emoji));
                });
                // After animation completes, hide the component
                setTimeout(() => {
                    setVisibleReactions([]);
                    setAnimatingReactions(new Set());
                    setIsVisible(false);
                }, 200);
            } else {
                // No visible reactions, hide immediately
                setIsVisible(false);
            }
            return;
        }

        // Show the component when we have reactions
        setIsVisible(true);

        // Deduplicate reactions by emoji (safety measure)
        const uniqueReactions = reactions.reduce((acc, reaction) => {
            const existing = acc.find(r => r.emoji === reaction.emoji);
            if (existing) {
                // Keep the one with the higher count
                if (reaction.count > existing.count) {
                    acc[acc.indexOf(existing)] = reaction;
                }
            } else {
                acc.push(reaction);
            }
            return acc;
        }, [] as Reaction[]);


        // Animate out removed reactions
        visibleReactions.forEach(reaction => {
            if (!uniqueReactions.some(r => r.emoji === reaction.emoji)) {
                setAnimatingReactions(prev => new Set(prev).add(reaction.emoji));
                setTimeout(() => {
                    setVisibleReactions(prev => prev.filter(r => r.emoji !== reaction.emoji));
                    setAnimatingReactions(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(reaction.emoji);
                        return newSet;
                    });
                }, 200);
            }
        });

        // Update existing reactions and add new ones
        setVisibleReactions(prev => {
            const updated = [...prev];

            // Update existing reactions
            uniqueReactions.forEach(reaction => {
                const existingIndex = updated.findIndex(r => r.emoji === reaction.emoji);
                if (existingIndex !== -1) {
                    updated[existingIndex] = reaction;
                } else {
                    // Add new reaction only if it doesn't already exist
                    if (!updated.some(r => r.emoji === reaction.emoji)) {
                        updated.push(reaction);
                    }
                }
            });

            return updated;
        });
    }, [reactions]);

    // Don't render if not visible
    if (!isVisible) {
        return null;
    }

    return (
        <div className={styles.messageReactions}>
            {visibleReactions.map((reaction, index) => {
                const hasUserReacted = reaction.users.some(u => u.id === user.currentUser?.id);
                const isAnimating = animatingReactions.has(reaction.emoji);

                return (
                    <button
                        key={`${messageId || 'unknown'}-${reaction.emoji}-${reaction.count}-${index}`}
                        className={`${styles.reactionButton} ${hasUserReacted ? styles.reacted : ""} ${isAnimating ? styles.removing : ""}`}
                        onClick={() => onReactionClick(reaction.emoji)}
                        title={reaction.users.map(u => u.username).join(", ")}
                    >
                        <span className={styles.reactionEmoji}>{reaction.emoji}</span>
                        <span className={styles.reactionCount}>{reaction.count}</span>
                    </button>
                );
            })}
        </div>
    );
}


interface MessageProps {
    message: MessageType;
    isAuthor: boolean;
    onContextMenu: (e: React.MouseEvent, message: MessageType) => void;
    onReactionClick?: (messageId: number, emoji: string) => void;
    isDm?: boolean;
}

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number
}

export function Message({ message, isAuthor, onContextMenu, onReactionClick, isDm = false }: MessageProps) {
    const [decryptedFiles, updateDecryptedFiles] = useImmer<Map<string, string>>(new Map());
    const [loadedImages, updateLoadedImages] = useImmer<Set<string>>(new Set());
    const [downloadingPaths, updateDownloadingPaths] = useImmer<Set<string>>(new Set());
    const [isDownloadingFullscreen, setIsDownloadingFullscreen] = useState(false);
    const [fullscreenImage, setFullscreenImage] = useState<{
        src: string;
        name: string;
        element: HTMLImageElement;
        startRect: Rect;
        endRect: Rect;
    } | null>(null);
    const [isAnimatingOpen, setIsAnimatingOpen] = useState(false);
    const { user } = useUserStore();
    const { setProfileDialog } = useProfileStore();
    const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
    const dmEnvelope = message.runtimeData?.dmEnvelope;

    const formattedMessage = useMemo(() => {
        // First, temporarily replace existing fromchat.ru links to avoid conflicts
        const linkPlaceholders: string[] = [];
        let content = escapeHtml(message.content).replace(/https?:\/\/fromchat\.ru\/@[a-zA-Z0-9_.-]+/g, (match) => {
            const placeholder = `__LINK_PLACEHOLDER_${linkPlaceholders.length}__`;
            linkPlaceholders.push(match);
            return placeholder;
        });

        // Now process @mentions that aren't in existing links
        content = content.replace(/@([a-zA-Z0-9_.-]+)/g, (match, username) => {
            return `<a href="https://fromchat.ru/@${username}" class="${styles.mentionLink}">${match}</a>`;
        });

        // Restore the original links
        linkPlaceholders.forEach((link, index) => {
            content = content.replace(`__LINK_PLACEHOLDER_${index}__`, link);
        });

        const rendered = parse(content, { async: false }).trim();

        return {
            __html: rendered
        };
    }, [message.content, styles.mentionLink]);

    // Auto-decrypt images in DMs
    useEffect(() => {
        if (isDm && message.files) {
            message.files.forEach(async (file) => {
                const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.name || "");
                const looksEncryptedPath = /\/uploads\/files\/encrypted\//.test(file.path) || /\/api\/uploads\/files\/encrypted\//.test(file.path);
                const shouldDecrypt = Boolean(file.encrypted || looksEncryptedPath);
                if (isImage && shouldDecrypt && !decryptedFiles.has(file.path)) {
                    const decryptedUrl = await decryptFile(file);
                    if (decryptedUrl) {
                        updateDecryptedFiles(draft => {
                            draft.set(file.path, decryptedUrl);
                        });
                    }
                }
            });
        }
    }, [message.files, isDm, decryptedFiles]);

    async function decryptFile(file: Attachment): Promise<string | null> {
        if (!isDm || !user.authToken || !dmEnvelope) return null;

        const userKeys = api.user.auth.getCurrentKeys();
        if (!userKeys) return null;

        const looksEncryptedPath = /\/uploads\/files\/encrypted\//.test(file.path) || /\/api\/uploads\/files\/encrypted\//.test(file.path);
        const shouldDecrypt = Boolean(file.encrypted || looksEncryptedPath);
        if (!shouldDecrypt) return null;

        // Check if already decrypted
        if (decryptedFiles.has(file.path)) {
            return decryptedFiles.get(file.path) || null;
        }

        try {
            // no-op decrypt indicator removed from UI
            // Fetch encrypted file
            const response = await fetch(api.files.resolveAttachmentUrl(file.path), {
                headers: api.user.auth.getAuthHeaders(user.authToken!)
            });
            if (!response.ok) throw new Error("Failed to fetch file");

            const encryptedData = await response.arrayBuffer();

            // Get current user's keys
            const keys = api.user.auth.getCurrentKeys();
            if (!keys) throw new Error("Keys not initialized");

            // Decrypt file using the envelope encryption MEK unwrapping logic
            // Use the same logic as message decryption
            // Prefer file-specific wrapped MEK (attachments have their own wrapped MEK)

            // Get MEK from envelope file data - server provides user-specific MEK
            const envelopeFile = dmEnvelope.files?.find(f => f.path === file.path);
            const fileWrapped = file.wrapped_mek_b64;
            const envelopeWrapped = envelopeFile?.wrapped_mek_b64;
            const dmWrapped = dmEnvelope.wrapped_mek_b64;

            const wrappedMekB64 = fileWrapped || envelopeWrapped || dmWrapped;

            if (!wrappedMekB64) {
                console.error("No MEK available for file decryption:", file.path);
                return null;
            }

            // Unwrap the MEK using the same logic as message decryption
            const mk = await api.chats.dm.unwrapMek(wrappedMekB64, dmEnvelope, user.currentUser?.id);

            // Decrypt the file using the unwrapped MEK
            const nonceB64 = file.nonce_b64 || envelopeFile?.nonce_b64;
            if (!nonceB64) throw new Error("No nonce available for file decryption");

            const iv = ub64(nonceB64);
            const ciphertext = new Uint8Array(encryptedData);
            const decrypted = await aesGcmDecrypt(await importAesGcmKey(mk), iv, ciphertext);

            // Create blob URL for download
            const ext = (file.name || "").toLowerCase().split(".").pop();
            const mime =
                ext === "png" ? "image/png" :
                ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
                ext === "gif" ? "image/gif" :
                ext === "webp" ? "image/webp" :
                "application/octet-stream";
            const decryptedBuf = (decrypted.buffer as ArrayBuffer).slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength);
            const blob = new Blob([decryptedBuf], { type: mime });
            const url = URL.createObjectURL(blob);

            updateDecryptedFiles(draft => {
                draft.set(file.path, url);
            });
            return url;
        } catch (error) {
            console.error("Failed to decrypt file:", error);
            return null;
        } finally {
            // no-op decrypt indicator removed from UI
        }
    };

    async function handleImageClick(file: Attachment, imageElement: HTMLImageElement) {
        // Use decrypted URL if available, otherwise decrypt first
        const decryptedUrl = decryptedFiles.get(file.path);
        if (decryptedUrl) {
            openFullscreenFromThumb(imageElement, decryptedUrl, file.name || "image");
        } else if (isDm && (file.encrypted || /\/uploads\/files\/encrypted\//.test(file.path) || /\/api\/uploads\/files\/encrypted\//.test(file.path))) {
            const newDecryptedUrl = await decryptFile(file);
            if (newDecryptedUrl) {
                openFullscreenFromThumb(imageElement, newDecryptedUrl, file.name || "image");
            }
        } else {
            openFullscreenFromThumb(imageElement, file.path, file.name || "image");
        }
    };

    function computeEndRect(naturalWidth: number, naturalHeight: number): Rect {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxWidth = Math.floor(viewportWidth * 0.9);
        const maxHeight = Math.floor(viewportHeight * 0.9);
        const widthRatio = maxWidth / naturalWidth;
        const heightRatio = maxHeight / naturalHeight;
        const scale = Math.min(widthRatio, heightRatio, 1);
        const width = Math.round(naturalWidth * scale);
        const height = Math.round(naturalHeight * scale);
        const left = Math.round((viewportWidth - width) / 2);
        const top = Math.round((viewportHeight - height) / 2);
        return { left, top, width, height };
    };

    function openFullscreenFromThumb(imgEl: HTMLImageElement, src: string, name: string) {
        const rect = imgEl.getBoundingClientRect();
        const startRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        const tempImg = new Image();
        tempImg.src = src;
        // Hide original while animating
        imgEl.style.visibility = "hidden";
        tempImg.onload = () => {
            const endRect = computeEndRect(tempImg.naturalWidth, tempImg.naturalHeight);
            setFullscreenImage({
                src,
                name,
                element: imgEl,
                startRect,
                endRect
            });
            // Start animation on next frame to ensure DOM has overlay mounted
            requestAnimationFrame(() => setIsAnimatingOpen(true));
        };
    };

    function closeFullscreen() {
        // Reverse animation
        setIsAnimatingOpen(false);
        // Wait for transition to finish
        setTimeout(() => {
            if (fullscreenImage?.element) {
                fullscreenImage.element.style.visibility = "visible";
            }
            setFullscreenImage(null);
        }, 300);
    };

    async function downloadImage() {
        if (!fullscreenImage) return;
        const { src, name } = fullscreenImage;
        try {
            setIsDownloadingFullscreen(true);
            if (src.startsWith("blob:")) {
                const link = document.createElement("a");
                link.href = src;
                link.download = name;
                link.click();
                setIsDownloadingFullscreen(false);
                return;
            }

            // Fetch with credentials/headers when not a blob URL
            const response = await fetch(src, {
                headers: user.authToken ? api.user.auth.getAuthHeaders(user.authToken) : undefined,
                credentials: "include"
            });
            if (!response.ok) throw new Error("Failed to download image");
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
        } finally {
            setIsDownloadingFullscreen(false);
        }
    };

    async function downloadFile(file: Attachment) {
        try {
            updateDownloadingPaths(draft => {
                draft.add(file.path);
            });
            // Prefer decrypted URL if present (DM encrypted case)
            const decrypted = decryptedFiles.get(file.path);
            if (decrypted) {
                const link = document.createElement("a");
                link.href = decrypted;
                link.download = file.name || "file";
                link.click();
                updateDownloadingPaths(draft => {
                    draft.delete(file.path);
                });
                return;
            }

            // If this is an encrypted DM attachment, decrypt before downloading
            const looksEncryptedPath = /\/uploads\/files\/encrypted\//.test(file.path) || /\/api\/uploads\/files\/encrypted\//.test(file.path);
            if (isDm && (file.encrypted || looksEncryptedPath)) {
                const decryptedUrl = await decryptFile(file);
                if (decryptedUrl) {
                    const link = document.createElement("a");
                    link.href = decryptedUrl;
                    link.download = file.name || "file";
                    link.click();
                    updateDownloadingPaths(draft => {
                        draft.delete(file.path);
                    });
                    return;
                }
            }

            // If not decrypted or public file, fetch with credentials/headers
            const response = await fetch(api.files.resolveAttachmentUrl(file.path), {
                headers: user.authToken ? api.user.auth.getAuthHeaders(user.authToken) : undefined,
                credentials: "include"
            });
            if (!response.ok) throw new Error("Failed to download file");
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = file.name || "file";
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
        } finally {
            updateDownloadingPaths(draft => {
                draft.delete(file.path);
            });
        }
    };

    async function handleProfileClick() {
        if (!user.authToken || !message.user_id) return;

        try {
            const userProfile = await api.user.profile.fetchById(user.authToken, message.user_id);
            if (userProfile) {
                setProfileDialog({
                    ...userProfile,
                    userId: userProfile.id,
                    memberSince: userProfile.created_at,
                    isOwnProfile: false
                });
            }
        } catch (error) {
            console.error("Failed to fetch user profile:", error);
        }
    }

    async function handleLinkClick(e: React.MouseEvent<HTMLDivElement>) {
        if (e.target.tagName === 'A') {
            const link = (e.target as unknown as HTMLAnchorElement).href;
            const profileLink = parseProfileLink(link);

            if (profileLink) {
                e.preventDefault();
                e.stopPropagation();

                if (!user.authToken) return;

                try {
                    let userProfile;

                    if (profileLink.userId) {
                        userProfile = await api.user.profile.fetchById(user.authToken, profileLink.userId);
                        } else if (profileLink.username) {
                        userProfile = await api.user.profile.fetchByUsername(user.authToken, profileLink.username);
                    }

                    if (userProfile) {
                        setProfileDialog({
                            ...userProfile,
                            userId: userProfile.id,
                            memberSince: userProfile.created_at,
                            isOwnProfile: userProfile.id === user.currentUser?.id
                        });
                    } else {
                        throw new Error(`Invalid link: ${link}`);
                    }
                } catch (error) {
                    console.error("Failed to fetch user profile from link:", error);
                }
            }
        }
    }

    function handleContextMenu(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, message);
    }
    const messageText = message.content.trim();

    const isEmojiMessage = useMemo(() => {
        const emojiRegex = /^[\s\p{Emoji}]*$/u;
        return messageText.length > 0 && emojiRegex.test(messageText);
    }, [messageText]);

    // Check if message has only one emoji
    const isSingleEmojiMessage = useMemo(() => {
        const emojiRegex = /^[\p{Emoji}]+$/u;
        return messageText.length > 0 && emojiRegex.test(messageText) && messageText.length <= 4; // Most emojis are 1-4 characters
    }, [messageText]);

    const isDeletedSender = isRedactedPeer({ id: message.user_id, username: message.username });

    return (
        <>
            <div
                className={`${styles.message} ${isAuthor ? styles.sent : styles.received} ${isEmojiMessage ? styles.emojiMessage : ""} ${isSingleEmojiMessage ? "" : ""}`}
                data-id={message.id}
                onContextMenu={handleContextMenu}
            >
                {!isAuthor && !isDm && (
                    <div className={styles.messageProfilePic} onClick={handleProfileClick}>
                        {isDeletedSender ? (
                            <DeletedUserAvatar
                                userId={message.user_id}
                                className={styles.deletedUserAvatar}
                                iconClassName={styles.deletedUserAvatarIcon}
                            />
                        ) : (
                            <img
                                src={message.profile_picture || defaultAvatar}
                                alt={message.username}
                                onError={(e) => {
                                    e.target.src = defaultAvatar;
                                }}
                            />
                        )}
                    </div>
                )}

                <div className={styles.messageInner}>
                    {!isAuthor && !isDm && !isSingleEmojiMessage && (
                        <div
                            className={styles.messageUsername}
                            onClick={handleProfileClick}>
                            {displayNameForUser({ id: message.user_id, username: message.username })}
                            {!isDeletedSender && (
                                <StatusBadge
                                    verificationStatus={message.verification_status}
                                    verified={message.verified || false}
                                    size="small"
                                />
                            )}
                        </div>
                    )}

                    {message.reply_to && (
                        <Quote className={`${styles.replyPreview} ${replyPreviewStyles.contextualContent}`} background={isAuthor ? "primaryContainer" : "surfaceContainer"}>
                            <span className={replyPreviewStyles.replyUsername}>{message.reply_to.username}</span>
                            <span className={replyPreviewStyles.replyText}>{message.reply_to.content}</span>
                        </Quote>
                    )}

                    {messageText.length > 0 && (
                        <div
                            className={`${styles.messageContent} ${isEmojiMessage ? styles.emojiContent : ""} ${isSingleEmojiMessage ? styles.singleEmojiContent : ""}`}
                            dangerouslySetInnerHTML={formattedMessage}
                            onClick={handleLinkClick} />
                    )}

                    {message.files && message.files.length > 0 && (
                        <MaterialList className={styles.messageAttachments}>
                            {message.files.map((file, idx) => {
                                const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.name || "");
                                const looksEncryptedPath = /\/uploads\/files\/encrypted\//.test(file.path) || /\/api\/uploads\/files\/encrypted\//.test(file.path);
                                const isEncryptedDm = Boolean(isDm && (file.encrypted || looksEncryptedPath));
                                const decryptedUrl = decryptedFiles.get(file.path);
                                const imageSrc = isImage
                                    ? (isEncryptedDm
                                        ? decryptedUrl
                                        : api.files.resolveAttachmentUrl(file.path))
                                    : undefined;
                                const isDownloading = downloadingPaths.has(file.path);
                                const isSending = message.runtimeData?.sendingState?.status === 'sending';

                                return (
                                    <div className={styles.attachment} key={idx}>
                                        {isImage ? (
                                            <div className={styles.imageWrapper}>
                                                {isEncryptedDm && !decryptedUrl ? null : (
                                                    <img
                                                        ref={(el) => {
                                                            if (el) imageRefs.current.set(file.path, el);
                                                        }}
                                                        src={imageSrc}
                                                        alt={file.name || "image"}
                                                        onClick={(e) => handleImageClick(file, e.currentTarget)}
                                                        onLoad={() => updateLoadedImages(draft => { draft.add(file.path); })}
                                                        className={`${styles.attachementImage} ${loadedImages.has(file.path) ? "" : styles.loading}`}
                                                    />
                                                )}
                                                {((isEncryptedDm && !decryptedUrl) || !loadedImages.has(file.path) || isSending) && (
                                                    <div className={styles.loadingOverlay}>
                                                        <MaterialCircularProgress />
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <a
                                                href="#"
                                                onClick={async (e) => {
                                                    e.preventDefault();
                                                    await downloadFile(file);
                                                }}
                                            >
                                                <MaterialListItem>
                                                    <span className={styles.withIconGap}>
                                                        {isDownloading ? <MaterialCircularProgress /> : null}
                                                        {(file.name || file.path.split("/").pop() || "Имя файла неизвестно").replace(/\d+_\d+_/, "")}
                                                    </span>
                                                </MaterialListItem>
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                        </MaterialList>
                    )}

                    <Reactions
                        reactions={message.reactions}
                        onReactionClick={(emoji) => onReactionClick?.(message.id, emoji)}
                        messageId={message.id}
                    />

                    <div className={styles.messageTime}>
                        {formatTime(message.timestamp)}
                        {message.is_edited ? " (edited)" : undefined}

                        {isAuthor && message.is_read && (
                            <span className="material-symbols outlined"></span>
                        )}

                        {isAuthor && message.runtimeData?.sendingState && (
                            <span className={styles.messageStatusIndicator}>
                                {message.runtimeData.sendingState.status === 'sending' && (
                                    <MaterialCircularProgress style={{ width: '16px', height: '16px' }} />
                                )}
                                {message.runtimeData.sendingState.status === 'failed' && (
                                    <span className={`material-symbols ${styles.errorIcon}`}>error</span>
                                )}
                                {message.runtimeData.sendingState.status === 'sent' && (
                                    <span className={`material-symbols ${styles.successIcon}`}>check</span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Fullscreen Image Viewer with shared-element like transition */}
            {fullscreenImage && createPortal(
                <div
                    className={`${styles.fullscreenImageOverlay} ${isAnimatingOpen ? "" : styles.closing}`}
                    onClick={closeFullscreen}>
                    <img
                        src={fullscreenImage.src}
                        alt={fullscreenImage.name}
                        className={styles.fullscreenAnimatedImage}
                        style={{
                            left: `${isAnimatingOpen ? fullscreenImage.endRect.left : fullscreenImage.startRect.left}px`,
                            top: `${isAnimatingOpen ? fullscreenImage.endRect.top : fullscreenImage.startRect.top}px`,
                            width: `${isAnimatingOpen ? fullscreenImage.endRect.width : fullscreenImage.startRect.width}px`,
                            height: `${isAnimatingOpen ? fullscreenImage.endRect.height : fullscreenImage.startRect.height}px`
                        }}
                        onClick={e => e.stopPropagation()}
                    />
                    <div className={`${styles.fullscreenControls} ${styles.topRight}`} onClick={e => e.stopPropagation()}>
                        <MaterialIconButton icon="close" onClick={closeFullscreen} />
                        {isDownloadingFullscreen ? (
                            <div className={styles.progressWrapper}>
                                <MaterialCircularProgress />
                            </div>
                        ) : (
                            <MaterialIconButton icon="download" onClick={downloadImage} />
                        )}
                    </div>
                </div>,
                id("root")
            )}
        </>
    );
}
