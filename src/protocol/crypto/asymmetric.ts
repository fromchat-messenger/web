import nacl from "tweetnacl";
import { hkdfExtractAndExpand } from "./kdf";

export interface X25519KeyPair {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}

export function generateX25519KeyPair(): X25519KeyPair {
	const kp = nacl.box.keyPair();
	return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

export function ecdhSharedSecret(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
	return nacl.box.before(theirPublicKey, myPrivateKey);
}

export async function deriveWrappingKey(sharedSecret: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
	return hkdfExtractAndExpand(sharedSecret.buffer as ArrayBuffer, salt, info, 32);
}

