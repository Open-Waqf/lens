const MAGIC = new Uint8Array([0x53, 0x4c, 0x42, 0x4b]); // "SLBK"
const VERSION_V1 = 1;
const VERSION_V2 = 2; // Chunked Streaming Format
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const PBKDF2_ITERATIONS = 100000;

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

// --- Public API ---

export async function encryptBytesWithPassword(
    plain: Uint8Array,
    password: string,
    params: PbeParams = {}
): Promise<Uint8Array> {
    // 1. Setup V2 Header
    const iterations = params.iterations ?? 210_000;
    const salt = crypto.getRandomValues(new Uint8Array(params.saltLen ?? 16));
    const key = await deriveAesKey(password, salt, iterations);

    // Calculate strict output size for V2 to avoid re-allocations
    // Header: Magic(4) + Ver(1) + Iter(4) + SaltLen(1) + Salt(...)
    // Chunk: Len(4) + IV(12) + Cipher(...) + Tag(16 implicitly in cipher)
    // We need to calculate how many chunks.
    const chunkCount = Math.ceil(plain.length / CHUNK_SIZE);
    const overheadPerChunk = 4 + 12; // Len + IV (Tag is inside cipher length usually +16)
    const tagLen = 16;

    // Header size
    const headerSize = 4 + 1 + 4 + 1 + salt.length;

    // Total Size = Header + (OriginalSize + (ChunkCount * (Overhead + Tag)))
    const totalSize = headerSize + plain.length + (chunkCount * (overheadPerChunk + tagLen));

    const out = new Uint8Array(totalSize);
    let offset = 0;

    // Write Header
    out.set(MAGIC, offset);
    offset += 4;
    out[offset++] = VERSION_V2;
    writeU32LE(out, offset, iterations);
    offset += 4;
    out[offset++] = salt.length;
    out.set(salt, offset);
    offset += salt.length;

    // Encrypt Chunks
    for (let i = 0; i < plain.length; i += CHUNK_SIZE) {
        const end = Math.min(i + CHUNK_SIZE, plain.length);
        const chunkPlain = plain.subarray(i, end);

        // Unique IV per chunk is critical for streaming security
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const cipherBuf = await crypto.subtle.encrypt(
            {name: 'AES-GCM', iv: toArrayBuffer(iv)},
            key,
            toArrayBuffer(chunkPlain)
        );
        const cipherChunk = new Uint8Array(cipherBuf);

        // Write Chunk: [Len 4][IV 12][Cipher N]
        writeU32LE(out, offset, cipherChunk.length);
        offset += 4;
        out.set(iv, offset);
        offset += 12;
        out.set(cipherChunk, offset);
        offset += cipherChunk.length;
    }

    return out;
}

export async function decryptBytesWithPassword(enc: Uint8Array, password: string): Promise<Uint8Array> {
    if (!isEncryptedBackup(enc)) throw new Error('Not an encrypted backup file.');
    if (!password) throw new Error('Password required.');

    let offset = 4; // Skip Magic
    const ver = enc[offset++];

    if (ver === VERSION_V1) {
        return decryptV1(enc, password, offset);
    } else if (ver === VERSION_V2) {
        return decryptV2(enc, password, offset);
    }

    throw new Error(`Unsupported backup version: ${ver}`);
}

// --- V1 Legacy Support ---

async function decryptV1(enc: Uint8Array, password: string, offset: number): Promise<Uint8Array> {
    // V1: [Iter 4][SaltLen 1][IvLen 1][Salt...][IV...][Cipher...]
    const iterations = readU32LE(enc, offset);
    offset += 4;
    const saltLen = enc[offset++];
    const ivLen = enc[offset++];

    const salt = enc.slice(offset, offset + saltLen);
    offset += saltLen;
    const iv = enc.slice(offset, offset + ivLen);
    offset += ivLen;
    const cipher = enc.subarray(offset);

    const key = await deriveAesKey(password, salt, iterations);

    try {
        const plainBuf = await crypto.subtle.decrypt(
            {name: 'AES-GCM', iv: toArrayBuffer(iv)},
            key,
            toArrayBuffer(cipher)
        );
        return new Uint8Array(plainBuf);
    } catch {
        throw new Error('Wrong password or corrupted backup.');
    }
}

// --- V2 Streaming Support ---

async function decryptV2(enc: Uint8Array, password: string, offset: number): Promise<Uint8Array> {
    // V2: [Iter 4][SaltLen 1][Salt...] ...Chunks...
    const iterations = readU32LE(enc, offset);
    offset += 4;
    const saltLen = enc[offset++];
    const salt = enc.slice(offset, offset + saltLen);
    offset += saltLen;

    const key = await deriveAesKey(password, salt, iterations);

    // Pass 1: Calculate total plaintext size to allocate once
    let scanPos = offset;
    let totalPlainLen = 0;
    while (scanPos < enc.length) {
        if (scanPos + 4 > enc.length) break;
        const cipherLen = readU32LE(enc, scanPos);
        scanPos += 4;
        scanPos += 12; // IV
        scanPos += cipherLen;
        // AES-GCM tag is usually 16 bytes appended to ciphertext.
        // Plaintext size = Ciphertext size - 16
        if (cipherLen > 16) totalPlainLen += (cipherLen - 16);
    }

    const out = new Uint8Array(totalPlainLen);
    let outPos = 0;

    // Pass 2: Decrypt chunks
    while (offset < enc.length) {
        if (offset + 4 > enc.length) break;
        const cipherLen = readU32LE(enc, offset);
        offset += 4;

        const iv = enc.subarray(offset, offset + 12);
        offset += 12;
        const cipherChunk = enc.subarray(offset, offset + cipherLen);
        offset += cipherLen;

        try {
            const plainChunkBuf = await crypto.subtle.decrypt(
                {name: 'AES-GCM', iv: toArrayBuffer(iv)},
                key,
                toArrayBuffer(cipherChunk)
            );
            const plainChunk = new Uint8Array(plainChunkBuf);
            out.set(plainChunk, outPos);
            outPos += plainChunk.length;
        } catch {
            throw new Error('Wrong password or corrupted backup chunk.');
        }
    }

    return out;
}

