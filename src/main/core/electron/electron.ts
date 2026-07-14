/**
 * @fileoverview Electron-specific code
 * @description This module initializes Electron-specific functionality.
 * @author denis0001-dev
 * @version 1.0.0
 */

import "./electron.scss";

export const isElectron = import.meta.env.VITE_ELECTRON && window.electronInterface != undefined;

if (isElectron) {
    console.log("Running in Electron");
    document.documentElement.classList.add("electron", `platform-${window.electronInterface.platform}`);
} else {
    console.log("Running in normal browser");
}