export { FromChatProtocol } from "./protocol/FromChatProtocol";
export type { EncryptedMessage } from "./protocol/types";

// Export crypto functions
export { generateX25519KeyPair, ecdhSharedSecret, deriveWrappingKey } from "./crypto/asymmetric";
export type { X25519KeyPair } from "./crypto/asymmetric";
export { importAesGcmKey, aesGcmEncrypt, aesGcmDecrypt } from "./crypto/symmetric";
export type { AesGcmCiphertext } from "./crypto/symmetric";
export { hkdfExtractAndExpand, randomBytes, importPassword, deriveKEK } from "./crypto/kdf";

// Export backup functions
export {
	encryptBackupWithPassword,
	decryptBackupWithPassword,
	encodeBlob,
	decodeBlob,
	serializeBundle,
	deserializeBundle
} from "./backup/backup";
export type { PrivateKeyBundle, EncryptedBackupBlob } from "./backup/backup";
