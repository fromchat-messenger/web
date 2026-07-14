export interface AesGcmCiphertext {
	iv: Uint8Array;
	ciphertext: Uint8Array;
}

export async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array | ArrayBuffer): Promise<AesGcmCiphertext> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintextBuffer = plaintext instanceof Uint8Array ? plaintext.buffer as ArrayBuffer : plaintext;
	const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintextBuffer);
	return { iv, ciphertext: new Uint8Array(ct) };
}

export async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array | ArrayBuffer, ciphertext: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
	const ivBuf: ArrayBuffer = iv instanceof Uint8Array
		? (iv.buffer as ArrayBuffer).slice(iv.byteOffset, iv.byteOffset + iv.byteLength)
		: (iv as ArrayBuffer);

	const ctBuf: ArrayBuffer = ciphertext instanceof Uint8Array
		? (ciphertext.buffer as ArrayBuffer).slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength)
		: (ciphertext as ArrayBuffer);

	const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, ctBuf);
	return new Uint8Array(pt as ArrayBuffer);
}

export async function importAesGcmKey(rawKey: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
	const keyBuffer = rawKey instanceof Uint8Array
		? (rawKey.buffer as ArrayBuffer).slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength)
		: (rawKey as ArrayBuffer);
	return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
