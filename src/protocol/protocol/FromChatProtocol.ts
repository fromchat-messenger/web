import { ecdhSharedSecret, deriveWrappingKey } from "../crypto/asymmetric";
import { importAesGcmKey, aesGcmEncrypt, aesGcmDecrypt } from "../crypto/symmetric";
import { randomBytes } from "../crypto/kdf";
import type { EncryptedMessage } from "./types";

/**
 * FromChat Protocol - Simple ECDH-based encryption
 * 
 * Protocol:
 * 1. Generate random message key (mk) - 32 bytes
 * 2. Generate random salt (wkSalt) - 16 bytes
 * 3. Derive shared secret from ECDH (X25519)
 * 4. Derive wrapping key from shared secret using HKDF with salt
 * 5. Encrypt message with mk using AES-GCM
 * 6. Encrypt (wrap) mk with wrapping key using AES-GCM
 * 7. Send: { iv, ciphertext, salt, iv2, wrappedMk }
 */
export class FromChatProtocol {
	private privateKey: Uint8Array;

	constructor(privateKey: Uint8Array) {
		this.privateKey = privateKey;
	}

	/**
	 * Encrypt a message for a recipient
	 * @param recipientPublicKey - Recipient's X25519 public key
	 * @param plaintext - Message to encrypt
	 * @returns Encrypted message with all necessary fields
	 */
	async encryptMessage(recipientPublicKey: Uint8Array, plaintext: string): Promise<EncryptedMessage> {
		// Generate random message key
		const mk = randomBytes(32);
		
		// Generate random salt for wrapping key derivation
		const wkSalt = randomBytes(16);
		
		// Derive shared secret from ECDH
		const shared = ecdhSharedSecret(this.privateKey, recipientPublicKey);
		
		// Derive wrapping key from shared secret using HKDF
		const wkRaw = await deriveWrappingKey(shared, wkSalt, new Uint8Array([1]));
		const wk = await importAesGcmKey(wkRaw);
		
		// Encrypt the message with message key
		const plaintextBytes = new TextEncoder().encode(plaintext);
		const encMsg = await aesGcmEncrypt(await importAesGcmKey(mk), plaintextBytes);
		
		// Encrypt (wrap) the message key with wrapping key
		const wrap = await aesGcmEncrypt(wk, mk);
		
		// Convert to base64 for transmission
		return {
			iv: btoa(String.fromCharCode(...encMsg.iv)),
			ciphertext: btoa(String.fromCharCode(...encMsg.ciphertext)),
			salt: btoa(String.fromCharCode(...wkSalt)),
			iv2: btoa(String.fromCharCode(...wrap.iv)),
			wrappedMk: btoa(String.fromCharCode(...wrap.ciphertext))
		};
	}

	/**
	 * Decrypt a message from a sender
	 * @param senderPublicKey - Sender's X25519 public key
	 * @param message - Encrypted message
	 * @returns Decrypted plaintext
	 */
	async decryptMessage(senderPublicKey: Uint8Array, message: EncryptedMessage): Promise<string> {
		// Decode base64 fields
		const salt = new Uint8Array(
			atob(message.salt).split("").map(c => c.charCodeAt(0))
		);
		const iv2 = new Uint8Array(
			atob(message.iv2).split("").map(c => c.charCodeAt(0))
		);
		const wrappedMk = new Uint8Array(
			atob(message.wrappedMk).split("").map(c => c.charCodeAt(0))
		);
		const iv = new Uint8Array(
			atob(message.iv).split("").map(c => c.charCodeAt(0))
		);
		const ciphertext = new Uint8Array(
			atob(message.ciphertext).split("").map(c => c.charCodeAt(0))
		);
		
		// Derive shared secret from ECDH
		const shared = ecdhSharedSecret(this.privateKey, senderPublicKey);
		
		// Derive wrapping key from shared secret using salt from message
		const wkRaw = await deriveWrappingKey(shared, salt, new Uint8Array([1]));
		const wk = await importAesGcmKey(wkRaw);
		
		// Decrypt (unwrap) the message key
		const mk = await aesGcmDecrypt(wk, iv2, wrappedMk);
		
		// Decrypt the message with message key
		const decrypted = await aesGcmDecrypt(await importAesGcmKey(mk), iv, ciphertext);
		
		return new TextDecoder().decode(decrypted);
	}
}

