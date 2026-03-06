import {settings} from './settings';
import {Capacitor} from '@capacitor/core';
import {bytesToBase64} from '../lib/bytes';
import {MirrorBackupNative} from '../plugins/mirror-backup-native';

const DB_NAME = 'sahifah-mirror-v1';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'backup-dir';
const MIRROR_LABEL_KEY = 'sahifah.mirrorBackup.folderLabel';

type MirrorStatus = 'mirrored' | 'skipped' | 'needs_setup' | 'unsupported';

type MirrorResult = {
    status: MirrorStatus;
    reason?: string;
    filename?: string;
};

export type PickMirrorFolderResult = {
    ok: boolean;
    reason?: 'unsupported' | 'cancelled' | 'permission_denied' | 'error';
};

function isDirectoryPickerSupported(): boolean {
    return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

export function isMirrorBackupSupported(): boolean {
    if (Capacitor.isNativePlatform()) return true;
    return isDirectoryPickerSupported();
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Failed to open mirror backup DB'));
    });
}

async function putHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save mirror handle'));
    });
    db.close();
}

async function getHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await openDb();
    const out = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error('Failed to read mirror handle'));
    });
    db.close();
    return out;
}

async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const permHandle = handle as any;
    try {
        const query = typeof permHandle.queryPermission === 'function'
            ? await permHandle.queryPermission({mode: 'readwrite'})
            : 'prompt';
        if (query === 'granted') return true;
        const requested = typeof permHandle.requestPermission === 'function'
            ? await permHandle.requestPermission({mode: 'readwrite'})
            : 'denied';
        return requested === 'granted';
    } catch {
        return false;
    }
}

function buildMirrorFilename(baseName: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const core = baseName.replace(/\.slbk$/i, '');
    return `${core}-${y}${m}${d}-${hh}${mm}${ss}.slbk`;
}

function persistMirrorFolderLabel(label: string): void {
    try {
        localStorage.setItem(MIRROR_LABEL_KEY, label);
    } catch {
    }
}

export function getMirrorFolderLabel(): string | null {
    try {
        return localStorage.getItem(MIRROR_LABEL_KEY);
    } catch {
        return null;
    }
}

export async function pickMirrorBackupFolder(): Promise<PickMirrorFolderResult> {
    if (Capacitor.isNativePlatform()) {
        try {
            const support = await MirrorBackupNative.isSupported();
            if (!support.supported) return {ok: false, reason: 'unsupported'};
            const result = await MirrorBackupNative.pickDirectory();
            if (!result.ok) return {ok: false, reason: 'cancelled'};
            const label = result.uri || 'Android folder';
            persistMirrorFolderLabel(label);
            return {ok: true};
        } catch {
            return {ok: false, reason: 'error'};
        }
    }
    if (!isDirectoryPickerSupported()) return {ok: false, reason: 'unsupported'};
    try {
        const handle = await (window as any).showDirectoryPicker({mode: 'readwrite'});
        if (!handle) return {ok: false, reason: 'cancelled'};
        const hasPerm = await ensureWritePermission(handle);
        if (!hasPerm) return {ok: false, reason: 'permission_denied'};
        await putHandle(handle);
        persistMirrorFolderLabel((handle as any).name || 'Selected folder');
        return {ok: true};
    } catch (e) {
        const name = (e as Error)?.name;
        if (name === 'AbortError') return {ok: false, reason: 'cancelled'};
        return {ok: false, reason: 'error'};
    }
}

export async function hasMirrorBackupFolder(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
        try {
            const support = await MirrorBackupNative.isSupported();
            if (!support.supported) return false;
            const res = await MirrorBackupNative.hasDirectory();
            return !!res.hasDirectory;
        } catch {
            return false;
        }
    }
    if (!isDirectoryPickerSupported()) return false;
    const handle = await getHandle();
    return !!handle;
}

export async function writeBackupToMirrorFolder(file: File): Promise<MirrorResult> {
    if (Capacitor.isNativePlatform()) {
        try {
            const support = await MirrorBackupNative.isSupported();
            if (!support.supported) return {status: 'unsupported'};
            const base64 = await bytesToBase64(new Uint8Array(await file.arrayBuffer()));
            const mirroredName = buildMirrorFilename(file.name);
            const res = await MirrorBackupNative.writeBackup({
                displayName: mirroredName,
                base64
            });
            if (res.ok) return {status: 'mirrored', filename: res.filename || mirroredName};
            return {status: 'needs_setup'};
        } catch (e) {
            const msg = (e as Error)?.message || '';
            if (msg.includes('no_directory') || msg.includes('permission_denied')) {
                return {status: 'needs_setup'};
            }
            return {status: 'unsupported', reason: msg};
        }
    }

    if (!isDirectoryPickerSupported()) return {status: 'unsupported'};
    const handle = await getHandle();
    if (!handle) return {status: 'needs_setup'};
    const hasPerm = await ensureWritePermission(handle);
    if (!hasPerm) return {status: 'needs_setup', reason: 'permission_denied'};

    const mirroredName = buildMirrorFilename(file.name);
    const fileHandle = await handle.getFileHandle(mirroredName, {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return {status: 'mirrored', filename: mirroredName};
}

export function shouldMirrorAfterExport(s: {
    mirrorBackupEnabled: boolean;
    mirrorBackupMode: 'manual' | 'after_export';
}): boolean {
    return s.mirrorBackupEnabled && s.mirrorBackupMode === 'after_export';
}

export async function maybeMirrorBackupAfterExport(file: File): Promise<MirrorResult> {
    const s = await settings.get();
    if (!shouldMirrorAfterExport(s)) return {status: 'skipped'};
    return writeBackupToMirrorFolder(file);
}
