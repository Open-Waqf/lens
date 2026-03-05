#!/usr/bin/env node

import fs from 'node:fs';

function parseArgs(argv) {
    const args = {
        input: '',
        allowHosts: new Set(['localhost', '127.0.0.1', '::1']),
    };

    for (const arg of argv) {
        if (!args.input && !arg.startsWith('--')) {
            args.input = arg;
            continue;
        }
        if (arg.startsWith('--allow-hosts=')) {
            const hosts = arg.slice('--allow-hosts='.length).split(',').map(v => v.trim()).filter(Boolean);
            for (const host of hosts) args.allowHosts.add(host);
        }
    }

    if (!args.input) {
        throw new Error('Usage: node scripts/network-assert.mjs <jsonl-file> [--allow-hosts=host1,host2]');
    }

    return args;
}

function loadEntries(path) {
    if (!fs.existsSync(path)) return [];
    const raw = fs.readFileSync(path, 'utf8');
    if (!raw.trim()) return [];

    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
        try {
            rows.push(JSON.parse(line));
        } catch {
            // Ignore malformed lines from external tools.
        }
    }
    return rows;
}

function isAllowedHost(host, allowHosts) {
    if (!host) return true;
    if (allowHosts.has(host)) return true;
    if (host.endsWith('.localhost')) return true;
    return false;
}

function summarizeViolation(entry) {
    return `${entry.method || 'GET'} ${entry.url || `${entry.scheme || 'http'}://${entry.host || ''}${entry.path || ''}`}`;
}

function main() {
    const {input, allowHosts} = parseArgs(process.argv.slice(2));
    const entries = loadEntries(input);
    const violations = entries.filter(entry => !isAllowedHost(entry.host, allowHosts));

    if (violations.length === 0) {
        console.log(`Network assertion passed: no disallowed outbound requests found (${entries.length} total observed).`);
        process.exit(0);
    }

    console.error('Network assertion failed. Disallowed outbound requests detected:');
    for (const v of violations) {
        console.error(`- ${summarizeViolation(v)}`);
    }
    process.exit(1);
}

main();

