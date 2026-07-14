export async function hkdfExtractAndExpand(inputKeyMaterial: Uint8Array | ArrayBuffer, salt: Uint8Array | ArrayBuffer, info: Uint8Array | ArrayBuffer, length = 32): Promise<Uint8Array> {
	const inputBuffer = inputKeyMaterial instanceof Uint8Array ? inputKeyMaterial.buffer as ArrayBuffer : inputKeyMaterial;
	const saltBuffer = salt instanceof Uint8Array ? salt.buffer as ArrayBuffer : salt;
	const infoBuffer = info instanceof Uint8Array ? info.buffer as ArrayBuffer : info;

	const ikmKey = await crypto.subtle.importKey("raw", inputBuffer, { name: "HKDF" }, false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltBuffer, info: infoBuffer }, ikmKey, length * 8);
	return new Uint8Array(bits);
}

export function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length);
	crypto.getRandomValues(out);
	return out;
}

export async function importPassword(password: string): Promise<CryptoKey> {
	const enc = new TextEncoder();
	return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey", "deriveBits"]);
}

export async function deriveKEK(passwordKey: CryptoKey, salt: Uint8Array | ArrayBuffer, iterations = 210_000): Promise<CryptoKey> {
	const saltBuffer = salt instanceof Uint8Array ? salt.buffer as ArrayBuffer : salt;
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt: saltBuffer, iterations, hash: "SHA-256" },
		passwordKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}
