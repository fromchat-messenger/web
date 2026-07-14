/**
 * @fileoverview Utility functions for handling profile links
 * @description Functions to parse and handle profile links in markdown content.
 * Supports two formats:
 * - fromchat.ru/@username (e.g., fromchat.ru/@john_doe)
 * - fromchat.ru/?u=<userId> (e.g., fromchat.ru/?u=123)
 * @author Cursor
 * @version 1.0.0
 */

import escapeStringRegexp from "escape-string-regexp";

/**
 * Parses a profile link URL and extracts user information
 * @param url - The URL to parse
 * @returns Object with user ID and username if it's a valid profile link, null otherwise
 */
export function parseProfileLink(url: string = location.pathname): { userId?: number; username?: string } | null {
    try {
        let host: string = url.startsWith("@") ? "" : !url.startsWith("/") ? "https://fromchat.ru/" : "/";

        // Handle fromchat.ru/@username format
        const usernameMatch = url.match(new RegExp(`${escapeStringRegexp(host)}@([a-zA-Z0-9_-]+)`));
        if (usernameMatch) {
            return { username: usernameMatch[1] };
        }

        // Handle fromchat.ru/?u=<userId> format
        const userIdMatch = url.match(new RegExp(`${escapeStringRegexp(host)}\\?u=(\\d+)`));
        if (userIdMatch) {
            return { userId: Number(userIdMatch[1]) };
        }

        return null;
    } catch (error) {
        console.error('Error parsing profile link:', error);
        return null;
    }
}