/**
 * @fileoverview WebSocket connection management for real-time chat
 * @description Handles WebSocket connections, message processing, and auto-reconnection
 * @author Cursor
 * @version 1.0.0
 */

import { getChatWebSocketUrl } from "./config";
import type { WebSocketMessage } from "./types";
import { delay } from "@/utils/utils";
import { CallSignalingHandler } from "./calls/signaling";
import { onlineStatusManager } from "./onlineStatusManager";
import { typingManager } from "./typingManager";
import { useUserStore } from "@/state/user";
import { getLastSequence, processBatchedUpdates, requestMissedUpdates } from "./updateManager";
import { getAuthToken } from "@/core/api/user/auth";

interface HttpError extends Error {
    status?: number;
    detail?: string;
}

/**
 * Creates a new WebSocket connection to the chat server
 * @returns {WebSocket} New WebSocket instance
 * @private
 */
function create(): WebSocket {
    return new WebSocket(getChatWebSocketUrl());
}

/**
 * Global WebSocket instance
 * @type {WebSocket}
 */
export let websocket: WebSocket = create();

/**
 * Global WebSocket message handler reference
 * This will be set by the active panel to handle incoming messages
 */
let globalMessageHandler: ((response: WebSocketMessage<any>) => void) | null = null;

/**
 * Call signaling handler
 */
let callSignalingHandler: CallSignalingHandler | null = null;

/**
 * Reconnection state
 */
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max delay
const INITIAL_RECONNECT_DELAY = 1000; // Start with 1 second
let isReconnecting = false;
let messageHandler: ((e: MessageEvent) => void) | null = null;
let errorHandler: ((e: Event) => void) | null = null;
let closeHandler: ((e: CloseEvent) => void) | null = null;
let openHandler: ((e: Event) => void) | null = null;

/**
 * Set the global WebSocket message handler
 * @param handler - Function to handle WebSocket messages
 */
export function setGlobalMessageHandler(handler: ((response: WebSocketMessage<any>) => void) | null): void {
    globalMessageHandler = handler;
}

/**
 * Set the call signaling handler
 * @param handler - Call signaling handler instance
 */
export function setCallSignalingHandler(handler: CallSignalingHandler | null): void {
    callSignalingHandler = handler;
}

/**
 * Clean up all event listeners from the current WebSocket instance
 * @private
 */
function cleanupWebSocket(): void {
    if (websocket) {
        if (messageHandler) {
            websocket.removeEventListener("message", messageHandler);
        }
        if (errorHandler) {
            websocket.removeEventListener("error", errorHandler);
        }
        if (closeHandler) {
            websocket.removeEventListener("close", closeHandler);
        }
        if (openHandler) {
            websocket.removeEventListener("open", openHandler);
        }
        
        // Close if still connected
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
            try {
                websocket.close();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
    }
}

/**
 * Calculate exponential backoff delay
 * @param attempt - Current reconnection attempt number
 * @returns Delay in milliseconds
 * @private
 */
function getReconnectDelay(attempt: number): number {
    const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, attempt);
    return Math.min(delay, MAX_RECONNECT_DELAY);
}

/**
 * Handle WebSocket reconnection with exponential backoff
 * @private
 */
async function reconnect(): Promise<void> {
    if (isReconnecting) {
        return;
    }

    isReconnecting = true;
    
    // Clean up old connection
    cleanupWebSocket();

    const delayMs = getReconnectDelay(reconnectAttempts);
    reconnectAttempts++;

    await delay(delayMs);

    try {
        websocket = create();
        setupEventHandlers();
    } catch (error) {
        // If creation fails, try again
        isReconnecting = false;
        reconnect();
    }
}

/**
 * Setup event handlers for the WebSocket connection
 * @private
 */
