import {beforeEach, describe, expect, it, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
    isNative: false,
    docsCount: 0,
    pagesCount: 0,
    opfsFiles: [] as string[],
    nativeEntries: [] as Array<{ name: string; type?: 'file' | 'directory'; size?: number }>
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mockState.isNative
    }
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {Data: 'DATA'},
    Filesystem: {
        readdir: vi.fn(async () => ({files: mockState.nativeEntries}))
    }
}));

vi.mock('../../src/services/db', () => ({
    db: {
        docs: {count: vi.fn(async () => mockState.docsCount)},
        pages: {count: vi.fn(async () => mockState.pagesCount)},
    }
}));

vi.mock('../../src/services/filestore/opfs-store', () => ({
    opfsListFiles: vi.fn(async () => mockState.opfsFiles)
}));

describe('storage-health', () => {
    beforeEach(() => {
        localStorage.clear();
        mockState.isNative = false;
        mockState.docsCount = 0;
        mockState.pagesCount = 0;
        mockState.opfsFiles = [];
        mockState.nativeEntries = [];
    });

    it('flags possible index loss when DB is empty but files exist on web', async () => {
        mockState.opfsFiles = ['docs/a/pages/p1.jpg'];
        const svc = await import('../../src/services/storage-health');

        const report = await svc.runStorageHealthProbe();

        expect(report.possibleIndexLoss).toBe(true);
        expect(localStorage.getItem(svc.RISK_FLAG_KEY)).toBeTruthy();
        expect(svc.hasIndexLossRiskFlag()).toBe(true);
    });

    it('clears flag when metadata exists', async () => {
        mockState.opfsFiles = ['docs/a/pages/p1.jpg'];
        const svc = await import('../../src/services/storage-health');
        await svc.runStorageHealthProbe();
        expect(svc.hasIndexLossRiskFlag()).toBe(true);

        mockState.docsCount = 1;
        const report = await svc.runStorageHealthProbe();
        expect(report.possibleIndexLoss).toBe(false);
        expect(svc.hasIndexLossRiskFlag()).toBe(false);
    });

    it('uses native docs directory listing on native platform', async () => {
        mockState.isNative = true;
        mockState.nativeEntries = [{name: 'doc1', type: 'directory'}];
        const svc = await import('../../src/services/storage-health');

        const report = await svc.runStorageHealthProbe();
        expect(report.filesUnderDocs).toBe(1);
        expect(report.possibleIndexLoss).toBe(true);
    });
});
