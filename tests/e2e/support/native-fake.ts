// native-fake.ts: run the web app in Playwright as if it were the Android app.
//
// Capacitor talks to Android through a bridge that the Android app injects into the page
// (`window.androidBridge` and `window.Capacitor.nativePromise`). This file injects a fake
// bridge before the app loads, so:
//   - Capacitor.isNativePlatform() is true and getPlatform() is 'android',
//   - every plugin call (Filesystem, Share, DocumentScanner, NativeBiometric, ...) is answered
//     here and recorded, with an in-memory file system for the app's Data and Cache folders,
//   - tests can fire Android events, such as the Back button.
// It tests the app's own Android logic. It cannot show real Android behaviour (the scanner
// UI, the share sheet, the fingerprint prompt): that is what `npm run test:android` is for.
// Ported from Signer (tests/support/native-fake.ts) and extended for Lens's plugins.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import type {Page} from '@playwright/test';

export type NativeCall = {plugin: string; method: string; options: any};

export type FakeAndroidOptions = {
    /** Images the ML Kit scanner "returns": local file paths of JPEGs. Empty = user cancelled. */
    scan?: string[];
    /** Files the system file picker "returns": local file paths. Empty = user cancelled. */
    pick?: string[];
    /** Biometric hardware present (default true) and whether the fingerprint matches (default true). */
    biometric?: {available?: boolean; succeed?: boolean};
    /** Make Filesystem.writeFile fail (for example storage full). */
    failWrite?: boolean;
    /** Open Waqf Signer installed (Sign with Signer). Default false. */
    signer?: boolean;
    /** Files already on the phone at start: "DATA/docs/a/pages/p.jpg" or "CACHE/x.pdf" -> base64. */
    existingFiles?: Record<string, string>;
};

// Every native method the app calls (src/), per plugin. A method missing here makes
// Capacitor throw "not implemented", which a test shows at once.
const METHODS: Record<string, string[]> = {
    App: ['addListener', 'removeListener', 'removeAllListeners', 'exitApp', 'getLaunchUrl'],
    Filesystem: ['writeFile', 'appendFile', 'deleteFile', 'readFile', 'readdir', 'mkdir', 'rmdir', 'stat', 'getUri', 'addListener', 'removeListener'],
    Share: ['share', 'canShare'],
    Haptics: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'],
    SystemBars: ['setStyle', 'show', 'hide', 'setAnimation'],
    DocumentScanner: ['scanDocument'],
    FilePicker: ['pickFiles', 'pickImages', 'pickMedia'],
    NativeBiometric: ['isAvailable', 'verifyIdentity'],
    PrivacyScreen: ['setLockEnabled'],
    SignerHandoff: ['isAvailable', 'open'],
};

const FILE_ROUTE = '/__fake_android_file__/';

