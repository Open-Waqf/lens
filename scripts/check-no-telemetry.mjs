#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {unzipSync} from 'fflate';

const DEFAULT_APK_PATH = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

const SIGNATURES = [
    {id: 'firebase-analytics', needles: ['com/google/firebase/analytics', 'firebase-analytics']},
    {id: 'firebase-crashlytics', needles: ['com/google/firebase/crashlytics', 'crashlytics']},
    {id: 'sentry', needles: ['io/sentry', 'sentry.io']},
    {id: 'amplitude', needles: ['com/amplitude', 'api.amplitude.com']},
    {id: 'mixpanel', needles: ['com/mixpanel', 'api.mixpanel.com']},
    {id: 'segment', needles: ['com/segment/analytics', 'cdn.segment.com']},
    {id: 'appsflyer', needles: ['com/appsflyer', 'appsflyer']},
    {id: 'bugsnag', needles: ['com/bugsnag', 'bugsnag']},
    {id: 'datadog', needles: ['com/datadog', 'datadoghq']},
    {id: 'posthog', needles: ['posthog', 'app.posthog.com']},
];

function parseArgs(argv) {
    let apkPath = DEFAULT_APK_PATH;
    let reportPath = '';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--report' && argv[i + 1]) {
            reportPath = argv[i + 1];
            i++;
            continue;
        }
        if (!arg.startsWith('--')) {
            apkPath = arg;
        }
    }
    return {apkPath, reportPath};
}

function toAsciiLower(buf) {
    let out = '';
    out = Buffer.from(buf).toString('latin1').toLowerCase();
    return out;
}

function findHits(source, label, hits) {
    for (const sig of SIGNATURES) {
        for (const needle of sig.needles) {
            if (source.includes(needle)) {
                hits.push(`${sig.id} @ ${label} (${needle})`);
                break;
            }
        }
    }
}

function writeReport(reportPath, lines) {
    if (!reportPath) return;
    fs.mkdirSync(path.dirname(reportPath), {recursive: true});
    fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
}

function main() {
    const {apkPath, reportPath} = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(apkPath)) {
        console.error(`APK not found: ${apkPath}`);
        process.exit(2);
    }

    const bytes = fs.readFileSync(apkPath);
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);

    const hits = [];
    for (const name of names) {
        const lowerName = name.toLowerCase();
        findHits(lowerName, `entry:${name}`, hits);
    }

    for (const [name, content] of Object.entries(entries)) {
        const lowerName = name.toLowerCase();
        if (!(
            lowerName.endsWith('.dex')
            || lowerName.endsWith('.xml')
            || lowerName.endsWith('.txt')
            || lowerName.endsWith('.json')
            || lowerName.endsWith('.mf')
            || lowerName.endsWith('.properties')
            || lowerName.endsWith('.so')
            || lowerName.endsWith('.arsc')
        )) {
            continue;
        }
        const source = toAsciiLower(content);
        findHits(source, `content:${name}`, hits);
    }

    const uniqueHits = Array.from(new Set(hits));
    const reportLines = [
        `APK: ${apkPath}`,
        `Entries scanned: ${names.length}`,
        `Telemetry hits: ${uniqueHits.length}`,
        '',
    ];

    if (uniqueHits.length === 0) {
        reportLines.push('PASS: No telemetry/analytics SDK signatures detected.');
        writeReport(reportPath, reportLines);
        console.log(reportLines.join('\n'));
        process.exit(0);
    }

    reportLines.push('FAIL: Telemetry/analytics SDK signatures detected:');
    for (const hit of uniqueHits) {
        reportLines.push(`- ${hit}`);
    }
    writeReport(reportPath, reportLines);
    console.error(reportLines.join('\n'));
    process.exit(1);
}

main();