function setupEventHandlers(): void {
    // Message handler
    messageHandler = async (e: MessageEvent) => {
        try {
            const response: WebSocketMessage<any> = JSON.parse(e.data);

            // Handle batched updates
            if (response.type === "updates" && "seq" in response && "updates" in response) {
                // Create function to request missed updates with credentials
                const token = getAuthToken();
                const requestMissedFn = token ? async (lastSeq: number) => {
                    await requestMissedUpdates(lastSeq, async (req) => {
                        await request(req);
                    }, {
                        scheme: "Bearer",
                        credentials: token
                    });
                } : undefined;
                
                await processBatchedUpdates(response as any, (update) => {
                    // Route individual updates to appropriate handlers
                    handleUpdate(update);
                }, requestMissedFn);
                return;
            }

            // Handle call signaling messages
            if (callSignalingHandler && response.type === "call_signaling" && response.data) {
                callSignalingHandler.handleWebSocketMessage(response.data);
            }

            // Handle status and typing messages (these may come as immediate messages or in batches)
            handleUpdate(response);
        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
    };

    // Helper function to handle individual updates
    function handleUpdate(response: WebSocketMessage<any>): void {
        if (response.type === "statusUpdate") {
            onlineStatusManager.handleStatusUpdate(response as any);
        } else if (response.type === "typing") {
            typingManager.handleTyping(response as any);
        } else if (response.type === "stopTyping") {
            typingManager.handleStopTyping(response as any);
        } else if (response.type === "dmTyping") {
            typingManager.handleDmTyping(response as any);
        } else if (response.type === "stopDmTyping") {
            typingManager.handleStopDmTyping(response as any);
        } else if (response.type === "suspended") {
            // Handle account suspension
            const { setSuspended } = useUserStore.getState();
            const reason = response.data?.reason || "No reason provided";
            setSuspended(reason);
            // Close WebSocket connection
            websocket.close();
        } else if (response.type === "account_deleted") {
            // Handle account deletion - silent logout
            const { logout } = useUserStore.getState();
            logout();
            // Close WebSocket connection
            websocket.close();
        }

        // Route message to global handler if set
        if (globalMessageHandler) {
            globalMessageHandler(response);
        }
    }
    websocket.addEventListener("message", messageHandler);

    // Open handler
    openHandler = async () => {
        reconnectAttempts = 0; // Reset on successful connection
        isReconnecting = false;
        
        // Authenticate by sending ping with credentials and request missed updates
        try {
            const token = getAuthToken();
            if (token) {
                const credentials = {
                    scheme: "Bearer",
                    credentials: token
                };
                
                // Send ping to authenticate and set user_by_ws on the server
                try {
                    await request({
                        type: "ping",
                        credentials,
                        data: {}
                    });
                } catch (error) {
                    console.error("Failed to send ping on reconnect:", error);
                }
                
                // Send last sequence number and request missed updates on reconnect
                // Wait a bit for ping to complete authentication
                await delay(100);
                
                try {
                    const lastSeq = await getLastSequence();
                    if (lastSeq > 0) {
                        await requestMissedUpdates(lastSeq, async (req) => {
                            await request(req);
                        }, credentials);
                    }
                } catch (error) {
                    console.error("Failed to request missed updates:", error);
                }
            }
        } catch (error) {
            console.error("Failed to authenticate on reconnect:", error);
        }
    };
    websocket.addEventListener("open", openHandler);

    // Error handler
    errorHandler = () => {
        // Don't reconnect immediately on error - let close handler handle it
        // This prevents double reconnection attempts
    };
    websocket.addEventListener("error", errorHandler);

    // Close handler
    closeHandler = (e: CloseEvent) => {
        // Don't reconnect if it was a clean close (e.g., logout, suspension)
        if (e.code === 1000 || e.code === 1001) {
            return;
        }

        // Reconnect for unexpected closes
        if (!isReconnecting) {
            reconnect();
        }
    };
    websocket.addEventListener("close", closeHandler);
}

export function request<Request, Response = any>(payload: WebSocketMessage<Request>): Promise<WebSocketMessage<Response>> {
    console.log("WebSocket request:", payload);
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error("Request timed out"));
        }, 10000);

        function requestInner() {
            if (websocket.readyState !== WebSocket.OPEN) {
                clearTimeout(timeoutId);
                reject(new Error("WebSocket is not open"));
                return;
            }

            const listener = (e: MessageEvent) => {
                try {
                    const response = JSON.parse(e.data);
                    // Only handle responses that match our request type or have an error
                    if (response.type === payload.type || response.error) {
                        clearTimeout(timeoutId);
                        websocket.removeEventListener("message", listener);
                        
                        // Check if the response contains an error field
                        if (response.error) {
                            const error = new Error(response.error.detail || "WebSocket request failed");
                            (error as HttpError).status = response.error.code;
                            (error as HttpError).detail = response.error.detail || "";
                            reject(error);
                        } else {
                            resolve(response);
                        }
                    }
                    // If it doesn't match, let other handlers process it
                } catch (error) {
                    clearTimeout(timeoutId);
                    websocket.removeEventListener("message", listener);
                    reject(error);
                }
            };

            websocket.addEventListener("message", listener);
            
            try {
                websocket.send(JSON.stringify(payload));
            } catch (error) {
                clearTimeout(timeoutId);
                websocket.removeEventListener("message", listener);
                reject(error);
            }
        }

        if (websocket.readyState === WebSocket.CONNECTING) {
            const openListener = () => {
                websocket.removeEventListener("open", openListener);
                requestInner();
            };
            websocket.addEventListener("open", openListener);
        } else if (websocket.readyState === WebSocket.OPEN) {
            requestInner();
        } else {
            clearTimeout(timeoutId);
            reject(new Error("WebSocket is closed"));
        }
    });
}

// --------------
// Initialization
// --------------

/**
 * Ensure WebSocket is connected and authenticated after login
 * This should be called after successful authentication
 */
export async function ensureAuthenticated(): Promise<void> {
    const token = getAuthToken();
    if (!token) {
        return;
    }

    // If WebSocket is not connected, wait for it to connect
    if (websocket.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
            const checkConnection = () => {
                if (websocket.readyState === WebSocket.OPEN) {
                    resolve();
                } else if (websocket.readyState === WebSocket.CLOSED) {
                    // Connection failed, try to reconnect
                    reconnect().then(() => {
                        setTimeout(checkConnection, 100);
                    });
                } else {
                    setTimeout(checkConnection, 100);
                }
            };
            checkConnection();
        });
    } else if (websocket.readyState === WebSocket.CLOSED) {
        // Reconnect if closed
        await reconnect();
    }

    // If WebSocket is open, send ping to authenticate
    if (websocket.readyState === WebSocket.OPEN) {
        try {
            const credentials = {
                scheme: "Bearer",
                credentials: token
            };
            
            await request({
                type: "ping",
                credentials,
                data: {}
            });
        } catch (error) {
            console.error("Failed to send ping after login:", error);
        }
    }
}

setupEventHandlers();