export async function fakeAndroid(page: Page, options: FakeAndroidOptions = {}) {
    // Images handed back by the scanner are file:// URIs on a phone. The app loads them
    // with Capacitor.convertFileSrc() + fetch(); here those URLs are served from disk.
    const served: Record<string, string> = {};
    const scanUris = (options.scan || []).map((p, i) => {
        served[`scan-${i}.jpg`] = p;
        return `file:///data/user/0/org.openwaqf.lens/cache/mlkit_docscan/scan-${i}.jpg`;
    });
    const picked = (options.pick || []).map((p) => ({
        name: p.split('/').pop(),
        path: `content://com.android.providers.media.documents/document/${encodeURIComponent(p.split('/').pop()!)}`,
        mimeType: p.endsWith('.png') ? 'image/png' : p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.slbk') ? 'application/octet-stream' : 'image/jpeg',
        data: fs.readFileSync(p).toString('base64'),
    }));
    await page.route(`**${FILE_ROUTE}*`, (route) => {
        const name = decodeURIComponent(route.request().url().split(FILE_ROUTE)[1]);
        const file = served[name];
        if (!file) return route.fulfill({status: 404});
        return route.fulfill({status: 200, contentType: 'image/jpeg', body: fs.readFileSync(file)});
    });

    await page.addInitScript(({methods, options, scanUris, picked, fileRoute}) => {
        const calls: any[] = [];
        const listeners: Record<string, Array<(data: any) => void>> = {};
        // In-memory folders: "DATA/docs/x/pages/p.jpg" -> base64 chunks.
        const files: Record<string, string[]> = {};
        for (const [p, data] of Object.entries(options.existingFiles || {})) files[p] = [data as string];
        let nextId = 1;
        const bio = {available: true, succeed: true, ...(options.biometric || {})};
        const key = (o: any) => `${o.directory || 'ABS'}/${String(o.path).replace(/^\/+/, '')}`;
        const uriFor = (o: any) => `file:///data/user/0/org.openwaqf.lens/${o.directory === 'CACHE' ? 'cache' : 'files'}/${String(o.path).replace(/^\/+/, '')}`;

        const handle = async (plugin: string, method: string, o: any) => {
            switch (`${plugin}.${method}`) {
                case 'Filesystem.writeFile':
                    if (options.failWrite) throw new Error('No space left on device');
                    files[key(o)] = [o.data];
                    return {uri: uriFor(o)};
                case 'Filesystem.appendFile':
                    (files[key(o)] ||= []).push(o.data);
                    return {};
                case 'Filesystem.deleteFile':
                    if (!files[key(o)]) throw new Error('File does not exist');
                    delete files[key(o)];
                    return {};
                case 'Filesystem.readFile': {
                    if (String(o.path).startsWith('content://')) {
                        const p = picked.find((f: any) => f.path === o.path);
                        if (!p) throw new Error('File does not exist');
                        return {data: p.data};
                    }
                    if (!files[key(o)]) throw new Error('File does not exist');
                    // Base64 chunks written with appendFile are joined the way Android does:
                    // decode each, then encode the whole file again.
                    const bin = files[key(o)].map((c) => atob(c)).join('');
                    return {data: btoa(bin)};
                }
                case 'Filesystem.stat': {
                    const k = key(o);
                    if (files[k]) return {type: 'file', size: files[k].map((c) => atob(c)).join('').length, uri: uriFor(o)};
                    if (Object.keys(files).some((f) => f.startsWith(k + '/'))) return {type: 'directory', size: 0, uri: uriFor(o)};
                    throw new Error('File does not exist');
                }
                case 'Filesystem.readdir': {
                    const prefix = key(o).replace(/\/$/, '') + '/';
                    const names = new Map<string, string>();
                    for (const f of Object.keys(files)) {
                        if (!f.startsWith(prefix)) continue;
                        const rest = f.slice(prefix.length).split('/');
                        names.set(rest[0], rest.length > 1 ? 'directory' : 'file');
                    }
                    if (!names.size && o.path) throw new Error('Directory does not exist');
                    return {files: [...names].map(([name, type]) => ({name, type, size: 0, uri: ''}))};
                }
                case 'Filesystem.rmdir': {
                    const prefix = key(o).replace(/\/$/, '') + '/';
                    for (const f of Object.keys(files)) if (f.startsWith(prefix)) delete files[f];
                    return {};
                }
                case 'Filesystem.getUri':
                    return {uri: uriFor(o)};
                case 'App.getLaunchUrl':
                    return {};
                case 'DocumentScanner.scanDocument':
                    if (!scanUris.length) throw Object.assign(new Error('User canceled the scan.'), {code: 'USER_CANCELLED'});
                    return {scannedImages: scanUris};
                case 'FilePicker.pickFiles':
                    if (!picked.length) throw Object.assign(new Error('pickFiles canceled.'), {code: 'USER_CANCELLED'});
                    return {files: picked.slice(0, o.limit || picked.length)};
                case 'SignerHandoff.isAvailable':
                    return {available: !!options.signer};
                case 'SignerHandoff.open':
                    if (!options.signer) throw new Error('signer_unavailable');
                    if (!files[`CACHE/${o.path}`]) throw new Error('file_missing');
                    return {};
                case 'NativeBiometric.isAvailable':
                    return {isAvailable: bio.available, biometryType: bio.available ? 3 : 0};
                case 'NativeBiometric.verifyIdentity':
                    if (!bio.succeed) throw new Error('Authentication failed.');
                    return {};
                default:
                    return {};
            }
        };

        (window as any).androidBridge = {postMessage() {}};
        (window as any).Capacitor = {
            PluginHeaders: Object.entries(methods).map(([name, ms]) => ({
                name,
                methods: (ms as string[]).map((m) => ({name: m, rtype: m === 'addListener' ? 'callback' : 'promise'})),
            })),
            convertFileSrc(path: string) {
                const name = path.split('/').pop();
                return `${location.origin}${fileRoute}${encodeURIComponent(name || '')}`;
            },
            nativePromise(plugin: string, method: string, o: any) {
                calls.push({plugin, method, options: o});
                return handle(plugin, method, o || {});
            },
            nativeCallback(plugin: string, method: string, o: any, callback: (data: any) => void) {
                calls.push({plugin, method, options: o});
                (listeners[`${plugin}:${o?.eventName}`] ||= []).push(callback);
                return String(nextId++);
            },
        };
        (window as any).__fakeAndroid = {
            calls,
            files,
            fire(plugin: string, eventName: string, data: any) {
                for (const cb of listeners[`${plugin}:${eventName}`] || []) cb(data);
                return (listeners[`${plugin}:${eventName}`] || []).length;
            },
        };
    }, {methods: METHODS, options, scanUris, picked, fileRoute: FILE_ROUTE});
}

/** All native calls so far, optionally only one plugin's. */
export async function nativeCalls(page: Page, plugin?: string): Promise<NativeCall[]> {
    const calls: NativeCall[] = await page.evaluate(() => (window as any).__fakeAndroid.calls);
    return plugin ? calls.filter((c) => c.plugin === plugin) : calls;
}

/** Paths in the fake phone storage, e.g. "DATA/docs/abc/pages/p.jpg" or "CACHE/share_….pdf". */
export async function nativeFiles(page: Page): Promise<string[]> {
    return page.evaluate(() => Object.keys((window as any).__fakeAndroid.files));
}

/** Fire an Android event (e.g. App 'backButton'). Returns how many listeners received it. */
export async function fireNative(page: Page, plugin: string, eventName: string, data: any = {}): Promise<number> {
    return page.evaluate(([p, e, d]) => (window as any).__fakeAndroid.fire(p, e, d), [plugin, eventName, data] as const);
}

/** Press the Android Back button. */
export const pressBack = (page: Page) => fireNative(page, 'App', 'backButton', {canGoBack: false});

/** Turn the app lock on, the same way Settings does (the marker hash in localStorage). */
export async function enableAppLock(page: Page) {
    const hash = createHash('sha256').update('sahifah-auth-is-enabled-strictly' + 'sahifah-secure-salt-v1').digest('hex');
    await page.addInitScript((h) => localStorage.setItem('sahifah.integrity_check', h), hash);
}
