#!/usr/bin/env node
/**
 * release-android.mjs: build the signed release bundle (.aab) for Play Console.
 *
 *   npm run android:release
 *
 * Signing comes from, in order:
 *   1. android/keystore.properties (git-ignored): storeFile, storePassword, keyAlias, keyPassword
 *   2. environment variables: LENS_KEYSTORE, LENS_KS_PASS, LENS_KEY_ALIAS [, LENS_KEY_PASS]
 *   3. a prompt in the terminal (written to a temporary keystore.properties, deleted after)
 * The key file itself lives in the Cryptomator vault: unlock the vault first.
 *
 * At the end it checks the bundle is signed with the upload key Play Console expects for
 * Lens, so a wrong key is caught here instead of at upload time.
 * Nothing is uploaded: upload the .aab in Play Console yourself.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawnSync} from 'node:child_process';
import {ROOT, ANDROID, androidEnv, ensureGradlewExecutable} from './android-env.mjs';

// Upload key certificate expected by Play Console for Lens (public, not a secret).
// Assumed to be the shared Open Waqf upload key (Signer, wird). Confirm it in Play Console
// (Test and release > App integrity > Upload key certificate) and change it here if not.
const EXPECTED_UPLOAD_SHA1 = 'BB:7B:A6:CD:E2:16:F1:B0:E1:E4:A2:5B:84:30:73:6B:7B:AF:8A:08';

const KS_PROPS = path.join(ANDROID, 'keystore.properties');
const AAB = path.join(ANDROID, 'app/build/outputs/bundle/release/app-release.aab');
const HOME = process.env.HOME || '';
const env = androidEnv();

function fail(message) {
    console.error(`\n✖ ${message}`);
    process.exit(1);
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {stdio: 'inherit', cwd: ROOT, env, ...opts});
    if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` failed (see above).`);
}

const expandHome = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const cleanPath = (p) => path.resolve(expandHome(String(p || '').trim().replace(/^"(.*)"$/, '$1')));

function keystorePathFromProps() {
    const line = fs.readFileSync(KS_PROPS, 'utf8').split('\n').find((l) => l.trim().startsWith('storeFile='));
    return line ? cleanPath(line.slice(line.indexOf('=') + 1)) : null;
}

// One readline interface for all questions (several on stdin are unreliable).
async function promptForKeystore() {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
    const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
    const askHidden = (q) => new Promise((r) => {
        const orig = rl._writeToOutput.bind(rl);
        rl.question(q, (a) => {
            rl._writeToOutput = orig;
            process.stdout.write('\n');
            r(a.trim());
        });
        rl._writeToOutput = () => {}; // do not echo the password
    });
    try {
        let jks;
        for (;;) {
            jks = cleanPath(await ask('  Keystore file (.jks) path: '));
            if (fs.existsSync(jks)) break;
            console.log(`  ✖ Not found: ${jks} (is the vault unlocked?)`);
        }
        const alias = await ask('  Key alias: ');
        const storePassword = await askHidden('  Keystore password: ');
        const keyPassword = (await askHidden('  Key password (blank = same): ')) || storePassword;
        return {jks, alias, storePassword, keyPassword};
    } finally {
        rl.close();
    }
}

function certificateSha1(file) {
    const keytool = path.join(env.JAVA_HOME, 'bin', 'keytool');
    const r = spawnSync(keytool, ['-printcert', '-jarfile', file], {encoding: 'utf8'});
    return (r.stdout || '').match(/SHA1:\s*([0-9A-F:]+)/)?.[1] || null;
}

async function main() {
    // Signing first, so a locked vault fails in seconds, not after the build.
    let createdTempProps = false;
    if (fs.existsSync(KS_PROPS)) {
        const jks = keystorePathFromProps();
        if (!jks) fail('android/keystore.properties has no storeFile= line.');
        if (!fs.existsSync(jks)) fail(`Keystore file not found: ${jks}\n  Unlock your Cryptomator vault, then run again.`);
        console.log('▶ Signing with android/keystore.properties');
    } else {
        let creds;
        if (process.env.LENS_KEYSTORE) {
            const jks = cleanPath(process.env.LENS_KEYSTORE);
            if (!fs.existsSync(jks)) fail(`LENS_KEYSTORE not found: ${jks}`);
            creds = {
                jks,
                alias: process.env.LENS_KEY_ALIAS || 'upload',
                storePassword: process.env.LENS_KS_PASS || '',
                keyPassword: process.env.LENS_KEY_PASS || process.env.LENS_KS_PASS || '',
            };
            console.log('▶ Signing with LENS_* environment variables');
        } else if (process.stdin.isTTY) {
            console.log('\nNo android/keystore.properties found. Enter the signing details:');
            creds = await promptForKeystore();
        } else {
            fail('No signing configured. Do ONE of:\n'
                + '   • create android/keystore.properties (storeFile, storePassword, keyAlias, keyPassword)\n'
                + '   • set LENS_KEYSTORE, LENS_KS_PASS, LENS_KEY_ALIAS [, LENS_KEY_PASS]\n'
                + '   • run this command in a terminal (it will ask)');
        }
        fs.writeFileSync(KS_PROPS,
            `storeFile=${creds.jks}\nstorePassword=${creds.storePassword}\nkeyAlias=${creds.alias}\nkeyPassword=${creds.keyPassword}\n`,
            {mode: 0o600});
        createdTempProps = true;
    }

    const cleanup = () => { if (createdTempProps) fs.rmSync(KS_PROPS, {force: true}); };
    process.on('exit', cleanup);

    console.log('▶ Building web assets…');
    run('npm', ['run', 'build']);
    console.log('▶ Syncing Android project…');
    run('npx', ['cap', 'sync', 'android']);
    ensureGradlewExecutable();
    fs.rmSync(AAB, {force: true}); // never report an old bundle as the new one
    console.log('▶ Building the signed release bundle…');
    run('./gradlew', ['bundleRelease'], {cwd: ANDROID});

    if (!fs.existsSync(AAB)) fail('The build finished but no .aab was found at the expected path.');
    const sha1 = certificateSha1(AAB);
    if (!sha1) fail(`The bundle is NOT signed: ${AAB}\n  Check the passwords and alias in android/keystore.properties.`);
    if (sha1 !== EXPECTED_UPLOAD_SHA1) {
        fail(`The bundle is signed with a different key than Play Console expects.\n`
            + `  Signed with: ${sha1}\n  Play expects: ${EXPECTED_UPLOAD_SHA1}\n`
            + '  Play would reject this upload. Use the Open Waqf upload key.');
    }

    console.log('▶ Scanning the bundle for analytics or crash-reporting SDKs…');
    run('node', ['scripts/check-no-telemetry.mjs', AAB]);

    console.log('\n───────────────────────────────────');
    console.log('✓ Release bundle signed with the Play upload key.');
    console.log('  Upload it in Play Console:');
    console.log(`  ${AAB}`);
    console.log('───────────────────────────────────');
}

main().catch((e) => fail(e?.message || String(e)));
