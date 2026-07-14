/**
 * @fileoverview Update Manager for Telegram-like update system
 * @description Handles update sequence numbers, batching, and gap detection
 * @author Cursor
 * @version 1.0.0
 */

import { openDB, type IDBPDatabase } from "idb";
import type { WebSocketCredentials, WebSocketMessage } from "./types";

interface UpdateMessage<T = any> {
    type: string;
    data: T;
}

interface BatchedUpdatesMessage {
    type: "updates";
    seq: number;
    updates: UpdateMessage[];
}

const DB_NAME = "fromchat-updates";
const DB_VERSION = 1;
const STORE_NAME = "lastSequence";

let db: IDBPDatabase | null = null;

/**
 * Initialize IndexedDB for storing last sequence number
 */
async function initDB(): Promise<IDBPDatabase> {
    if (db) return db;
    
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        }
    });
    
    return db;
}

/**
 * Get the last received sequence number from IndexedDB
 */
export async function getLastSequence(): Promise<number> {
    try {
        return (await initDB())
            .transaction(STORE_NAME, "readonly")
            .objectStore(STORE_NAME)
            .get("lastSeq") || 0;
    } catch (error) {
        console.error("Failed to get last sequence:", error);
        return 0;
    }
}

/**
 * Store the last received sequence number in IndexedDB
 */
export async function setLastSequence(seq: number): Promise<void> {
    try {
        (await initDB()).transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(seq, "lastSeq");
    } catch (error) {
        console.error("Failed to set last sequence:", error);
    }
}

/**
 * Process a batched updates message
 * @param message - The batched updates message from the server
 * @param handler - Function to handle individual updates
 * @param requestMissedFn - Optional function to request missed updates (for gap detection)
 */
export async function processBatchedUpdates(
    message: BatchedUpdatesMessage,
    handler: (update: UpdateMessage) => void,
    requestMissedFn?: (lastSeq: number) => Promise<void>
): Promise<void> {
    const { seq, updates } = message;
    const lastSeq = await getLastSequence();
    
    // Check for gap
    if (seq !== lastSeq + 1 && lastSeq > 0) {
        console.warn(`Update gap detected: expected ${lastSeq + 1}, got ${seq}`);
        
        // Request missing updates if function provided
        if (requestMissedFn) {
            try {
                await requestMissedFn(lastSeq);
            } catch (error) {
                console.error("Failed to request missed updates for gap:", error);
            }
        }
    }
    
    // Process all updates in the batch
    for (const update of updates) {
        handler(update);
    }
    
    // Update last sequence number
    await setLastSequence(seq);
}

/**
 * Request missed updates from the server
 * @param lastSeq - The last sequence number we received
 * @param requestFn - Function to send the request to the server
 * @param credentials - Optional WebSocket credentials for authentication
 */
export async function requestMissedUpdates(
    lastSeq: number,
    requestFn: (request: WebSocketMessage<{ lastSeq: number }>) => Promise<void>,
    credentials?: WebSocketCredentials
): Promise<void> {
    if (lastSeq > 0) {
        await requestFn({
            type: "getUpdates",
            data: { lastSeq },
            credentials
        });
    }
}