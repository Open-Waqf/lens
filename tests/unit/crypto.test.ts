import {describe, expect, it} from 'vitest';
import {
    decryptStream,
    encryptStream,
    ERR_UNSUPPORTED_VAULT_VERSION,
    parseSlbkHeaderBytes
} from '../../src/lib/crypto/pbe';

function stringToStream(str: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(enc.encode(str));
            controller.close();
        }
    });
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        }
    });
}

async function collectEncrypted(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of gen) {
        chunks.push(chunk);
        total += chunk.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

async function streamToString(stream: AsyncGenerator<Uint8Array>): Promise<string> {
    const dec = new TextDecoder();
    let result = '';
    for await (const chunk of stream) {
        result += dec.decode(chunk);
    }
    return result;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.byteLength;
    }
    return out;
}

async function buildLegacyV2Encrypted(plainText: string, password: string): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const plain = enc.encode(plainText);

    const versionLe = new Uint8Array([0x02, 0x00]);
    const iterationsLe = new Uint8Array(4);
    new DataView(iterationsLe.buffer).setUint32(0, 100000, true);

    const salt = new Uint8Array(16);
    for (let i = 0; i < salt.length; i++) salt[i] = i + 1;

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        {name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100000, hash: 'SHA-256'},
        keyMaterial,
        {name: 'AES-GCM', length: 256},
        false,
        ['encrypt', 'decrypt']
    );

    const iv = new Uint8Array(12);
    for (let i = 0; i < iv.length; i++) iv[i] = 20 + i;

    const cipherBuffer = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128},
        key,
        plain as unknown as BufferSource
    );
    const cipher = new Uint8Array(cipherBuffer);
    const lenLe = new Uint8Array(4);
    new DataView(lenLe.buffer).setUint32(0, cipher.byteLength, true);

    return concatBytes(
        new Uint8Array([83, 76, 66, 75]), // SLBK
        versionLe,
        iterationsLe,
        salt,
        lenLe,
        iv,
        cipher
    );
}

describe('Critical: Backup Encryption Protocol', () => {
    it('encrypts/decrypts with valid password', async () => {
        const secretData = 'This is a sensitive document content.';
        const password = 'correct-horse-battery-staple';

        const encrypted = await collectEncrypted(encryptStream(stringToStream(secretData), password, {docCount: 1}));
        const result = await streamToString(decryptStream(bytesToStream(encrypted), password));

        expect(result).toBe(secretData);
    });

    it('writes auditable SLBK header fields', async () => {
        const encrypted = await collectEncrypted(encryptStream(stringToStream('abc'), 'pass-123456', {docCount: 7}));
        const header = parseSlbkHeaderBytes(encrypted);

        expect(header.magic).toBe('SLBK');
        expect(header.version).toBe(3);
        expect(header.kdf).toBe(1);
        expect(header.iterations).toBeGreaterThanOrEqual(600000);
        expect(header.saltHex.length).toBe(32);
        expect(header.ivHex.length).toBe(24);
        expect(header.docCount).toBe(7);
        expect(header.metaLen).toBeGreaterThan(0);
    });

    it('uses unique salt and IV for each export', async () => {
        const password = 'same-password';
        const plain = stringToStream('same-plaintext');
        const a = await collectEncrypted(encryptStream(plain, password, {docCount: 1}));
        const b = await collectEncrypted(encryptStream(stringToStream('same-plaintext'), password, {docCount: 1}));

        const ah = parseSlbkHeaderBytes(a);
        const bh = parseSlbkHeaderBytes(b);

        expect(ah.saltHex).not.toBe(bh.saltHex);
        expect(ah.ivHex).not.toBe(bh.ivHex);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });

    it('fails with clean wrong-password error', async () => {
        const encrypted = await collectEncrypted(encryptStream(stringToStream('secret'), 'right-pass', {docCount: 1}));

        await expect(async () => {
            await streamToString(decryptStream(bytesToStream(encrypted), 'wrong-pass'));
        }).rejects.toThrowError('Incorrect password.');
    });

    it('fails with corruption error for truncated files', async () => {
        const encrypted = await collectEncrypted(encryptStream(stringToStream('secret'), 'right-pass', {docCount: 1}));
        const truncated = encrypted.slice(0, Math.max(0, encrypted.length - 15));

        await expect(async () => {
            await streamToString(decryptStream(bytesToStream(truncated), 'right-pass'));
        }).rejects.toThrowError('Vault file is corrupted or incomplete.');
    });

    it('decrypts legacy v2 backups for backward compatibility', async () => {
        const legacy = await buildLegacyV2Encrypted('legacy payload', 'legacy-pass');
        const result = await streamToString(decryptStream(bytesToStream(legacy), 'legacy-pass'));
        expect(result).toBe('legacy payload');
    });

    it('rejects unsupported future version headers', async () => {
        const encrypted = await collectEncrypted(encryptStream(stringToStream('abc'), 'pw-123456', {docCount: 1}));
        const mutated = encrypted.slice();
        // Force version bytes to 0x0004 (future/unknown)
        mutated[4] = 0x00;
        mutated[5] = 0x04;

        await expect(async () => {
            await streamToString(decryptStream(bytesToStream(mutated), 'pw-123456'));
        }).rejects.toThrowError(ERR_UNSUPPORTED_VAULT_VERSION);
    });
});
