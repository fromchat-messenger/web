/**
 * @fileoverview Utility functions used throughout the application
 * @description Contains helper functions for common operations
 * @author Cursor
 * @version 1.0.0
 */

/**
 * Parses API timestamps into a Date in the user's local timezone.
 * Zone-less ISO strings from the server are treated as UTC (append Z),
 * matching Android's parseMessageInstant behavior.
 */
export function parseApiTimestamp(dateString: string): Date {
    const raw = dateString.trim();
    if (!raw) return new Date(NaN);
    const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
    const hasOffset =
        /[zZ]$/.test(normalized) ||
        /[+-]\d{2}:?\d{2}$/.test(normalized);
    return new Date(hasOffset ? normalized : `${normalized}Z`);
}

/**
 * Formats a timestamp string to HH:MM in the user's local timezone.
 * @param {string} dateString - ISO timestamp string to format
 * @returns {string} Formatted time string in HH:MM format
 * @example
 * formatTime('2024-01-15T14:30:00Z'); // Returns local "17:30" in UTC+3
 */
export function formatTime(dateString: string): string {
    const date = parseApiTimestamp(dateString);
    if (Number.isNaN(date.getTime())) return "";
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const hoursString = hours < 10 ? "0" + hours : String(hours);
    const minutesString = minutes < 10 ? "0" + minutes : String(minutes);
    return hoursString + ":" + minutesString;
}

/**
 * Creates a promise that resolves after a specified delay
 * @param {number} ms - Delay time in milliseconds
 * @returns {Promise<void>} Promise that resolves after the delay
 * @example
 * await delay(1000); // Wait for 1 second
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function b64(a: Uint8Array): string {
	// Avoid spreading large arrays into String.fromCharCode (stack overflow).
	const chunkSize = 0x8000; // 32KB
	let binary = "";
	for (let i = 0; i < a.length; i += chunkSize) {
		const slice = a.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, Array.from(slice) as number[]);
	}
	return btoa(binary);
}

export function ub64(s: string): Uint8Array {
	const bin = atob(s);
	const arr = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
	return arr;
}

export function id<T extends Element = HTMLElement>(id: string): T {
    return document.getElementById(id) as unknown as T
}

/**
 * Runs the specified callback after `click` or `touchstart` event is triggered.
 *
 * @param action The action to perform after interaction
 * @returns A function to clean up the event listeners.
 */
export function doAfterInteraction<T>(action?: () => (T | Promise<T>)): Promise<T> {
    return new Promise((resolve, reject) => {
        function doAfterInteractionInner() {
            document.removeEventListener("click", doAfterInteractionInner);
            document.removeEventListener("touchstart", doAfterInteractionInner);
            try {
                const result = action?.();
                if (result instanceof Promise) {
                    result.then(resolve);
                } else {
                    resolve(result as T);
                }
            } catch (error) {
                reject(error);
            }
        }

        document.addEventListener("click", doAfterInteractionInner);
        document.addEventListener("touchstart", doAfterInteractionInner);

        setTimeout(reject, 10000);
    });
}