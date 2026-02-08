// src/lib/crypto/pbe.ts

const MAGIC = new Uint8Array([0x53, 0x4c, 0x42, 0x4b]); // "SLBK"
const VERSION = 1;

export type PbeParams = {
    iterations?: number;
    saltLen?: number;
    ivLen?: number;
};

export function isEncryptedBackup(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 4 &&
        bytes[0] === MAGIC[0] &&
        bytes[1] === MAGIC[1] &&
        bytes[2] === MAGIC[2] &&
        bytes[3] === MAGIC[3]
    );
}

export async function encryptBytesWithPassword(
    plain: Uint8Array,
    password: string,
    params: PbeParams = {},
): Promise<Uint8Array> {
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

    const iterations = params.iterations ?? 210_000;
    const saltLen = params.saltLen ?? 16;
    const ivLen = params.ivLen ?? 12;

    const salt = crypto.getRandomValues(new Uint8Array(saltLen));
    const iv = crypto.getRandomValues(new Uint8Array(ivLen));
    const key = await deriveAesKey(password, salt, iterations);

    const cipherBuf = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv: toArrayBuffer(iv)},
        key,
        toArrayBuffer(plain),
    );
    const cipher = new Uint8Array(cipherBuf);

    const headerLen = 4 + 1 + 4 + 1 + 1 + saltLen + ivLen;
    const out = new Uint8Array(headerLen + cipher.length);
    let o = 0;

    out.set(MAGIC, o);
    o += 4;
    out[o++] = VERSION;

    writeU32LE(out, o, iterations);
    o += 4;
    out[o++] = saltLen;
    out[o++] = ivLen;

    out.set(salt, o);
    o += saltLen;
    out.set(iv, o);
    o += ivLen;

    out.set(cipher, o);

    return out;
}

export async function decryptBytesWithPassword(enc: Uint8Array, password: string): Promise<Uint8Array> {
    if (!isEncryptedBackup(enc)) throw new Error('Not an encrypted backup file.');
    if (!password) throw new Error('Password required.');

    let o = 0;
    o += 4; // magic
    const ver = enc[o++];
    if (ver !== VERSION) throw new Error(`Unsupported backup version: ${ver}`);

    const iterations = readU32LE(enc, o);
    o += 4;
    const saltLen = enc[o++];
    const ivLen = enc[o++];

    const minLen = 4 + 1 + 4 + 1 + 1 + saltLen + ivLen + 16;
    if (enc.length < minLen) throw new Error('Corrupt encrypted backup.');

    const salt = enc.slice(o, o + saltLen);
    o += saltLen;
    const iv = enc.slice(o, o + ivLen);
    o += ivLen;
    const cipher = enc.slice(o);

    const key = await deriveAesKey(password, salt, iterations);

    let plainBuf: ArrayBuffer;
    try {
        plainBuf = await crypto.subtle.decrypt(
            {name: 'AES-GCM', iv: toArrayBuffer(iv)},
            key,
            toArrayBuffer(cipher),
        );
    } catch {
        throw new Error('Wrong password or corrupted backup.');
    }

    return new Uint8Array(plainBuf);
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const pwRaw = toArrayBuffer(enc.encode(password));

    const pwKey = await crypto.subtle.importKey('raw', pwRaw, 'PBKDF2', false, ['deriveKey']);

    return await crypto.subtle.deriveKey(
        {name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations},
        pwKey,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt'],
    );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    // ensures ArrayBuffer (not SharedArrayBuffer/ArrayBufferLike) for strict TS DOM types
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function writeU32LE(buf: Uint8Array, offset: number, v: number): void {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(offset, v >>> 0, true);
}

function readU32LE(buf: Uint8Array, offset: number): number {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return dv.getUint32(offset, true);
}