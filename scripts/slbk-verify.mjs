#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node scripts/slbk-verify.mjs <path-to-backup.slbk>');
    process.exit(1);
}

const abs = path.resolve(process.cwd(), filePath);
const data = new Uint8Array(fs.readFileSync(abs));

function readUint64BE(view, offset) {
    const hi = view.getUint32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    return hi * 0x100000000 + lo;
}

function hex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

try {
    if (data.byteLength < 53) throw new Error('File too small');

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = new TextDecoder().decode(data.slice(0, 4));
    if (magic !== 'SLBK') throw new Error('Invalid magic');

    const version = view.getUint16(4, false);
    const kdf = view.getUint8(6);
    const iterations = view.getUint32(7, false);
    const saltLen = view.getUint8(11);
    const salt = data.slice(12, 12 + saltLen);
    const ivLenOffset = 12 + saltLen;
    const ivLen = view.getUint8(ivLenOffset);
    const iv = data.slice(ivLenOffset + 1, ivLenOffset + 1 + ivLen);
    const metaLenOffset = ivLenOffset + 1 + ivLen;
    const metaLen = readUint64BE(view, metaLenOffset);
    const docCountOffset = metaLenOffset + 8 + metaLen;
    if (docCountOffset + 4 > data.byteLength) throw new Error('Truncated file');
    const docCount = new DataView(data.buffer, data.byteOffset + docCountOffset, 4).getUint32(0, false);

    console.log(`File: ${abs}`);
    console.log(`Magic: ${magic}`);
    console.log(`Version: ${version}`);
    console.log(`KDF: ${kdf} (${kdf === 1 ? 'PBKDF2-SHA256' : 'unknown'})`);
    console.log(`Iterations: ${iterations}`);
    console.log(`Salt (${saltLen}): ${hex(salt)}`);
    console.log(`IV (${ivLen}): ${hex(iv)}`);
    console.log(`Meta length: ${metaLen}`);
    console.log(`Document count: ${docCount}`);
} catch (err) {
    console.error(`Verification failed: ${err.message}`);
    process.exit(2);
}
