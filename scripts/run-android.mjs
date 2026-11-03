#!/usr/bin/env node
/**
 * run-android.mjs: build the app and open it on an Android phone in one command.
 *
 *   npm run android:run     build, install and open the "Lens Dev" test app
 *   npm run android:live    the app on the phone loads from this computer and updates
 *                           every time you save a file (Ctrl+C to stop)
 *
 * The test app has its own id (org.openwaqf.lens.dev), name and data, so it
 * installs next to the Play Store app without touching it.
 *
 * Phone: plugged in over USB with USB debugging on (or an emulator). If several are
 * available, `cap run` asks which. Extra args go to `cap run`, for example
 * `npm run android:run -- --target <device id>`.
 *
 * Live mode starts the Vite dev server and uses `adb reverse`, so the phone reaches
 * this computer as localhost:5173 over the cable: no IP addresses or firewall rules.
 */
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {ROOT, androidEnv, ensureGradlewExecutable, requireDevice} from './android-env.mjs';

const PORT = 5173;
const live = process.argv.includes('--live');
const capArgs = process.argv.slice(2).filter((a) => a !== '--live');
const env = androidEnv();

function run(cmd, args) {
    const r = spawnSync(cmd, args, {stdio: 'inherit', cwd: ROOT, env});
    if (r.status !== 0) {
        console.error(`\n✖ \`${cmd} ${args.join(' ')}\` failed (see above).`);
        process.exit(1);
    }
}

function portIsFree() {
    return new Promise((resolve) => {
        const req = http.get({host: '127.0.0.1', port: PORT, path: '/', timeout: 1000}, (res) => {
            res.resume();
            resolve(false);
        });
        req.on('error', () => resolve(true));
        req.on('timeout', () => { req.destroy(); resolve(true); });
    });
}

async function waitForServer(timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (!(await portIsFree())) return true;
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

console.log('▶ Building web assets…');
run('npm', ['run', 'build']);
console.log('▶ Syncing Android project…');
run('npx', ['cap', 'sync', 'android']);
ensureGradlewExecutable();
requireDevice(env);

if (!live) {
    run('npx', ['cap', 'run', 'android', '--no-sync', ...capArgs]);
    process.exit(0);
}

// --- Live mode ---
if (!(await portIsFree())) {
    console.error(`\n✖ Port ${PORT} is already in use (is \`npm run dev\` or a test run still going?).`);
    console.error('   Stop it, then run `npm run android:live` again.');
    process.exit(1);
}
console.log(`▶ Starting the Vite dev server on port ${PORT}…`);
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', env,
});
if (!(await waitForServer(30000))) {
    vite.kill();
    console.error('\n✖ The Vite dev server did not start. Run `npm run dev` to see why.');
    process.exit(1);
}

// Ctrl+C reaches `cap run` too: it puts the normal config back, then exits. Wait for that.
process.on('SIGINT', () => {});
const cap = spawn('npx', [
    'cap', 'run', 'android', '--no-sync',
    '--live-reload', '--host', 'localhost', '--port', String(PORT), '--forwardPorts', `${PORT}:${PORT}`,
    ...capArgs,
], {cwd: ROOT, stdio: 'inherit', env});

cap.on('exit', (code) => {
    vite.kill();
    // 130 = stopped with Ctrl+C, which is the normal way to end a live session.
    if (code !== 0 && code !== null && code !== 130) {
        console.error('\n✖ `cap run --live-reload` failed (see above).');
        process.exit(1);
    }
    console.log('\n✓ Live session ended. The app on the phone still loads from this computer:');
    console.log('  run `npm run android:run` once to install the normal build again.');
    process.exit(0);
});
