#!/usr/bin/env node
/**
 * check.mjs: everything to run before a commit, in one command.
 *
 *   npm run check
 *
 * Runs, in order, and stops at the first failure (fast checks first, so a typo fails in
 * seconds, not after the browser tests):
 *   1. typecheck       tsc --noEmit
 *   2. translations    scripts/check-i18n.mjs
 *   3. copied files    scripts/check-pinned.mjs (OCR worker matches tesseract.js)
 *   4. unit tests      vitest
 *   5. browser tests   Playwright on a phone screen, plus the Arabic right-to-left set.
 *                      Every browser test also fails if the app tries to reach the network.
 *
 *   npm run check -- --desktop   also run every browser test on a desktop screen, including
 *                                the timing gates (@perf). GitHub always does.
 *   npm run check -- --build     test the production build (dist/) instead of the dev server,
 *                                like GitHub does. Slower: it builds first.
 */
import {spawnSync} from 'node:child_process';

const desktop = process.argv.includes('--desktop');
const build = process.argv.includes('--build');
const projects = desktop ? [] : ['--project=phone', '--project=phone-ar'];
const env = {...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE || 'ubuntu24.04-x64'};
if (build) env.TEST_BUILD = '1';

const where = desktop ? 'phone, Arabic, desktop' : 'phone, Arabic';
const steps = [
    {name: 'Typecheck', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.json', '--noEmit'], hint: 'Fix the TypeScript errors above.'},
    {name: 'Translations', cmd: 'node', args: ['scripts/check-i18n.mjs'], hint: 'Fix src/lib/i18n.ts as listed above.'},
    {name: 'Copied files', cmd: 'node', args: ['scripts/check-pinned.mjs'], hint: 'See docs/DEPENDENCIES.md.'},
    {name: 'Unit tests', cmd: 'npx', args: ['vitest', 'run'], hint: 'See the failing unit tests above.'},
    ...(build ? [{name: 'Production build', cmd: 'npm', args: ['run', 'build'], hint: 'Fix the build errors above.'}] : []),
    {name: `Browser tests (${where}${build ? ', production build' : ''})`, cmd: 'npx', args: ['playwright', 'test', ...projects], hint: 'See the failing tests above. `npx playwright show-report` opens the details.'},
];

const started = Date.now();
const times = [];
for (const [i, step] of steps.entries()) {
    console.log(`\n▶ ${i + 1}/${steps.length} ${step.name}…`);
    const t0 = Date.now();
    const r = spawnSync(step.cmd, step.args, {stdio: 'inherit', env});
    times.push(`${step.name} ${Math.round((Date.now() - t0) / 1000)} s`);
    if (r.status !== 0) {
        console.error(`\n✖ ${step.name} failed. ${step.hint}`);
        const skipped = steps.slice(i + 1).map((s) => s.name.toLowerCase());
        if (skipped.length) console.error(`  Not run yet: ${skipped.join(', ')}.`);
        console.error('  Fix it, then run `npm run check` again.');
        process.exit(1);
    }
}
console.log(`\n✓ All checks passed in ${Math.round((Date.now() - started) / 1000)} s (${times.join(', ')}). Safe to commit.`);
