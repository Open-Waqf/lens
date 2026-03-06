export function bytesToBase64(bytes: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
        // Fix 1: Cast to 'any' or 'BlobPart[]' to satisfy strict buffer types
        const blob = new Blob([bytes] as BlobPart[]);

        const reader = new FileReader();
        reader.onload = () => {
            const res = reader.result as string;
            const comma = res.indexOf(',');
            resolve(comma > -1 ? res.substring(comma + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function base64ToBytes(base64: string): Promise<Uint8Array> {
    const res = await fetch(`data:application/octet-stream;base64,${base64}`);
    const blob = await res.blob();
    return new Uint8Array(await blob.arrayBuffer());
}

export function toArrayBuffer(buffer: BlobPart | Uint8Array): ArrayBuffer {
    if (buffer instanceof Uint8Array) {
        // Fix 2: Cast the return type explicitly to ArrayBuffer
        return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
    }
    return buffer as ArrayBuffer;
}

export function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
    return new Blob([toArrayBuffer(bytes)], {type: mime});
}
