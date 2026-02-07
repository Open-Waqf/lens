export async function blobToU8(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
}

export function u8ToBlob(bytes: Uint8Array, mime: string): Blob {
    return new Blob([toArrayBuffer(bytes)], {type: mime});
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
    const url = URL.createObjectURL(u8ToBlob(bytes, mime));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

export function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
    return new Blob([toArrayBuffer(bytes)], {type: mime});
}