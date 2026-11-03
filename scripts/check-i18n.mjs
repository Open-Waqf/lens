#!/usr/bin/env node
/**
 * check-i18n.mjs: every language has every text, every text is used.
 *
 *   npm run check-i18n
 *
 * Reads src/lib/i18n.ts as text (no build needed) and checks:
 *   1. every language block defines every English key itself. Arabic starts with
 *      `...EN_MESSAGES`, so a missing Arabic text silently shows English: that is caught here.
 *   2. no text is empty, and no key is defined twice in one block
 *   3. a translation uses no placeholder ({{count}}) that English does not have
 *   4. a translated text is not just the English text copied (words in Latin letters)
 *   5. every key that exists is used in src/ (keys used but not defined are TypeScript errors)
 *
 * Known gaps (a ratchet): scripts/i18n-known-gaps.json lists the gaps that existed when this
 * check was added (Nov 2026). Those are reported but do not fail. A NEW gap fails, and a
 * listed gap that has been fixed must be removed from the file, so the list only shrinks.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(ROOT, 'src/lib/i18n.ts');
const GAPS = path.join(ROOT, 'scripts/i18n-known-gaps.json');
const SRC = path.join(ROOT, 'src');
const write = process.argv.includes('--write-gaps'); // one-off: record today's gaps

const source = fs.readFileSync(I18N, 'utf8');

// Every `const XX_MESSAGES = { ... };` block, with the keys it defines itself.
function blocks() {
    const out = {};
    for (const m of source.matchAll(/const (\w+)_MESSAGES = \{([\s\S]*?)\n\}( as const)?;/g)) {
        const lang = m[1].toLowerCase();
        const entries = [];
        for (const e of m[2].matchAll(/^\s*'([^']+)':\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`))\s*,?\s*$/gm)) {
            entries.push([e[1], e[2].slice(1, -1)]);
        }
        out[lang] = entries;
    }
    return out;
}

function usedText() {
    let all = '';
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.ts') && p !== I18N) all += fs.readFileSync(p, 'utf8') + '\n';
        }
    };
    walk(SRC);
    return all;
}

const placeholders = (t) => [...String(t).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
// Latin words of 3+ letters in a non-Latin language = probably not translated. Brand and
// format names that stay in Latin letters everywhere are allowed.
const KEEP_LATIN = /\b(Lens|Sahifah|PDF|JPG|JPEG|OCR|ZIP|WebP|SLBK|slbk|MERGE|REPLACE|DELETE|Android|iOS|Password123)\b/g;
const looksUntranslated = (t, en) => t === en && /[A-Za-z]{3,}/.test(t.replace(/\{\{\w+\}\}/g, '').replace(KEEP_LATIN, ''));

const all = blocks();
if (!all.en) {
    console.error('✖ Could not find EN_MESSAGES in src/lib/i18n.ts');
    process.exit(1);
}
const en = new Map(all.en);
const found = {missing: [], untranslated: []};
const hard = [];

for (const [lang, entries] of Object.entries(all)) {
    const seen = new Set();
    for (const [k, v] of entries) {
        if (seen.has(k)) hard.push(`${lang}: "${k}" is defined twice`);
        seen.add(k);
        if (!v.trim()) hard.push(`${lang}: "${k}" is empty`);
        if (lang !== 'en') {
            if (!en.has(k)) hard.push(`${lang}: "${k}" is not in English (typo or leftover?)`);
            else if (placeholders(v).split(',').some((p) => p && !placeholders(en.get(k)).split(',').includes(p))) {
                // A translation may leave a placeholder out (Arabic needs no plural "s"),
                // but must never use one English does not fill in.
                hard.push(`${lang}: "${k}" uses {{${placeholders(v)}}} but English only has {{${placeholders(en.get(k))}}}`);
            }
            else if (looksUntranslated(v, en.get(k))) found.untranslated.push(`${lang}:${k}`);
        }
    }
    if (lang !== 'en') for (const k of en.keys()) if (!seen.has(k)) found.missing.push(`${lang}:${k}`);
}

const code = usedText();
for (const k of en.keys()) {
    if (!code.includes(`'${k}'`) && !code.includes(`"${k}"`) && !code.includes(`\`${k}\``)) {
        hard.push(`"${k}" is defined but never used (remove it, or use it)`);
    }
}

if (write) {
    fs.writeFileSync(GAPS, JSON.stringify(found, null, 2) + '\n');
    console.log(`Wrote ${path.relative(ROOT, GAPS)}: ${found.missing.length} missing, ${found.untranslated.length} untranslated.`);
    process.exit(0);
}

const known = fs.existsSync(GAPS) ? JSON.parse(fs.readFileSync(GAPS, 'utf8')) : {missing: [], untranslated: []};
const problems = [...hard];
for (const kind of ['missing', 'untranslated']) {
    const now = new Set(found[kind]);
    const before = new Set(known[kind] || []);
    for (const g of now) if (!before.has(g)) problems.push(`${g.replace(':', ': "')}" is ${kind === 'missing' ? 'missing (shows English)' : 'still the English text'}`);
    for (const g of before) if (!now.has(g)) problems.push(`${g} is fixed: remove it from scripts/i18n-known-gaps.json`);
}

const langs = Object.keys(all).join(', ');
if (problems.length) {
    console.error(`✖ Translations have ${problems.length} problem(s):`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\nFix these in src/lib/i18n.ts, then run `npm run check-i18n` again.');
    process.exit(1);
}
const gaps = (known.missing?.length || 0) + (known.untranslated?.length || 0);
console.log(`✓ Translations OK: ${en.size} keys in ${langs}, all used.` + (gaps ? ` ${gaps} known gap(s) left in scripts/i18n-known-gaps.json.` : ''));