// --- Helpers ---

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const pwRaw = toArrayBuffer(enc.encode(password));
    const pwKey = await crypto.subtle.importKey('raw', pwRaw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
        {name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations},
        pwKey,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt']
    );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    // Avoid SharedArrayBuffer issues
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return <ArrayBuffer>bytes.buffer;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function writeU32LE(buf: Uint8Array, offset: number, v: number): void {
    buf[offset] = v & 0xff;
    buf[offset + 1] = (v >>> 8) & 0xff;
    buf[offset + 2] = (v >>> 16) & 0xff;
    buf[offset + 3] = (v >>> 24) & 0xff;
}

function readU32LE(buf: Uint8Array, offset: number): number {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

/**
 * Encrypts a stream of data chunks on the fly.
 * Yields encrypted blocks including the V2 Header and Chunk Metadata.
 */
export async function* encryptStream(
    source: AsyncGenerator<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 210_000;
    const key = await deriveAesKey(password, salt, iterations);

    // 1. Yield Header
    const headerLen = 4 + 1 + 4 + 1 + salt.length;
    const header = new Uint8Array(headerLen);
    let off = 0;
    header.set(MAGIC, off);
    off += 4;
    header[off++] = VERSION_V2;
    writeU32LE(header, off, iterations);
    off += 4;
    header[off++] = salt.length;
    header.set(salt, off);
    yield header;

    // 2. Encrypt Source Chunks
    for await (const plainChunk of source) {
        // Encrypt this chunk
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipherBuf = await crypto.subtle.encrypt(
            {name: 'AES-GCM', iv: toArrayBuffer(iv)},
            key,
            toArrayBuffer(plainChunk)
        );
        const cipherChunk = new Uint8Array(cipherBuf);

        // Prepare Output Frame: [Len 4][IV 12][Cipher N]
        const frameLen = 4 + 12 + cipherChunk.length;
        const frame = new Uint8Array(frameLen);

        let p = 0;
        writeU32LE(frame, p, cipherChunk.length);
        p += 4;
        frame.set(iv, p);
        p += 12;
        frame.set(cipherChunk, p);

        yield frame;
    }
}

/**
 * A robust buffering reader for ReadableStreams.
 * Handles partial reads, over-reads, and buffering automatically.
 */
class ChunkReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer: Uint8Array = new Uint8Array(0);
    private done = false;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
    }

    /**
     * Reads exactly `count` bytes.
     * If the stream ends before `count` bytes are available, throws an error.
     */
    async readExactly(count: number): Promise<Uint8Array> {
        while (this.buffer.length < count) {
            if (this.done) {
                throw new Error(`Unexpected EOF: Wanted ${count} bytes, but stream ended with only ${this.buffer.length}`);
            }

            const {done, value} = await this.reader.read();

            if (done) {
                this.done = true;
                continue; // Loop once more to trigger the EOF error above
            }

            // Append new data to internal buffer
            const newBuf = new Uint8Array(this.buffer.length + value.length);
            newBuf.set(this.buffer);
            newBuf.set(value, this.buffer.length);
            this.buffer = newBuf;
        }

        const result = this.buffer.slice(0, count);
        this.buffer = this.buffer.slice(count); // Shift buffer
        return result;
    }

    async readUint32(): Promise<number> {
        const bytes = await this.readExactly(4);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getUint32(0, true); // Little Endian
    }

    release() {
        this.reader.releaseLock();
    }
}

/**
 * Streaming Decryption.
 * Reads the file chunk-by-chunk to avoid loading 100MB+ into RAM.
 */
export async function* decryptStream(
    stream: ReadableStream<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    const reader = new ChunkReader(stream);

    try {
        // 1. Read Header: Salt (16) + IV (12)
        const SALT_SIZE = 16;
        const IV_SIZE = 12;

        const salt = await reader.readExactly(SALT_SIZE);
        const iv = await reader.readExactly(IV_SIZE);

        // 2. Derive Key (Uses your existing helper)
        const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);

        // 3. Process Chunks Loop
        while (true) {
            let chunkLen: number;

            try {
                // Try to read the next chunk length header
                chunkLen = await reader.readUint32();
            } catch (e) {
                // EOF on length read is a clean exit (end of file)
                break;
            }

            // SECURITY: DoS Protection
            if (chunkLen > 100 * 1024 * 1024) {
                throw new Error("Corrupt backup: Chunk size > 100MB");
            }
            if (chunkLen === 0) continue;

            // Read Encrypted Payload
            const encryptedChunk = await reader.readExactly(chunkLen);

            // Decrypt using Web Crypto
            // Note: In AES-GCM, the auth tag is appended to the ciphertext.
            const plain = await crypto.subtle.decrypt(
                {name: 'AES-GCM', iv: toArrayBuffer(iv)},
                key,
                toArrayBuffer(encryptedChunk)
            );

            yield new Uint8Array(plain);
        }

    } finally {
        reader.release();
    }
}