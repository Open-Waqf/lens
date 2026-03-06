export function detectImageMime(bytes: Uint8Array): 'image/jpeg' | 'image/webp' {
    if (bytes.length >= 12) {
        const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // RIFF
        const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // WEBP
        if (riff && webp) return 'image/webp';
    }
    return 'image/jpeg';
}
