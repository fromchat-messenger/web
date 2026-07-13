/** Java [String.hashCode] for cross-platform parity with Android avatar gradients. */
function javaStringHashCode(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
    }
    return hash;
}

function rgbFromHash(hash: number, offset: number): string {
    const r = Math.abs(hash % 256);
    const g = Math.abs(Math.floor(hash / 256) % 256);
    const b = Math.abs(Math.floor(hash / 65536) % 256);
    const clamp = (channel: number) => Math.min(255, Math.max(0, channel));
    return `rgb(${clamp(r + offset)}, ${clamp(g + offset)}, ${clamp(b + offset)})`;
}

/** CSS linear-gradient matching [generateGradientFromName] on Android for a user id seed. */
export function avatarGradientFromUserId(userId: number): string {
    const hash = javaStringHashCode(String(userId));
    return `linear-gradient(135deg, ${rgbFromHash(hash, 100)}, ${rgbFromHash(hash, 50)})`;
}
