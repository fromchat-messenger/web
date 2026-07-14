/**
 * @fileoverview Application initialization logic
 * @description Handles initial application setup and state
 * @author FromChat Team
 * @version 1.0.0
 */

import { PRODUCT_NAME } from "./config";
import { enableMapSet } from "immer";
import type { Platform } from "../../electron/electron.d";

function detectPlatform(): Platform {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("win")) return "win32";
    if (userAgent.includes("mac")) return "darwin";
    return "linux";
}

document.title = PRODUCT_NAME;
enableMapSet();

// Add platform class to body
const platform = detectPlatform();
document.body.classList.add(`platform-${platform}`);