const PBKDF2_ITERATIONS_DEFAULT = 600000;
const PBKDF2_ITERATIONS_MIN = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;
const TAG_LENGTH_BITS = 128;
const HEADER_MAGIC = 'SLBK';
const HEADER_MAGIC_BYTES = new Uint8Array([83, 76, 66, 75]);
const CURRENT_VERSION = 3;
const LEGACY_VERSION_V2 = 2;
const KDF_PBKDF2_SHA256 = 0x01;
const MAX_FRAME_SIZE = 100 * 1024 * 1024;
const MAX_META_SIZE = 4 * 1024 * 1024;

const HEADER_FIXED_SIZE = 4 + 2 + 1 + 4 + 1 + SALT_SIZE + 1 + IV_SIZE + 8;
export const ERR_INCORRECT_PASSWORD = 'Incorrect password.';
export const ERR_CORRUPTED_VAULT = 'Vault file is corrupted or incomplete.';

export type EncryptOptions = {
    iterations?: number;
    docCount?: number;
    meta?: Record<string, unknown>;
};

export type SlbkHeaderInfo = {
    magic: string;
    version: number;
    kdf: number;
    iterations: number;
    saltHex: string;
    ivHex: string;
    metaLen: number;
    docCount: number;
};

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as unknown as BufferSource,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt']
    );
}

function toSafeIterations(input?: number): number {
    if (!input || !Number.isFinite(input)) return PBKDF2_ITERATIONS_DEFAULT;
    return Math.max(PBKDF2_ITERATIONS_MIN, Math.floor(input));
}

function writeUint64BE(view: DataView, offset: number, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid uint64 value');
    }
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    view.setUint32(offset, hi, false);
    view.setUint32(offset + 4, lo, false);
}

function readUint64BE(view: DataView, offset: number): number {
    const hi = view.getUint32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    const value = hi * 0x100000000 + lo;
    if (!Number.isSafeInteger(value)) {
        throw new Error('Unsupported file size');
    }
    return value;
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function createHeaderBytes(iterations: number, salt: Uint8Array, iv: Uint8Array, metaLen: number): Uint8Array {
    const header = new Uint8Array(HEADER_FIXED_SIZE);
    const view = new DataView(header.buffer);

    header.set(HEADER_MAGIC_BYTES, 0);
    view.setUint16(4, CURRENT_VERSION, false);
    view.setUint8(6, KDF_PBKDF2_SHA256);
    view.setUint32(7, iterations, false);
    view.setUint8(11, SALT_SIZE);
    header.set(salt, 12);
    view.setUint8(12 + SALT_SIZE, IV_SIZE);
    header.set(iv, 13 + SALT_SIZE);
    writeUint64BE(view, 13 + SALT_SIZE + IV_SIZE, metaLen);

    return header;
}

async function* getStreamIterator(
    stream: AsyncGenerator<Uint8Array> | ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array> {
    if (stream instanceof ReadableStream) {
        const reader = stream.getReader();
        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) return;
                yield value;
            }
        } finally {
            reader.releaseLock();
        }
    } else {
        for await (const chunk of stream) {
            yield chunk;
        }
    }
}

export async function* encryptStream(
    stream: AsyncGenerator<Uint8Array> | ReadableStream<Uint8Array>,
    password: string,
    options: EncryptOptions = {}
): AsyncGenerator<Uint8Array> {
    const iterations = toSafeIterations(options.iterations);
    const docCount = Math.max(0, Math.floor(options.docCount ?? 0));

    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const headerIv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const metaPayload = {
        exportedAt: Date.now(),
        format: 'zip-stream-v1',
        ...options.meta,
    };
    const metaPlain = new TextEncoder().encode(JSON.stringify(metaPayload));

    const key = await deriveAesKey(password, salt, iterations);
    const metaCipherBuf = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: headerIv as unknown as BufferSource,
            tagLength: TAG_LENGTH_BITS,
        },
        key,
        metaPlain as unknown as BufferSource,
    );
    const metaCipher = new Uint8Array(metaCipherBuf);

    if (metaCipher.byteLength > MAX_META_SIZE) {
        throw new Error('Metadata chunk too large');
    }

    const header = createHeaderBytes(iterations, salt, headerIv, metaCipher.byteLength);
    yield header;
    yield metaCipher;

    const docCountBytes = new Uint8Array(4);
    new DataView(docCountBytes.buffer).setUint32(0, docCount >>> 0, false);
    yield docCountBytes;

    for await (const chunk of getStreamIterator(stream)) {
        const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
        const ciphertextBuffer = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as unknown as BufferSource,
                tagLength: TAG_LENGTH_BITS
            },
            key,
            chunk as unknown as BufferSource
        );
        const ciphertext = new Uint8Array(ciphertextBuffer);

        const lenBytes = new Uint8Array(8);
        writeUint64BE(new DataView(lenBytes.buffer), 0, ciphertext.byteLength);

        yield lenBytes;
        yield iv;
        yield ciphertext;
    }
}

class ChunkReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer: Uint8Array = new Uint8Array(0);
    private done = false;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
    }

    private async fill(count: number): Promise<void> {
        while (this.buffer.length < count && !this.done) {
            const {done, value} = await this.reader.read();
            if (done) {
                this.done = true;
                break;
            }

            const merged = new Uint8Array(this.buffer.length + value.length);
            merged.set(this.buffer, 0);
            merged.set(value, this.buffer.length);
            this.buffer = merged;
        }
    }

    async tryReadExactly(count: number): Promise<Uint8Array | null> {
        await this.fill(count);

        if (this.buffer.length === 0 && this.done) {
            return null;
        }
        if (this.buffer.length < count) {
            throw new Error(`Unexpected EOF: Wanted ${count} bytes, got ${this.buffer.length}`);
        }

        const out = this.buffer.slice(0, count);
        this.buffer = this.buffer.slice(count);
        return out;
    }

    async readExactly(count: number): Promise<Uint8Array> {
        const data = await this.tryReadExactly(count);
        if (!data) throw new Error(`Unexpected EOF: Wanted ${count} bytes, got 0`);
        return data;
    }

    async readUint16BE(): Promise<number> {
        const b = await this.readExactly(2);
        return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(0, false);
    }

    async readUint32BE(): Promise<number> {
        const b = await this.readExactly(4);
        return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, false);
    }

    async readUint32LE(): Promise<number> {
        const b = await this.readExactly(4);
        return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
    }

    async readUint64BEOrEof(): Promise<number | null> {
        const b = await this.tryReadExactly(8);
        if (!b) return null;
        return readUint64BE(new DataView(b.buffer, b.byteOffset, b.byteLength), 0);
    }

    release() {
        this.reader.releaseLock();
    }
}

async function decryptV3(reader: ChunkReader, password: string): Promise<AsyncGenerator<Uint8Array>> {
    const kdf = (await reader.readExactly(1))[0];
    if (kdf !== KDF_PBKDF2_SHA256) {
        throw new Error(ERR_CORRUPTED_VAULT);
    }

    const iterations = await reader.readUint32BE();
    if (iterations < PBKDF2_ITERATIONS_MIN) {
        throw new Error(ERR_CORRUPTED_VAULT);
    }

    const saltLen = (await reader.readExactly(1))[0];
    if (saltLen !== SALT_SIZE) {
        throw new Error(ERR_CORRUPTED_VAULT);
    }
    const salt = await reader.readExactly(saltLen);

    const ivLen = (await reader.readExactly(1))[0];
    if (ivLen !== IV_SIZE) {
        throw new Error(ERR_CORRUPTED_VAULT);
    }
    const headerIv = await reader.readExactly(ivLen);

    const metaLenBytes = await reader.readExactly(8);
    const metaLen = readUint64BE(new DataView(metaLenBytes.buffer, metaLenBytes.byteOffset, metaLenBytes.byteLength), 0);
    if (metaLen < 0 || metaLen > MAX_META_SIZE) {
        throw new Error(ERR_CORRUPTED_VAULT);
    }

    const key = await deriveAesKey(password, salt, iterations);

    const metaCipher = await reader.readExactly(metaLen);
    await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: headerIv as unknown as BufferSource,
            tagLength: TAG_LENGTH_BITS,
        },
        key,
        metaCipher as unknown as BufferSource,
    );

    await reader.readUint32BE(); // docCount currently informational

    return (async function* () {
        while (true) {
            const chunkLen = await reader.readUint64BEOrEof();
            if (chunkLen === null) break;
            if (chunkLen > MAX_FRAME_SIZE) {
                throw new Error(ERR_CORRUPTED_VAULT);
            }

            const iv = await reader.readExactly(IV_SIZE);
            const ciphertext = await reader.readExactly(chunkLen);

            const plainBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv as unknown as BufferSource,
                    tagLength: TAG_LENGTH_BITS,
                },
                key,
                ciphertext as unknown as BufferSource,
            );
            yield new Uint8Array(plainBuffer);
        }
    })();
}

