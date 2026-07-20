/**
 * @fileoverview Global TypeScript type definitions
 * @description Contains all type definitions used throughout the application
 * @author Cursor
 * @version 1.0.0
 */


/**
 * HTTP headers object type
 * @typedef {Object.<string, string>} Headers
 */
export type Headers = {[x: string]: string}

/**
 * API error response structure
 * @interface ErrorResponse
 * @property {string} message - Error message from the server
 */
export interface ErrorResponse {
    message: string;
}

/**
 * 2D coordinate structure
 * @interface Size2D
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 */
export interface Size2D {
    x: number;
    y: number;
}

export interface Rect extends Size2D {
    width: number;
    height: number;
}

// App types

export type VerificationStatus = "verified" | "warning" | "blocked" | "none";

/**
 * Chat message structure
 * @interface Message
 * @property {number} id - Unique message identifier
 * @property {string} username - Username of the message sender
 * @property {string} content - Message content
 * @property {boolean} is_read - Whether the message has been read
 * @property {boolean} is_edited - Whether the message has been edited
 * @property {string} timestamp - ISO timestamp of the message
 * @property {string} [profile_picture] - URL to sender's profile picture
 * @property {Message} [reply_to] - The message this is replying to
 */
export interface Reaction {
    emoji: string;
    count: number;
    users: Array<{
        id: number;
        username: string;
    }>;
}

export interface Message {
    id: number;
    user_id: number;
    username: string;
    content: string;
    is_read: boolean;
    is_edited: boolean;
    timestamp: string;
    profile_picture?: string;
    verified?: boolean;
    verification_status?: VerificationStatus;
    reply_to?: Message;
    files?: Attachment[];
    reactions?: Reaction[];

    runtimeData?: {
        dmEnvelope?: DmEnvelope;
        sendingState?: {
            status: 'sending' | 'sent' | 'failed';
            tempId?: string; // Temporary ID for tracking until server confirms
            retryData?: {
                content: string;
                replyToId?: number;
                files?: File[];
            };
        };
    }
}

/**
 * Collection of messages
 * @interface Messages
 * @property {Message[]} messages - Array of message objects
 */
export interface Messages {
    messages: Message[];
}

/**
 * User information structure
 * @interface User
 * @property {number} id - Unique user identifier
 * @property {string} created_at - ISO timestamp of account creation
 * @property {string} last_seen - ISO timestamp of last activity
 * @property {boolean} online - Whether the user is currently online
 * @property {string} username - Username
 * @property {string} [bio] - User biography
 */
export interface User {
    id: number;
    created_at: string;
    last_seen: string;
    online: boolean;
    username: string;
    display_name: string;
    admin?: boolean;
    bio?: string;
    profile_picture: string;
    verified?: boolean;
    verification_status?: VerificationStatus;
    suspended?: boolean;
    suspension_reason?: string | null;
    deleted?: boolean;
}

/**
 * User profile response structure
 * @interface UserProfile
 * @property {number} id - Unique user identifier
 * @property {string} username - Username
 * @property {string} [profile_picture] - URL to user's profile picture
 * @property {string} [bio] - User biography
 * @property {boolean} online - Whether the user is currently online
 * @property {string} last_seen - ISO timestamp of last activity
 * @property {string} created_at - ISO timestamp of account creation
 */
export interface UserProfile {
    id: number;
    username: string;
    display_name: string;
    profile_picture?: string;
    bio?: string;
    online: boolean;
    last_seen: string;
    created_at: string;
    verified?: boolean;
    verification_status?: VerificationStatus;
    deleted?: boolean;
    suspended?: boolean;
}

// ----------
// API models
// ----------

// Requests

/**
 * Login request structure
 * @interface LoginRequest
 * @property {string} username - Username for authentication
 * @property {string} password - Password for authentication
 */
export interface LoginRequest {
    username: string;
    password: string;
}

/**
 * Registration request structure
 * @interface RegisterRequest
 * @property {string} username - Desired username
 * @property {string} password - Desired password
 * @property {string} confirm_password - Password confirmation
 */
export interface RegisterRequest {
    username: string;
    display_name: string;
    password: string;
    confirm_password: string;
    bio?: string;
}

export interface UploadPublicKeyRequest {
    publicKey: string;
}

export interface SendDMRequest {
    recipientId: number;
    iv_b64: string;
    ciphertext_b64: string;
    wrapped_mek_b64: string;
    replyToId?: number;
}

// Responses

/**
 * Login response structure
 * @interface LoginResponse
 * @property {User} user - User information
 * @property {string} token - JWT authentication token
 */
export interface LoginResponse {
    user: User;
    token: string;
}

export interface BackupBlob {
    blob: string;
}

export interface BaseDmEnvelope {
    iv_b64: string;
    ciphertext_b64: string;
    wrapped_mek_b64: string;
    recipientId: number;
}

