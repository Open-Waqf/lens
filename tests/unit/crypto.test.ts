import {describe, expect, it} from 'vitest';
import {decryptStream, encryptStream, parseSlbkHeaderBytes} from '../../src/lib/crypto/pbe';

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
        }).rejects.toThrowError('Incorrect password');
    });

    it('fails with corruption error for truncated files', async () => {
        const encrypted = await collectEncrypted(encryptStream(stringToStream('secret'), 'right-pass', {docCount: 1}));
        const truncated = encrypted.slice(0, Math.max(0, encrypted.length - 15));

        await expect(async () => {
            await streamToString(decryptStream(bytesToStream(truncated), 'right-pass'));
        }).rejects.toThrowError('Vault file is corrupted or incomplete.');
    });
});
