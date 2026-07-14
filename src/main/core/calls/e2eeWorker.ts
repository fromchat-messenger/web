/**
 * E2EE Worker for WebRTC Insertable Streams
 * Encrypts/decrypts encoded audio and video frames using AES-GCM
 * Uses RTP timestamps for IVs to handle out-of-order and dropped frames
 */

export interface FrameMetadata {
    contributingSources?: number[];
    mimeType?: string;
    payloadType?: number;
    rtpTimestamp: number;
    synchronizationSource: number;
    dependencies?: number[];
    frameId?: number;
    spatialIndex?: number;
    temporalIndex?: number;
}

export interface EncodedFrame {
    data: Uint8Array | ArrayBuffer;
    timestamp?: number;
    type?: string;
    getMetadata?: () => FrameMetadata;
}

export interface WorkerOptions {
    key: CryptoKey;
    mode: 'encrypt' | 'decrypt';
    sessionId?: string;
}

/**
 * Extract sequence number from encoded frame
 * For RTCEncodedVideoFrame/AudioFrame, we use the frame's metadata if available,
 * otherwise fall back to extracting from RTP header
 */
function makeIV(encodedFrame: EncodedFrame): ArrayBuffer {
    // Create IV using ONLY RTP metadata - this ensures sender and receiver use identical IVs
    // Frame data can differ between sender/receiver due to encoding differences
    const ivBuffer = new ArrayBuffer(12);
    const view = new DataView(ivBuffer);

    if (encodedFrame.getMetadata) {
        try {
            const metadata = encodedFrame.getMetadata();
            if (metadata && typeof metadata.rtpTimestamp === 'number') {
                // Use ONLY RTP timestamp + sync source - these are identical on both sides
                view.setUint32(0, metadata.rtpTimestamp, false); // First 4 bytes
                view.setUint32(4, metadata.synchronizationSource || 0, false); // Middle 4 bytes
                view.setUint32(8, 0, false); // Last 4 bytes (padding for 12-byte IV)

                return ivBuffer;
            }
        } catch (e) {
            console.error("Failed to get metadata:", e);
        }
    }

    // Fallback: use timestamp only (no random to avoid desync)
    view.setUint32(0, Date.now() & 0xFFFFFFFF, false);
    view.setUint32(4, 0, false);
    view.setUint32(8, 0, false);
    return ivBuffer;
}

addEventListener("rtctransform", (event) => {
    const { transformer } = event;
    const { readable, writable } = transformer;
    const { key, mode } = transformer.options as WorkerOptions;

    const isEncrypting = mode === 'encrypt';

    let frameCount = 0;

    async function transform(encodedFrame: EncodedFrame, controller: TransformStreamDefaultController<EncodedFrame>) {
        try {
            const data = new Uint8Array(encodedFrame.data);

            // Increment frame counter
            frameCount++;

            // Create IV using RTP timestamp from metadata (synchronized between peers)
            const iv = makeIV(encodedFrame);

            // Ensure IV is properly typed
            const ivArray = new Uint8Array(iv);
            const params: AesGcmParams = { name: 'AES-GCM', iv: ivArray };

            // COMPROMISE: Encrypt most of the frame while preserving minimal codec compatibility
            // This prevents most visual leakage while maintaining decodability
            let headerSize = 0;
            let payloadData: Uint8Array;

            if (data.length > 20) {
                // For video frames, preserve first 8 bytes for better codec compatibility
                // This includes frame type, keyframe info, and basic header structure
                headerSize = Math.min(8, Math.floor(data.length / 10));
                payloadData = data.slice(headerSize);
            } else {
                // For small frames (likely audio), encrypt everything
                payloadData = data;
            }

            // Encrypt the payload data
            const payloadBuffer = new ArrayBuffer(payloadData.byteLength);
            new Uint8Array(payloadBuffer).set(payloadData);

            let encryptedPayload: ArrayBuffer;
            if (isEncrypting) {
                encryptedPayload = await crypto.subtle.encrypt(params, key, payloadBuffer);
            } else {
                try {
                    encryptedPayload = await crypto.subtle.decrypt(params, key, payloadBuffer);
                } catch (error) {
                    console.error(`E2EE ${mode} FAILED - dropping frame #${frameCount}, size: ${data.length}`, error);
                    return; // Drop the frame
                }
            }

            // Reconstruct frame: minimal headers + encrypted payload
            const encryptedArray = new Uint8Array(encryptedPayload);
            const result = new Uint8Array(headerSize + encryptedArray.length);

            if (headerSize > 0) {
                result.set(data.slice(0, headerSize), 0); // Copy minimal headers
                result.set(encryptedArray, headerSize); // Add encrypted payload
            } else {
                result.set(encryptedArray, 0);
            }

            // CRITICAL: Video frames need ArrayBuffer, not Uint8Array
            encodedFrame.data = result.buffer;
            controller.enqueue(encodedFrame);
        } catch (e) {
            // FAIL SECURELY: Never send unencrypted frames
            const data = new Uint8Array(encodedFrame.data);
            console.error(`E2EE ${mode} FAILED - dropping frame #${frameCount}, size: ${data.length}`, e);
            return; // Drop the frame completely
        }
    }

    readable
        .pipeThrough(new TransformStream({ transform }))
        .pipeTo(writable);
});
