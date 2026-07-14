/**
 * Encrypted message format
 */
export interface EncryptedMessage {
	iv: string; // Base64 encoded IV for message encryption
	ciphertext: string; // Base64 encoded encrypted message
	salt: string; // Base64 encoded salt for wrapping key derivation
	iv2: string; // Base64 encoded IV for message key wrapping
	wrappedMk: string; // Base64 encoded wrapped message key
}
