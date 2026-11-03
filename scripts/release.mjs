#!/usr/bin/env node
/**
 * release.mjs: release a new version (website + Android) with one command.
 *
 *   npm run release                  next version: 0.41.0 -> 0.42.0
 *   npm run release -- 1.0.0         an exact version (never lower than the current one)
 *   npm run release -- --dry-run     show what would happen, change nothing
 *
 * Steps (it asks before changing anything):
 *   1. Checks: on develop, nothing uncommitted, git knows your name, GitHub reachable,
 *      not behind GitHub.
 *   2. Shows the commits since the last release and opens your editor for an optional
 *      "What's new" note (500 characters max, like Google Play), saved in
 *      fastlane/metadata/android/en-US/changelogs/<versionCode>.txt. Empty = no note.
 *   3. Sets the version everywhere: package.json, package-lock.json, and versionName +
 *      versionCode (+1) in android/app/build.gradle. (The offline cache needs no version:
 *      it updates by file content.)
 *   4. Production build, `npm run check -- --desktop --build` (typecheck, translations,
 *      unit tests, browser tests on phone, Arabic and desktop against the build), the
 *      Android build check and the telemetry scan of the APK. If anything fails, every
 *      file is put back.
 *   5. Commits "Release X", tags vX and pushes both together. The tag makes GitHub
 *      test again and deploy the website.
 *   6. Builds the signed Android bundle for Google Play (npm run android:release).
 *
 * Other options: --notes "text" (skip the editor), --yes (skip the questions),
 * --no-android (skip step 6), --phone-tests (run the phone tests in step 4 without
 * asking; otherwise they are offered when a phone is connected).
 *
 * Ported from Signer (scripts/release.mjs).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawnSync} from 'node:child_process';
import {ROOT, ANDROID, androidEnv, ensureGradlewExecutable} from './android-env.mjs';

const BRANCH = 'develop';
const PKG = path.join(ROOT, 'package.json');
const LOCK = path.join(ROOT, 'package-lock.json');
const GRADLE = path.join(ROOT, 'android/app/build.gradle');
const CHANGELOGS = path.join(ROOT, 'fastlane/metadata/android/en-US/changelogs');
const PLAY_LIMIT = 500;

// --- Arguments ---
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');
const assumeYes = flag('--yes');
const notesArg = option('--notes');
const explicitVersion = args.find((a, i) => /^\d/.test(a) && args[i - 1] !== '--notes');

// --- Helpers ---
function fail(msg) {
    console.error(`\n✖ ${msg}`);
    process.exit(1);
}

function git(...gitArgs) {
    const r = spawnSync('git', gitArgs, {cwd: ROOT, encoding: 'utf8'});
    if (r.status !== 0) fail(`git ${gitArgs.join(' ')} failed:\n${(r.stderr || '').trim()}`);
    return (r.stdout || '').trim();
}

const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, {cwd: ROOT, stdio: 'inherit', ...opts}).status === 0;

async function ask(question) {
    if (!process.stdin.isTTY) fail('Not an interactive terminal: use --yes (and --notes) to run without questions.');
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    const answer = await new Promise((r) => {
        rl.question(question, r);
        rl.on('close', () => r(null)); // input ended without an answer
    });
    rl.close();
    if (answer === null) fail('No answer: cancelled. Nothing was changed.');
    return answer.trim().toLowerCase();
}

// 0.10.0 > 0.9.0: compare number by number.
function compareVersions(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    }
    return 0;
}

// Opens your git editor on a template; returns the text without # lines.
function editNotes(next, current, commits) {
    const file = path.join(os.tmpdir(), `lens-release-${next}.txt`);
    fs.writeFileSync(file, [
        '',
        `# What's new in ${next} (optional, max ${PLAY_LIMIT} characters, like Google Play).`,
        '# Write it above. Lines starting with # are ignored.',
        '# Save and close the editor to continue. Leave it empty to skip the note.',
        '#',
        `# Commits since ${current}:`,
        ...commits.map((c) => `#   ${c}`),
        '',
    ].join('\n'));
    const editor = spawnSync('git', ['var', 'GIT_EDITOR'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim() || 'nano';
    spawnSync(`${editor} "${file}"`, {shell: true, stdio: 'inherit'});
    const text = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
    fs.rmSync(file, {force: true});
    return text;
}

// GitHub Actions page for this repo, from the origin URL (ssh or https).
function actionsUrl() {
    const url = spawnSync('git', ['remote', 'get-url', 'origin'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim();
    const m = url.match(/github\.com[:/](.+?)(\.git)?$/);
    return m ? `https://github.com/${m[1]}/actions` : null;
}

// --- 1. Checks ---
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== BRANCH) fail(`You are on "${branch}". Switch to ${BRANCH} first: git switch ${BRANCH}`);
if (git('status', '--porcelain')) fail('You have uncommitted changes. Commit them (or stash them) first, then run this again.');
if (spawnSync('git', ['var', 'GIT_COMMITTER_IDENT'], {cwd: ROOT, stdio: 'ignore'}).status !== 0) {
    fail('git does not know your name/email here (needed for the release commit). Set user.name and user.email.');
}
if (spawnSync('git', ['fetch', '--quiet', 'origin', BRANCH, '--tags'], {cwd: ROOT, stdio: 'ignore'}).status !== 0) {
    fail('Could not reach GitHub. Check your internet connection, then run this again.');
}
if (Number(git('rev-list', '--count', `HEAD..origin/${BRANCH}`)) > 0) {
    fail('GitHub has commits you don\'t have. Run: git pull, then run this again.');
}

// --- 2. Version + notes ---
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const current = pkg.version;
let next = explicitVersion;
if (next) {
    if (!/^\d+\.\d+\.\d+$/.test(next)) fail(`"${next}" is not a version like 0.42.0`);
} else {
    const [major, minor] = current.split('.').map(Number);
    next = `${major}.${minor + 1}.0`; // the middle number goes up: 0.41.0 -> 0.42.0
}
if (compareVersions(next, current) <= 0) fail(`${next} is not higher than the current version ${current}`);
if (git('tag', '--list', `v${next}`)) fail(`Tag v${next} already exists`);

const gradleText = fs.readFileSync(GRADLE, 'utf8');
const codeMatch = gradleText.match(/versionCode\s+(\d+)/);
if (!codeMatch || !/versionName\s+"[^"]*"/.test(gradleText)) fail('versionCode/versionName not found in build.gradle');
const code = Number(codeMatch[1]) + 1;

// Commits since the last release = since the commit that set the current versionName in
// build.gradle (every "Release X" commit does), else since the last v* tag, else all.
const lastRelease = git('log', '-1', '--format=%H', `-SversionName "${current}"`, '--', 'android/app/build.gradle')
    || spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim();
const commits = git('log', '--no-merges', '--format=%s', ...(lastRelease ? [`${lastRelease}..HEAD`] : []))
    .split('\n').filter(Boolean);
if (commits.length === 0) fail(`Nothing new since the last release (${current}).`);

console.log(`\nRelease ${current} -> ${next} (Android versionCode ${code})`);
console.log(`\n${commits.length} commit(s) since ${current}:`);
commits.forEach((c) => console.log(`  - ${c}`));

let notes = notesArg;
if (notes === undefined && !dryRun) {
    for (;;) {
        await ask('\nPress Enter to write the "What\'s new" text in your editor…');
        notes = editNotes(next, current, commits);
        if (!notes || notes.length <= PLAY_LIMIT) break;
        console.log(`\n✖ ${notes.length} characters: Google Play allows ${PLAY_LIMIT}. Please shorten it.`);
    }
}
if (notes && notes.length > PLAY_LIMIT) fail(`The note has ${notes.length} characters: Google Play allows ${PLAY_LIMIT}.`);

console.log('\nThis will:');
console.log(`  • set version ${next} (versionCode ${code}) in package.json, package-lock.json, build.gradle`);
if (notes) console.log(`  • save the "What's new" note to changelogs/${code}.txt`);
console.log('  • build, run `npm run check` on all screens against the build, the Android build check and the telemetry scan');
console.log('  • phone tests: asked if a phone is connected, or with --phone-tests');
console.log(`  • commit "Release ${next}", tag v${next}, push both to GitHub (the tag deploys the website)`);
if (!flag('--no-android')) console.log('  • build the signed Android bundle for Google Play');
if (notes) console.log(`\nWhat's new:\n${notes.split('\n').map((l) => `  ${l}`).join('\n')}`);

if (dryRun) {
    console.log('\n(dry run: nothing was changed)');
    process.exit(0);
}
if (!assumeYes && (await ask(`\nRelease ${next} now? (y/N) `)) !== 'y') fail('Cancelled. Nothing was changed.');

// --- 3. Set the version everywhere ---
const changelog = path.join(CHANGELOGS, `${code}.txt`);
const releaseFiles = [PKG, LOCK, GRADLE].map((f) => path.relative(ROOT, f));
fs.writeFileSync(GRADLE, gradleText
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${next}"`));
pkg.version = next;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
if (notes) {
    fs.mkdirSync(CHANGELOGS, {recursive: true});
    fs.writeFileSync(changelog, notes + '\n');
    releaseFiles.push(path.relative(ROOT, changelog));
}

// Remove the note and any folders that only existed for it.
function removeNote() {
    fs.rmSync(changelog, {force: true});
    for (let dir = CHANGELOGS; dir !== ROOT && fs.existsSync(dir) && !fs.readdirSync(dir).length; dir = path.dirname(dir)) {
        fs.rmdirSync(dir);
    }
}

// Put everything back if a later step fails before the commit. The tree was clean at
// the start, so this only undoes what this script (or the build) changed.
function undo(msg) {
    git('reset', '--quiet');
    git('checkout', '--', '.');
    removeNote();
    fail(`${msg} Everything was put back; nothing was committed.`);
}

// --- 4. Build and checks ---
console.log('▶ npm run check -- --desktop --build…');
if (!run('npm', ['run', 'check', '--', '--desktop', '--build'])) undo('npm run check failed.');
// Building the debug app proves the Android project, plugins and Gradle setup still work.
// Then the APK is scanned for analytics or crash-reporting SDKs (the privacy promise).
console.log('▶ Android build check…');
const env = androidEnv();
if (!run('npx', ['cap', 'sync', 'android'], {stdio: 'ignore', env})) undo('cap sync failed before the Android build check.');
ensureGradlewExecutable();
if (!run('./gradlew', ['-q', 'assembleDebug'], {cwd: ANDROID, env})) undo('The Android build check failed.');
if (!run('node', ['scripts/check-no-telemetry.mjs'])) undo('The APK contains a telemetry SDK.');

// Phone tests: optional, because GitHub has no phone. Asked only in a terminal, with a
// phone connected; --phone-tests runs them without asking.
function phoneTestsAvailable() {
    const devices = spawnSync('adb', ['devices'], {encoding: 'utf8', env}).stdout || '';
    const hasPhone = devices.split('\n').some((l) => /\tdevice$/.test(l));
    return hasPhone;
}
let phoneTests = flag('--phone-tests');
if (!phoneTests && process.stdin.isTTY && !assumeYes && phoneTestsAvailable()) {
    phoneTests = (await ask('\nRun the phone tests now? About 2 minutes; keep the phone unlocked. Lens Dev data is erased. (y/N) ')) === 'y';
}
if (phoneTests) {
    console.log('▶ Phone tests…');
    if (!run('node', ['scripts/test-android.mjs'], {env})) undo('The phone tests failed.');
}

// --- 5. Commit, tag, push ---
console.log('▶ Committing, tagging and pushing…');
const tryGit = (...gitArgs) => spawnSync('git', gitArgs, {cwd: ROOT, stdio: 'inherit'}).status === 0;
if (!tryGit('add', '--', ...releaseFiles) || !tryGit('commit', '--quiet', '-m', `Release ${next}`)) undo('Commit failed.');
if (!tryGit('tag', '-a', `v${next}`, '-m', `Release ${next}`)) {
    git('reset', '--quiet', '--hard', 'HEAD~1');
    removeNote();
    fail('Tagging failed. Everything was put back; nothing was committed.');
}
// Generated files the build touched are not part of the release: show them, do not commit them.
const leftovers = git('status', '--porcelain');
if (leftovers) console.log(`  Note: the build changed files that were not committed:\n${leftovers.replace(/^/gm, '    ')}`);
// --atomic: the branch and the tag are pushed together, or not at all.
if (!tryGit('push', '--atomic', 'origin', BRANCH, `v${next}`)) {
    fail('Push failed (network?). The release is committed and tagged on this computer.\n'
        + `  When you are online, finish it with:  git push --atomic origin ${BRANCH} v${next}\n`
        + '  then: npm run android:release');
}
console.log(`✓ v${next} pushed. GitHub is testing and deploying the website.`);
const url = actionsUrl();
if (url) console.log(`  ${url}`);

// --- 6. Android ---
if (!flag('--no-android')) {
    console.log('\n▶ Building the signed Android bundle…');
    if (!run('npm', ['run', 'android:release'])) {
        console.log('\n⚠ The Android build failed. The website release is done; fix the problem,');
        console.log('  then run `npm run android:release` again.');
        process.exit(1);
    }
    console.log('\nLast step: upload the .aab above to the Play Console.');
    if (notes) console.log(`Your "What's new" note: ${path.relative(ROOT, changelog)}`);
}
