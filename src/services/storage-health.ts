import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {db} from './db';
import {opfsListFiles} from './filestore/opfs-store';

export const RISK_FLAG_KEY = 'sahifah.storageRisk.indexMissing';

export type StorageHealthReport = {
    docsInDb: number;
    pagesInDb: number;
    filesUnderDocs: number;
    possibleIndexLoss: boolean;
};

async function countNativeDocsEntries(): Promise<number> {
    try {
        const listing = await Filesystem.readdir({
            path: 'docs',
            directory: Directory.Data
        });
        return listing.files.length;
    } catch {
        return 0;
    }
}

async function countWebDocFiles(): Promise<number> {
    try {
        const files = await opfsListFiles('docs');
        return files.length;
    } catch {
        return 0;
    }
}

export async function runStorageHealthProbe(): Promise<StorageHealthReport> {
    const [docsInDb, pagesInDb] = await Promise.all([
        db.docs.count(),
        db.pages.count()
    ]);

    const filesUnderDocs = Capacitor.isNativePlatform()
        ? await countNativeDocsEntries()
        : await countWebDocFiles();

    const possibleIndexLoss =
        docsInDb === 0 &&
        pagesInDb === 0 &&
        filesUnderDocs > 0;

    if (possibleIndexLoss) {
        localStorage.setItem(RISK_FLAG_KEY, String(Date.now()));
        console.warn('[storage-health] Possible index loss detected', {
            docsInDb,
            pagesInDb,
            filesUnderDocs,
            platform: Capacitor.isNativePlatform() ? 'native' : 'web',
        });
    } else {
        localStorage.removeItem(RISK_FLAG_KEY);
    }

    return {
        docsInDb,
        pagesInDb,
        filesUnderDocs,
        possibleIndexLoss,
    };
}

export function hasIndexLossRiskFlag(): boolean {
    return !!localStorage.getItem(RISK_FLAG_KEY);
}
