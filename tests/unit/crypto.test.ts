import {describe, expect, it} from 'vitest';
import {decryptStream, encryptStream} from '../../src/lib/crypto/pbe';

function stringToStream(str: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(enc.encode(str));
            controller.close();
        }
    });
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
    it('should successfully encrypt and decrypt a stream with a password', async () => {
        const secretData = "This is a sensitive document content.";
        const password = "correct-horse-battery-staple";

        // 1. Encrypt
        const inputStream = stringToStream(secretData);
        // @ts-ignore
        const encryptedGen = encryptStream(inputStream, password);

        const encryptedChunks: Uint8Array[] = [];
        for await (const chunk of encryptedGen) {
            encryptedChunks.push(chunk);
        }

        const encryptedStream = new ReadableStream({
            start(controller) {
                encryptedChunks.forEach(c => controller.enqueue(c));
                controller.close();
            }
        });

        // 2. Decrypt
        const decryptedGen = decryptStream(encryptedStream, password);
        const result = await streamToString(decryptedGen);

        expect(result).toBe(secretData);
    });
});