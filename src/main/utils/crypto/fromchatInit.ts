import { FromChatProtocol } from "@fromchat/protocol";
import { getCurrentKeys } from "@/core/api/user/auth";

let protocolInstance: FromChatProtocol | null = null;

export function getFromChatProtocol(): FromChatProtocol | null {
	return protocolInstance;
}

export function initializeFromChatProtocol(privateKey: Uint8Array): FromChatProtocol {
	protocolInstance = new FromChatProtocol(privateKey);
	return protocolInstance;
}

export function getOrInitProtocol(): FromChatProtocol {
	if (protocolInstance) {
		return protocolInstance;
	}
	
	const keys = getCurrentKeys();
	if (!keys) {
		throw new Error("Keys not initialized");
	}
	
	return initializeFromChatProtocol(keys.privateKey);
}
