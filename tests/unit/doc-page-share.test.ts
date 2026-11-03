import {describe, expect, it, vi} from 'vitest';
import '../../src/pages/doc-page';
import {DocPage} from '../../src/pages/doc-page';

const mockShareFile = vi.fn().mockResolvedValue(undefined);
const mockIgnoreNextResume = vi.fn();

vi.mock('../../src/services/share', () => ({
    shareFile: (...args: any[]) => mockShareFile(...args),
    shareFiles: vi.fn()
}));

vi.mock('../../src/services/filestore', () => ({
    getFileStore: () => ({get: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9])}),
}));

vi.mock('../../src/services/auth-service', () => ({
    AuthService: {
        ignoreNextResumeForExternalAction: (...args: any[]) => mockIgnoreNextResume(...args)
    }
}));

describe('DocPage editor share', () => {
    it('shares JPG from editor event', async () => {
        const el = document.createElement('doc-page') as DocPage;
        (el as any).doc = {title: 'My Doc'};
        (el as any).pages = [{id: 'p1'}];
        (el as any).editingPage = {id: 'p1'};
        (el as any).repo = {pageTitle: async () => null}; // OCR has not read the page yet

        await (el as any).onEditorShare(new CustomEvent('page-editor-share', {
            detail: {
                master: {bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1},
                format: 'jpg'
            }
        }));

        expect(mockIgnoreNextResume).toHaveBeenCalledWith('share-doc-editor', 120000);
        expect(mockShareFile).toHaveBeenCalledTimes(1);
        const filename = mockShareFile.mock.calls[0]?.[1] as string;
        expect(filename).toBe('My Doc p1.jpg'); // the document's name and the page number
    });

    it('names a page shared from the viewer like the editor does: "Title p2", not "Title - Page 2"', async () => {
        mockShareFile.mockClear();
        const el = document.createElement('doc-page') as DocPage;
        (el as any).doc = {title: 'My Doc'};
        (el as any).pages = [{id: 'p1', imagePath: 'a.jpg'}, {id: 'p2', imagePath: 'b.jpg'}];
        (el as any).repo = {pageTitle: async () => null}; // OCR has not read it yet
        await (el as any).exportSingleImage('p2');
        expect(mockShareFile.mock.calls[0]?.[1]).toBe('My Doc p2.jpg');
    });
});
