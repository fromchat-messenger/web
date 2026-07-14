import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RichTextArea } from "@/core/components/RichTextArea";
import type { Message } from "@/core/types";
import Quote from "@/core/components/Quote";
import { useImmer } from "use-immer";
import { EmojiMenu } from "./EmojiMenu";
import { MaterialIcon, MaterialIconButton } from "@/utils/material";
import styles from "@/pages/chat/css/ChatInput.module.scss";
import replyPreviewStyles from "@/pages/chat/css/reply-preview.module.scss";
import { alert } from "mdui/functions/alert";

interface ChatInputWrapperProps {
    onSendMessage: (message: string, files: File[]) => void;
    onSaveEdit?: (content: string) => void;
    replyTo?: Message | null;
    replyToVisible: boolean;
    onClearReply?: () => void;
    onCloseReply?: () => void;
    editingMessage?: Message | null;
    editVisible?: boolean;
    onClearEdit?: () => void;
    onCloseEdit?: () => void;
    onProvideFileAdder?: (adder: (files: File[]) => void) => void;
    messagePanelRef?: React.RefObject<HTMLDivElement | null>;
    onTyping?: () => void;
    onStopTyping?: () => void;
}

export function ChatInputWrapper(
    {
        onSendMessage,
        onSaveEdit,
        replyTo,
        replyToVisible,
        onClearReply,
        onCloseReply,
        editingMessage,
        editVisible = false,
        onClearEdit,
        onCloseEdit,
        onProvideFileAdder,
        messagePanelRef,
        onTyping,
        onStopTyping
    }: ChatInputWrapperProps
) {
    const [message, setMessage] = useState("");
    const [selectedFiles, setSelectedFiles] = useImmer<File[]>([]);
    const [attachmentsVisible, setAttachmentsVisible] = useState(false);
    const [emojiMenuOpen, setEmojiMenuOpen] = useState(false);
    const [emojiMenuPosition, setEmojiMenuPosition] = useState({ x: 0, y: 0 });
    const chatInputWrapperRef = useRef<HTMLDivElement>(null);

    // Expose a way for parent to programmatically add files
    useEffect(() => {
        if (onProvideFileAdder) {
            const addFiles = (files: File[]) => {
                if (!files || files.length === 0) return;
                setSelectedFiles(draft => { draft.push(...files) });
            };
            onProvideFileAdder(addFiles);
        }
    }, [onProvideFileAdder]);

    // When entering edit mode, preload the message content
    useEffect(() => {
        setMessage(editingMessage ? editingMessage.content || "" : "");
    }, [editingMessage]);

    useEffect(() => {
        setAttachmentsVisible(selectedFiles.length > 0);
    }, [selectedFiles]);

    function handleEmojiButtonClick(e: React.MouseEvent<HTMLButtonElement>) {
        e.stopPropagation();

        if (!emojiMenuOpen) {
            if (chatInputWrapperRef.current && messagePanelRef?.current) {
                const inputRect = chatInputWrapperRef.current.getBoundingClientRect();
                const panelRect = messagePanelRef.current.getBoundingClientRect();

                // Position menu 10px from message panel edge and 10px above the chat input
                // The animation will start 30px below this position
                setEmojiMenuPosition({
                    x: panelRect.left + 10, // 10px from message panel edge
                    y: window.innerHeight - inputRect.top + 10 // 10px above the top of chat input
                });
                setEmojiMenuOpen(true);
            }
        } else {
            setEmojiMenuOpen(false);
        }
    };

    function handleEmojiSelect(emoji: string) {
        setMessage(prev => prev + emoji);
    };

    function handleTyping() {
        if (onTyping) {
            onTyping();
        }
    };

    function handleMessageChange(value: string) {
        setMessage(value);
        handleTyping();
    };

    async function handleSubmit(e: React.FormEvent | Event) {
        e.preventDefault();
        const hasText = Boolean(message.trim());
        const hasFiles = selectedFiles.length > 0;
        if (hasText || hasFiles) {
            const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
            const limit = 4 * 1024 * 1024 * 1024; // 4GB
            if (totalSize > limit) {
                alert({
                    headline: "Ошибка",
                    description: "Общий размер вложений превышает 4 ГБ."
                });
                return;
            }

            if (editingMessage && onSaveEdit) {
                onSaveEdit(message);
                setMessage("");
                if (onClearEdit) onClearEdit();
            } else {
                onSendMessage(message, selectedFiles);
                setMessage("");
                setAttachmentsVisible(false);
                if (onClearReply) onClearReply();
                // Stop typing indicator when message is sent
                if (onStopTyping) onStopTyping();
            }
        }
    };

    function handleAttachClick() {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.addEventListener("change", () => {
            setSelectedFiles(draft => { draft.push(...Array.from(input.files || [])) });
        });
        input.click();
    }

    return (
        <div className={styles.chatInputWrapper} ref={chatInputWrapperRef}>
            <form className={styles.inputGroup} id="message-form" onSubmit={handleSubmit}>
                <AnimatePresence onExitComplete={onCloseEdit}>
                    {editVisible && editingMessage && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            style={{ overflow: "hidden" }}
                        >
                            <div className={styles.contextualPreview}>
                                <MaterialIcon name="edit" />
                                <Quote className={`${replyPreviewStyles.contextualContent}`} background="surfaceContainer">
                                    <span className={replyPreviewStyles.replyUsername}>{editingMessage!.username}</span>
                                    <span className={replyPreviewStyles.replyText}>{editingMessage!.content}</span>
                                </Quote>
                                <MaterialIconButton icon="close" className={styles.replyCancel} onClick={onClearEdit}></MaterialIconButton>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <AnimatePresence onExitComplete={onCloseReply}>
                    {replyToVisible && replyTo && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            style={{ overflow: "hidden" }}
                        >
                            <div className={styles.contextualPreview}>
                                <MaterialIcon name="reply" />
                                <Quote className={`${replyPreviewStyles.contextualContent}`} background="surfaceContainer">
                                    <span className={replyPreviewStyles.replyUsername}>{replyTo!.username}</span>
                                    <span className={replyPreviewStyles.replyText}>{replyTo!.content}</span>
                                </Quote>
                                <MaterialIconButton icon="close" className={styles.replyCancel} onClick={onClearReply}></MaterialIconButton>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <AnimatePresence onExitComplete={() => setSelectedFiles([])}>
                    {attachmentsVisible && selectedFiles.length > 0 && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            style={{ overflow: "hidden" }}
                        >
                            <div className={`${styles.attachmentsPreview} ${styles.contextualPreview}`}>
                                <MaterialIcon name="attach_file" />
                                <div className={styles.attachmentsChips}>
                                    {selectedFiles.map((file, i) => (
                                        <mdui-chip
                                            key={i}
                                            variant="input"
                                            end-icon="close"
                                            title={`${file.name} (${Math.round(file.size/1024/1024)} MB)`}
                                            onClick={() => {
                                                if (selectedFiles.length == 1) {
                                                    setAttachmentsVisible(false);
                                                } else {
                                                    setSelectedFiles(draft => { draft.splice(i) })
                                                }
                                            }}
                                        >
                                            <MaterialIcon slot="icon" name="attach_file"></MaterialIcon>
                                            <span className="name">{file.name}</span>
                                        </mdui-chip>
                                    ))}
                                </div>
                                <MaterialIconButton icon="close" className={styles.replyCancel} onClick={() => setAttachmentsVisible(false)}></MaterialIconButton>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <div className={styles.chatInput}>
                    <div className={styles.leftButtons}>
                        <MaterialIconButton
                            icon="mood"
                            onClick={handleEmojiButtonClick}
                            onMouseDown={e => e.stopPropagation()}
                            onMouseUp={e => e.stopPropagation()}
                            className={styles.emojiBtn} />
                    </div>
                    <RichTextArea
                        className={styles.messageInput}
                        id="message-input"
                        placeholder="Напишите сообщение..."
                        autoComplete="off"
                        text={message}
                        rows={1}
                        onTextChange={handleMessageChange}
                        onEnter={handleSubmit} />
                    <div className={styles.buttons}>
                        <MaterialIconButton icon="attach_file" onClick={handleAttachClick}></MaterialIconButton>
                        <button type="submit" className={styles.sendBtn}>
                            <span className="material-symbols filled">{editingMessage ? "check" : "send"}</span>
                        </button>
                    </div>
                </div>
            </form>

            <EmojiMenu
                isOpen={emojiMenuOpen}
                onClose={() => setEmojiMenuOpen(false)}
                onEmojiSelect={handleEmojiSelect}
                position={emojiMenuPosition}
                mode="standalone"
            />
        </div>
    );
}
