import {toArrayBuffer} from '../bytes';

const PBKDF2_ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;
const TAG_LENGTH_BITS = 128; // Standard AES-GCM
const HEADER_MAGIC = new Uint8Array([83, 76, 66, 75]); // "SLBK" in ASCII

// ----------------------------------------------------------------------
// 1. Key Derivation (Shared)
// ----------------------------------------------------------------------

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
            salt: toArrayBuffer(salt),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt']
    );
}

// ----------------------------------------------------------------------
// 2. Stream Encryption (Export)
// ----------------------------------------------------------------------

export async function* encryptStream(
    stream: AsyncGenerator<Uint8Array> | ReadableStream<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    // 1. Generate & Write Header (Magic + Salt)
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));

    // Write Magic "SLBK"
    yield HEADER_MAGIC;
    // Write Salt
    yield salt;

    const key = await deriveAesKey(password, salt);

    // Normalize input to an async iterator
    // (Handles both ReadableStream and the Generator from zipFilesToStream)
    const iterator = (stream instanceof ReadableStream)
        ? stream.getReader()
        : (stream as AsyncGenerator<Uint8Array>);

    while (true) {
        let chunk: Uint8Array;

        if (iterator instanceof ReadableStreamDefaultReader) {
            const res = await iterator.read();
            if (res.done) break;
            chunk = res.value;
        } else {
            const res = await (iterator as AsyncGenerator<Uint8Array>).next();
            if (res.done) break;
            chunk = res.value;
        }

        // 2. Encrypt Chunk with FRESH IV
        // We generate a new IV for every chunk. This is the gold standard for large stream encryption.
        const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));

        const ciphertextBuffer = await crypto.subtle.encrypt(
            {name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BITS},
            key,
            toArrayBuffer(chunk)
        );
        const ciphertext = new Uint8Array(ciphertextBuffer);

        // 3. Write Frame: [Length (4)] + [IV (12)] + [Ciphertext (N)]
        const lenBytes = new Uint8Array(4);
        new DataView(lenBytes.buffer).setUint32(0, ciphertext.byteLength, true); // Little Endian

        yield lenBytes;
        yield iv;
        yield ciphertext;
    }

    if (iterator instanceof ReadableStreamDefaultReader) iterator.releaseLock();
}

// ----------------------------------------------------------------------
// 3. Stream Decryption (Restore)
// ----------------------------------------------------------------------

/**
 * Robust buffering reader for streams.
 * Allows reading exact byte counts across chunk boundaries.
 */
class ChunkReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer: Uint8Array = new Uint8Array(0);
    private done = false;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
    }

    async readExactly(count: number): Promise<Uint8Array> {
        while (this.buffer.length < count) {
            if (this.done) throw new Error(`Unexpected EOF: Wanted ${count} bytes, got ${this.buffer.length}`);

            const {done, value} = await this.reader.read();
            if (done) {
                this.done = true;
                continue; // Loop once more to trigger EOF check above
            }

            // Append new data
            const newBuf = new Uint8Array(this.buffer.length + value.length);
            newBuf.set(this.buffer);
            newBuf.set(value, this.buffer.length);
            this.buffer = newBuf;
        }

        const res = this.buffer.slice(0, count);
        this.buffer = this.buffer.slice(count); // Shift buffer
        return res;
    }

    async readUint32(): Promise<number> {
        const b = await this.readExactly(4);
        return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
    }

    release() {
        this.reader.releaseLock();
    }
}

export async function* decryptStream(
    stream: ReadableStream<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    const reader = new ChunkReader(stream);

    try {
        // 1. Read & Verify Magic "SLBK"
        try {
            const magic = await reader.readExactly(4);
            const magicStr = new TextDecoder().decode(magic);
            if (magicStr !== 'SLBK') {
                throw new Error('Invalid file format: Not a SLBK backup');
            }
        } catch (e) {
            // If we can't even read 4 bytes, file is empty or corrupt
            throw new Error('Invalid backup file or wrong password');
        }

        // 2. Read Salt
        const salt = await reader.readExactly(SALT_SIZE);
        const key = await deriveAesKey(password, salt);

        // 3. Chunk Loop
        while (true) {
            let chunkLen: number;
            try {
                // Try to read the length of the next chunk.
                // If we hit EOF here (and buffer is empty), it's a clean exit.
                chunkLen = await reader.readUint32();
            } catch (e) {
                break; // Clean EOF
            }

            // Safety Cap (100MB chunk limit for sanity/DoS protection)
            if (chunkLen > 100 * 1024 * 1024) throw new Error("Corrupt backup: Chunk size too large");

            // Read IV (12) + Ciphertext (N)
            const iv = await reader.readExactly(IV_SIZE);
            const ciphertext = await reader.readExactly(chunkLen);

            // Decrypt
            const plainBuffer = await crypto.subtle.decrypt(
                {name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: TAG_LENGTH_BITS},
                key,
                toArrayBuffer(ciphertext)
            );

            yield new Uint8Array(plainBuffer);
        }
    } catch (e) {
        // Provide a clearer error if it's likely a password issue (MAC error)
        if ((e as Error).name === 'OperationError') {
            throw new Error('Incorrect password');
        }
        throw e;
    } finally {
        reader.release();
    }
}

export async function decryptV2(encryptedData: Uint8Array, password: string): Promise<Uint8Array> {
    // 1. Convert the static buffer into a stream
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encryptedData);
            controller.close();
        }
    });

    // 2. Reuse the robust decryptStream logic
    // This ensures all the same checks (IVs, chunk bounds, magic bytes) apply here too.
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    for await (const chunk of decryptStream(stream, password)) {
        chunks.push(chunk);
        totalLength += chunk.byteLength;

        // Safety Cap: If someone tries to decrypt a 2GB file in RAM, stop them.
        // (Adjust this limit based on your app's needs)
        if (totalLength > 200 * 1024 * 1024) {
            throw new Error("File too large for memory decryption. Use streaming.");
        }
    }

    // 3. Merge chunks efficiently
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return result;
}