async function decryptLegacyAfterMagic(
    reader: ChunkReader,
    password: string,
    firstTwoBytes: Uint8Array
): Promise<AsyncGenerator<Uint8Array>> {
    const potentialVersion = new DataView(firstTwoBytes.buffer, firstTwoBytes.byteOffset, firstTwoBytes.byteLength).getUint16(0, true);

    let iterations = 100000;
    let salt: Uint8Array;

    if (potentialVersion === LEGACY_VERSION_V2) {
        iterations = await reader.readUint32LE();
        salt = await reader.readExactly(SALT_SIZE);
    } else {
        const restSalt = await reader.readExactly(SALT_SIZE - 2);
        salt = new Uint8Array(SALT_SIZE);
        salt.set(firstTwoBytes, 0);
        salt.set(restSalt, 2);
    }

    const key = await deriveAesKey(password, salt, iterations);

    return (async function* () {
        while (true) {
            const lenBytes = await reader.tryReadExactly(4);
            if (!lenBytes) break;
            const chunkLen = new DataView(lenBytes.buffer, lenBytes.byteOffset, lenBytes.byteLength).getUint32(0, true);
            if (chunkLen > MAX_FRAME_SIZE) {
                throw new Error(ERR_CORRUPTED_VAULT);
            }

            const iv = await reader.readExactly(IV_SIZE);
            const ciphertext = await reader.readExactly(chunkLen);
            const plainBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv as unknown as BufferSource,
                    tagLength: TAG_LENGTH_BITS
                },
                key,
                ciphertext as unknown as BufferSource
            );
            yield new Uint8Array(plainBuffer);
        }
    })();
}

export async function* decryptStream(
    stream: ReadableStream<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    const reader = new ChunkReader(stream);

    try {
        const magic = await reader.readExactly(4);
        const magicStr = new TextDecoder().decode(magic);
        if (magicStr !== HEADER_MAGIC) {
            throw new Error('Invalid file format: Not a SLBK backup');
        }

        const versionBytes = await reader.readExactly(2);
        const versionBe = new DataView(versionBytes.buffer, versionBytes.byteOffset, versionBytes.byteLength).getUint16(0, false);

        const gen = versionBe === CURRENT_VERSION
            ? await decryptV3(reader, password)
            : await decryptLegacyAfterMagic(reader, password, versionBytes);

        for await (const chunk of gen) {
            yield chunk;
        }
    } catch (e) {
        const err = e as Error;
        if (err.name === 'OperationError') {
            throw new Error(ERR_INCORRECT_PASSWORD);
        }
        if (err.message.startsWith('Unexpected EOF')) {
            throw new Error(ERR_CORRUPTED_VAULT);
        }
        throw err;
    } finally {
        reader.release();
    }
}

export function parseSlbkHeaderBytes(data: Uint8Array): SlbkHeaderInfo {
    if (data.byteLength < HEADER_FIXED_SIZE + 4) {
        throw new Error('File too small');
    }

    const magic = new TextDecoder().decode(data.slice(0, 4));
    if (magic !== HEADER_MAGIC) {
        throw new Error('Invalid magic');
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = view.getUint16(4, false);
    if (version !== CURRENT_VERSION) {
        throw new Error(`Unsupported version: ${version}`);
    }

    const kdf = view.getUint8(6);
    const iterations = view.getUint32(7, false);
    const saltLen = view.getUint8(11);
    const saltStart = 12;
    const ivLenOffset = saltStart + saltLen;
    const ivLen = view.getUint8(ivLenOffset);
    const ivStart = ivLenOffset + 1;
    const metaLenOffset = ivStart + ivLen;
    const metaLen = readUint64BE(view, metaLenOffset);

    if (saltLen !== SALT_SIZE || ivLen !== IV_SIZE) {
        throw new Error('Unsupported header lengths');
    }

    const afterMeta = metaLenOffset + 8 + metaLen;
    if (afterMeta + 4 > data.byteLength) {
        throw new Error('Truncated file');
    }

    const docCount = new DataView(data.buffer, data.byteOffset + afterMeta, 4).getUint32(0, false);

    return {
        magic,
        version,
        kdf,
        iterations,
        saltHex: toHex(data.slice(saltStart, saltStart + saltLen)),
        ivHex: toHex(data.slice(ivStart, ivStart + ivLen)),
        metaLen,
        docCount,
    };
}

export async function decryptV2(encryptedData: Uint8Array, password: string): Promise<Uint8Array> {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encryptedData);
            controller.close();
        }
    });

    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    for await (const chunk of decryptStream(stream, password)) {
        chunks.push(chunk);
        totalLength += chunk.byteLength;

        if (totalLength > 200 * 1024 * 1024) {
            throw new Error('File too large for memory decryption. Use streaming.');
        }
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return result;
}
