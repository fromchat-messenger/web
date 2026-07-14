import { aesGcmDecrypt, aesGcmEncrypt, importPassword, deriveKEK, randomBytes } from "../crypto/index";

export interface PrivateKeyBundle {
	version: 1;
	privateKey: Uint8Array; // X25519 private key
}

export interface EncryptedBackupBlob {
	salt: Uint8Array; // for PBKDF2 derivation of KEK
	iv: Uint8Array; // AES-GCM IV
	ciphertext: Uint8Array; // encrypted serialized PrivateKeyBundle
}

export function serializeBundle(bundle: PrivateKeyBundle): Uint8Array {
	const header = new Uint8Array([bundle.version]);
	const len = new Uint8Array(new Uint32Array([bundle.privateKey.length]).buffer);
	const out = new Uint8Array(1 + 4 + bundle.privateKey.length);
	out.set(header, 0);
	out.set(len, 1);
	out.set(bundle.privateKey, 5);
	return out;
}

export function deserializeBundle(data: Uint8Array): PrivateKeyBundle {
	const version = data[0] as 1;
	const len = new Uint32Array(data.slice(1, 5).buffer)[0];
	const pk = data.slice(5, 5 + len);
	return { version, privateKey: pk };
}

export async function encryptBackupWithPassword(password: string, bundle: PrivateKeyBundle): Promise<EncryptedBackupBlob> {
	const salt = randomBytes(16);
	const pw = await importPassword(password);
	const kek = await deriveKEK(pw, salt);
	const serialized = serializeBundle(bundle);
	const { iv, ciphertext } = await aesGcmEncrypt(kek, serialized);
	return { salt, iv, ciphertext };
}

export async function decryptBackupWithPassword(password: string, blob: EncryptedBackupBlob): Promise<PrivateKeyBundle> {
	const pw = await importPassword(password);
	const kek = await deriveKEK(pw, blob.salt);
	const plaintext = await aesGcmDecrypt(kek, blob.iv, blob.ciphertext);
	return deserializeBundle(plaintext);
}

export function encodeBlob(blob: EncryptedBackupBlob): string {
	function b64(a: Uint8Array) { return btoa(String.fromCharCode(...a)); }
	return JSON.stringify({
		salt: b64(blob.salt),
		iv: b64(blob.iv),
		ciphertext: b64(blob.ciphertext)
	});
}

export function decodeBlob(json: string): EncryptedBackupBlob {
	function ub64(s: string) {
		const bin = atob(s);
		const arr = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
		return arr;
	}
	const obj = JSON.parse(json);
	return { salt: ub64(obj.salt), iv: ub64(obj.iv), ciphertext: ub64(obj.ciphertext) };
}