export interface DmEnvelope extends BaseDmEnvelope {
    id: number;
    senderId: number;
    files?: DmFile[];
    timestamp: string;
    reactions?: Reaction[];
    replyToId?: number;
}

export interface DmFile {
    name: string;
    id: number;
    path: string;
    dm_envelope_id?: number;
    wrapped_mek_b64?: string;
    nonce_b64?: string;
}

export interface DmEditedPayload {
    id: number;
    iv: string;
    ciphertext: string;
    timestamp: string
}

export interface DmDeletedPayload {
    id: number;
    senderId: number;
    recipientId: number
}

export interface FetchDMResponse {
    messages: DmEnvelope[]
}

export interface DmEncryptedJSON {
    type: "text",
    data: {
        content: string;
        reply_to_id?: number;
        files?: Attachment[];
    }
}

// ---------------
// WebSocket types
// ---------------

/**
 * WebSocket message structure
 * @interface WebSocketMessage
 * @property {string} type - Message type identifier
 * @property {WebSocketCredentials} [credentials] - Authentication credentials
 * @property {any} [data] - Message payload data
 * @property {WebSocketError} [error] - Error information if applicable
 */
export interface WebSocketMessage<T> {
    type: string;
    credentials?: WebSocketCredentials;
    data?: T;
    error?: WebSocketError;
}

/**
 * WebSocket error structure
 * @interface WebSocketError
 * @property {number} code - Error code
 * @property {string} detail - Error detail message
 */
export interface WebSocketError {
    code: number;
    detail: string;
}

/**
 * WebSocket authentication credentials
 * @interface WebSocketCredentials
 * @property {string} scheme - Authentication scheme (e.g., "Bearer")
 * @property {string} credentials - Authentication token or credentials
 */
export interface WebSocketCredentials {
    scheme: string;
    credentials: string;
}

export interface Attachment {
    path: string;
    encrypted: boolean;
    name: string;
    wrapped_mek_b64?: string;
    nonce_b64?: string;
}

// -----------------------
// WebSocket message types
// -----------------------

// Utils
export interface DMEditPayload {
    id: number;
    senderId: number;
    recipientId: number;
    iv_b64: string;
    ciphertext_b64: string;
    wrapped_mek_b64: string;
    timestamp: string;
}

// Requests
export interface DMEditRequest extends WebSocketMessage {
    type: "dmEdit",
    credentials: WebSocketCredentials;
    data: DMEditPayload
}

export interface SendMessageRequest extends WebSocketMessage {
    type: "sendMessage",
    credentials: WebSocketCredentials;
    data: {
        content: string;
        reply_to_id: number | null;
    }
}

export interface AddReactionRequest extends WebSocketMessage {
    type: "addReaction",
    credentials: WebSocketCredentials;
    data: {
        message_id: number;
        emoji: string;
    }
}

export interface AddDmReactionRequest extends WebSocketMessage {
    type: "addDmReaction",
    credentials: WebSocketCredentials;
    data: {
        dm_envelope_id: number;
        emoji: string;
    }
}

// Messages
export interface DMNewWebSocketMessage extends WebSocketMessage {
    type: "dmNew",
    data: DmEnvelope
}

export interface DMEditedWebSocketMessage extends WebSocketMessage {
    type: "dmEdited",
    data: DMEditPayload
}

export interface DMDeletedWebSocketMessage extends WebSocketMessage {
    type: "dmDeleted",
    data: {
        id: number;
    }
}

export interface MessageEditedWebSocketMessage extends WebSocketMessage {
    type: "messageEdited",
    data: Partial<Message> & { id: number }
}

export interface MessageDeletedWebSocketMessage extends WebSocketMessage {
    type: "messageDeleted",
    data: {
        message_id: number;
    }
}

export interface NewMessageWebSocketMessage extends WebSocketMessage {
    type: "newMessage",
    data: Message
}

export interface ReactionUpdateWebSocketMessage extends WebSocketMessage {
    type: "reactionUpdate",
    data: {
        message_id: number;
        emoji: string;
        action: "added" | "removed";
        user_id: number;
        username: string;
        reactions: Reaction[];
    }
}

export interface DMReactionUpdateWebSocketMessage extends WebSocketMessage {
    type: "dmReactionUpdate",
    data: {
        dm_envelope_id: number;
        emoji: string;
        action: "added" | "removed";
        user_id: number;
        username: string;
        reactions: Reaction[];
    }
}

// Shared types
export type DMWebSocketMessage = DMNewWebSocketMessage | DMEditedWebSocketMessage | DMDeletedWebSocketMessage | DMReactionUpdateWebSocketMessage
export type ChatWebSocketMessage = MessageEditedWebSocketMessage | MessageDeletedWebSocketMessage | NewMessageWebSocketMessage | ReactionUpdateWebSocketMessage

