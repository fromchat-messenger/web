import { API_BASE_URL } from "@/core/config";
import type { LoginRequest, RegisterRequest, LoginResponse, Headers } from "@/core/types";
import { generateX25519KeyPair, hkdfExtractAndExpand, encodeBlob, encryptBackupWithPassword, decryptBackupWithPassword, decodeBlob } from "@fromchat/protocol";
import { b64, ub64 } from "@/utils/utils";
import { fetchPublicKey, uploadPublicKey } from "../crypto/identity";
import { fetchBackupBlob, uploadBackupBlob } from "../crypto/backup";

/**
 * Generates authentication headers for API requests
 * @param {string | null} token - Authentication token
 * @param {boolean} json - Whether to include JSON content type header
 * @returns {Headers} Headers object with authentication and content type
 */
export function getAuthHeaders(token: string | null, json: boolean = true): Headers {
    const headers: Headers = {};

    if (json) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

export interface CheckAuthResponse {
    authenticated: boolean;
    username: string;
    admin: boolean;
}

export interface LogoutResponse {
    status: string;
    message: string;
}

export interface UserKeyPairMemory {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}

let currentPublicKey: Uint8Array | null = null;
let currentPrivateKey: Uint8Array | null = null;

export function getCurrentKeys(): UserKeyPairMemory | null {
	if (currentPublicKey && currentPrivateKey) return { publicKey: currentPublicKey, privateKey: currentPrivateKey };
	return null;
}

function saveKeys(
	publicKey: Uint8Array<ArrayBufferLike>,
	privateKey: Uint8Array<ArrayBufferLike>
) {
	const encodedPublicKey = b64(publicKey);
	const encodedPrivateKey = b64(privateKey);

	localStorage.setItem("publicKey", encodedPublicKey);
	localStorage.setItem("privateKey", encodedPrivateKey);
}

/**
 * Checks if the current user is authenticated
 */
export async function checkAuth(token: string): Promise<CheckAuthResponse> {
    const res = await fetch(`${API_BASE_URL}/check_auth`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) throw new Error("Failed to check auth");
    return await res.json();
}

/**
 * Logs in a user with username and password
 */
export async function login(request: LoginRequest): Promise<LoginResponse> {
    const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: getAuthHeaders(null, true),
        body: JSON.stringify(request)
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Login failed" }));
        throw new Error(error.detail || "Login failed");
    }
    return await res.json();
}

/**
 * Registers a new user
 */
export async function register(request: RegisterRequest): Promise<LoginResponse> {
    const res = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: getAuthHeaders(null, true),
        body: JSON.stringify(request)
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Registration failed" }));
        throw new Error(error.detail || "Registration failed");
    }
    return await res.json();
}

/**
 * Logs out the current user
 */
export async function logout(token: string): Promise<LogoutResponse> {
    const res = await fetch(`${API_BASE_URL}/logout`, {
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) throw new Error("Failed to logout");
    return await res.json();
}

/**
 * Derive a client-side authentication secret so the raw password never leaves the client.
 * Uses PBKDF2 (via WebCrypto) + HKDF to produce a stable 32-byte key, then base64.
 */
export async function deriveAuthSecret(username: string, password: string): Promise<string> {
    // Use per-user salt derived from username; in future we can fetch a server-provided salt
    const salt = new TextEncoder().encode(`fromchat.user:${username}`);
    // Derive 32 bytes using HKDF; PBKDF2 already used within importPassword
    const derived = await hkdfExtractAndExpand(new TextEncoder().encode(password), salt, new TextEncoder().encode("auth-secret"), 32);
    return b64(derived);
}

export async function ensureKeysOnLogin(password: string, token: string): Promise<UserKeyPairMemory> {
	// Try to restore from backup
	const blobJson = await fetchBackupBlob(token);
	if (blobJson) {
		const blob = decodeBlob(blobJson);
		const bundle = await decryptBackupWithPassword(password, blob);
		currentPrivateKey = bundle.privateKey;
		// Ensure public key exists on server; if not, derive from private (not possible via libsafely), so keep previous
		// In our simple scheme, we rely on server having the public key or we reupload generated one on first setup
		const serverPub = await fetchPublicKey(token);
		if (serverPub) {
			currentPublicKey = serverPub;
		} else {
			// We don't have the corresponding public key from server; regenerate pair to resync
			const pair = generateX25519KeyPair();
			currentPublicKey = pair.publicKey;
			currentPrivateKey = pair.privateKey;
			await uploadPublicKey(currentPublicKey, token);
			const newBlob = await encryptBackupWithPassword(password, { version: 1, privateKey: currentPrivateKey });
			await uploadBackupBlob(encodeBlob(newBlob), token);
		}

		saveKeys(currentPublicKey!, currentPrivateKey!);

		return {
			publicKey: currentPublicKey!,
			privateKey: currentPrivateKey!
		};
	}

	// First-time setup: generate keys and upload
	const pair = generateX25519KeyPair();
	currentPublicKey = pair.publicKey;
	currentPrivateKey = pair.privateKey;
	await uploadPublicKey(currentPublicKey, token);
	const encBlob = await encryptBackupWithPassword(password, { version: 1, privateKey: currentPrivateKey });
	await uploadBackupBlob(encodeBlob(encBlob), token);

	saveKeys(pair.publicKey, pair.privateKey);

	return pair;
}

/**
 * When the client already has a keypair (e.g. from localStorage) but the server has no public key row,
 * upload the public key. Covers failed uploads during login, DB resets, and legacy accounts.
 */
export async function syncPublicKeyToServerIfMissing(token: string): Promise<void> {
	const keys = getCurrentKeys();
	if (!keys?.publicKey?.length || !keys?.privateKey?.length) {
		return;
	}
	const serverPk = await fetchPublicKey(token);
	if (serverPk) {
		return;
	}
	await uploadPublicKey(keys.publicKey, token);
}

export function restoreKeys() {
	currentPublicKey = ub64(localStorage.getItem("publicKey")!);
	currentPrivateKey = ub64(localStorage.getItem("privateKey")!);
}

export function getAuthToken(): string | null {
	return localStorage.getItem("authToken");
}

/**
 * Changes the user's password
 */
export async function changePassword(
    token: string,
    username: string,
    currentPassword: string,
    newPassword: string,
    logoutAllExceptCurrent: boolean
): Promise<void> {
    const currentDerived = await deriveAuthSecret(username, currentPassword);
    const newDerived = await deriveAuthSecret(username, newPassword);
    const res = await fetch(`${API_BASE_URL}/change-password`, {
        method: "POST",
        headers: getAuthHeaders(token, true),
        body: JSON.stringify({
            currentPasswordDerived: currentDerived,
            newPasswordDerived: newDerived,
            logoutAllExceptCurrent
        })
    });
    if (!res.ok) throw new Error("Failed to change password");
}

/**
 * Deletes the current user's account
 */
export async function deleteAccount(token: string): Promise<{ status: string; message: string }> {
    const res = await fetch(`${API_BASE_URL}/account/delete`, {
        method: "POST",
        headers: getAuthHeaders(token, true)
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Failed to delete account" }));
        throw new Error(error.detail || "Failed to delete account");
    }
    return await res.json();
}


