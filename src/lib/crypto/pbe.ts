const PBKDF2_ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;
const TAG_LENGTH_BITS = 128;
const HEADER_MAGIC = new Uint8Array([83, 76, 66, 75]); // "SLBK"

// ----------------------------------------------------------------------
// 1. Key Derivation
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
            // FORCE CAST: Tell TS this is a safe buffer
            salt: salt as unknown as BufferSource,
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
// 2. Stream Encryption
// ----------------------------------------------------------------------

export async function* encryptStream(
    stream: AsyncGenerator<Uint8Array> | ReadableStream<Uint8Array>,
    password: string
): AsyncGenerator<Uint8Array> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));

    // Write Header
    yield HEADER_MAGIC;
    yield salt;

    const key = await deriveAesKey(password, salt);

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

        const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));

        const ciphertextBuffer = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                // FORCE CAST: Explicitly treat as BufferSource
                iv: iv as unknown as BufferSource,
                tagLength: TAG_LENGTH_BITS
            },
            key,
            // FORCE CAST: Explicitly treat as BufferSource
            chunk as unknown as BufferSource
        );
        const ciphertext = new Uint8Array(ciphertextBuffer);

        // Write Frame: [Length (4)] + [IV (12)] + [Ciphertext (N)]
        const lenBytes = new Uint8Array(4);
        new DataView(lenBytes.buffer).setUint32(0, ciphertext.byteLength, true);

        yield lenBytes;
        yield iv;
        yield ciphertext;
    }

    if (iterator instanceof ReadableStreamDefaultReader) iterator.releaseLock();
}

// ----------------------------------------------------------------------
// 3. Stream Decryption
// ----------------------------------------------------------------------

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
                continue;
            }

            const newBuf = new Uint8Array(this.buffer.length + value.length);
            newBuf.set(this.buffer);
            newBuf.set(value, this.buffer.length);
            this.buffer = newBuf;
        }

        const res = this.buffer.slice(0, count);
        this.buffer = this.buffer.slice(count);
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
        try {
            const magic = await reader.readExactly(4);
            const magicStr = new TextDecoder().decode(magic);
            if (magicStr !== 'SLBK') {
                throw new Error('Invalid file format: Not a SLBK backup');
            }
        } catch (e) {
            throw new Error('Invalid backup file or wrong password');
        }

        const salt = await reader.readExactly(SALT_SIZE);
        const key = await deriveAesKey(password, salt);

        while (true) {
            let chunkLen: number;
            try {
                chunkLen = await reader.readUint32();
            } catch (e) {
                break; // Clean EOF
            }

            if (chunkLen > 100 * 1024 * 1024) throw new Error("Corrupt backup: Chunk size too large");

            const iv = await reader.readExactly(IV_SIZE);
            const ciphertext = await reader.readExactly(chunkLen);

            const plainBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    // FORCE CAST: Explicitly treat as BufferSource
                    iv: iv as unknown as BufferSource,
                    tagLength: TAG_LENGTH_BITS
                },
                key,
                // FORCE CAST: Explicitly treat as BufferSource
                ciphertext as unknown as BufferSource
            );

            yield new Uint8Array(plainBuffer);
        }
    } catch (e) {
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