// -----------
// Encrypted message JSON (plaintext structure before encryption)
// -----------

export type ChatMessageKind = "text"; // Extendable for future kinds

export interface EncryptedTextMessageData {
    content: string;
    files?: Attachment[];
    reply_to_id?: number | null;
}

export interface EncryptedMessageJson {
    type: ChatMessageKind;
    data: EncryptedTextMessageData;
}

// -----------
// React types
// -----------
export interface DialogProps {
    isOpen: boolean;
    onOpenChange: (value: boolean) => void;
}

// Call types
export interface CallSignalingData {
    fromUserId: number;
    toUserId: number;
}

export interface CallInviteData {
    fromUsername: string;
}

export interface CallInviteMessageData {
    fromUsername: string;
}

export type CallSignalingDataType = "call_offer" | "call_answer" | "call_ice_candidate" | "call_end" | "call_invite" | "call_accept" | "call_reject" | "call_session_key" | "call_signaling" | "call_video_toggle" | "call_screen_share_toggle";

export interface CallSignalingMessage extends WebSocketMessage {
    type: CallSignalingDataType;
    fromUserId: number;
    toUserId: number;
    sessionKeyHash?: string;
    data: CallSignalingMessageData;
}

export type CallSignalingMessageData =
    | CallInviteMessageData
    | CallAcceptData
    | CallRejectData
    | CallOfferData
    | CallAnswerData
    | CallIceCandidateData
    | CallEndData
    | CallSessionKeyData
    | CallVideoToggleData
    | CallScreenShareToggleData;

export interface CallAcceptData {
    fromUserId: number;
}

export interface CallRejectData {
    fromUserId: number;
}

export interface CallOfferData extends RTCSessionDescriptionInit {
}

export interface CallAnswerData extends RTCSessionDescriptionInit {
}

export interface CallIceCandidateData extends RTCIceCandidateInit {
}

export interface CallEndData {
    fromUserId: number;
}

export interface CallSessionKeyData {
    wrappedSessionKey?: WrappedSessionKeyPayload;
}

export interface CallVideoToggleData {
    enabled: boolean;
}

export interface CallScreenShareToggleData {
    enabled: boolean;
}

export interface CallVideoToggleMessageData {
    fromUserId: number;
    data: CallVideoToggleData;
}

export interface CallScreenShareToggleMessageData {
    fromUserId: number;
    data: CallScreenShareToggleData;
}

export interface WrappedSessionKeyPayload {
    salt: string;
    iv2: string;
    wrapped: string;
}

export interface CallVideoToggleMessage extends CallSignalingMessage {
    type: "call_video_toggle";
    data: CallVideoToggleData;
}

export interface CallScreenShareToggleMessage extends CallSignalingMessage {
    type: "call_screen_share_toggle";
    data: CallScreenShareToggleData;
}

// -----------
// Online Status & Typing WebSocket Messages
// -----------

export interface StatusUpdateWebSocketMessage extends WebSocketMessage {
    type: "statusUpdate";
    data: {
        userId: number;
        online: boolean;
        lastSeen: string;
    };
}

export interface SubscribeStatusWebSocketMessage extends WebSocketMessage {
    type: "subscribeStatus";
    credentials: WebSocketCredentials;
    data: {
        userId: number;
    };
}

export interface UnsubscribeStatusWebSocketMessage extends WebSocketMessage {
    type: "unsubscribeStatus";
    credentials: WebSocketCredentials;
    data: {
        userId: number;
    };
}

export interface TypingWebSocketMessage extends WebSocketMessage {
    type: "typing";
    data: {
        userId: number;
        username: string;
    };
}

export interface StopTypingWebSocketMessage extends WebSocketMessage {
    type: "stopTyping";
    data: {
        userId: number;
        username: string;
    };
}

export interface DmTypingWebSocketMessage extends WebSocketMessage {
    type: "dmTyping";
    data: {
        userId: number;
        username: string;
    };
}

export interface StopDmTypingWebSocketMessage extends WebSocketMessage {
    type: "stopDmTyping";
    data: {
        userId: number;
        username: string;
    };
}

// Request types for sending typing/status messages
export interface TypingRequest extends WebSocketMessage {
    type: "typing";
    credentials: WebSocketCredentials;
    data: {};
}

export interface StopTypingRequest extends WebSocketMessage {
    type: "stopTyping";
    credentials: WebSocketCredentials;
    data: {};
}

export interface DmTypingRequest extends WebSocketMessage {
    type: "dmTyping";
    credentials: WebSocketCredentials;
    data: {
        recipientId: number;
    };
}

export interface StopDmTypingRequest extends WebSocketMessage {
    type: "stopDmTyping";
    credentials: WebSocketCredentials;
    data: {
        recipientId: number;
    };
}


// -------------
// Utility types
// -------------

export type Override<TBase, TExt> = Omit<TBase, keyof TExt> & TExt;