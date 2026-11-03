#!/usr/bin/env node
/**
 * check-pinned.mjs: files copied from packages must match the installed package.
 *
 * public/tesseract/worker.min.js and tesseract-core.wasm.js are copies of files inside
 * tesseract.js. If the package is upgraded without copying them again, OCR loads a worker
 * from another version and can break on the phone only. This check catches it in a second.
 * How to upgrade: docs/DEPENDENCIES.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAIRS = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'public/tesseract/worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'public/tesseract/tesseract-core.wasm.js'],
];

const bad = [];
for (const [from, to] of PAIRS) {
    const a = path.join(ROOT, from), b = path.join(ROOT, to);
    if (!fs.existsSync(a)) bad.push(`${from} not found (run npm install)`);
    else if (!fs.existsSync(b)) bad.push(`${to} is missing`);
    else if (!fs.readFileSync(a).equals(fs.readFileSync(b))) bad.push(`${to} differs from ${from}`);
}
if (bad.length) {
    console.error('✖ Copied package files are out of date:');
    for (const b of bad) console.error(`   - ${b}`);
    console.error('\nCopy them again (see docs/DEPENDENCIES.md, "tesseract.js").');
    process.exit(1);
}
console.log(`✓ Copied package files match (${PAIRS.length} files).`);
