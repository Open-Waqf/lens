import {beforeEach, describe, expect, it, vi} from 'vitest';

function asyncEntries(entries: Array<[string, any]>) {
    return (async function* () {
        for (const item of entries) yield item as [string, any];
    })();
}

describe('secureOverwriteAndRemoveOpfsTree', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('attempts removeEntry even when recursive wipe traversal throws', async () => {
        const removeRootEntry = vi.fn(async () => undefined);

        const failingDir = {
            kind: 'directory',
            entries: vi.fn(() => {
                throw new Error('wipe traversal failed');
            }),
        };

        const docsDir = {
            kind: 'directory',
            entries: vi.fn(() => asyncEntries([['nested', failingDir]])),
            removeEntry: vi.fn(async () => undefined),
            getDirectoryHandle: vi.fn(async (_name: string) => failingDir),
        };

        const rootDir = {
            kind: 'directory',
            getDirectoryHandle: vi.fn(async (name: string) => {
                if (name === 'docs') return docsDir;
                throw new Error(`unexpected dir ${name}`);
            }),
            removeEntry: removeRootEntry,
            entries: vi.fn(() => asyncEntries([])),
        };

        Object.defineProperty(globalThis, 'navigator', {
            value: {
                storage: {
                    getDirectory: vi.fn(async () => rootDir),
                },
            },
            configurable: true,
        });

        const mod = await import('../../src/services/filestore/opfs-store');
        await expect(mod.secureOverwriteAndRemoveOpfsTree('docs')).rejects.toThrow('wipe traversal failed');
        expect(removeRootEntry).toHaveBeenCalledWith('docs', {recursive: true});
    });
});

