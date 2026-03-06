import {describe, expect, it, vi} from 'vitest';
import '../../src/pages/doc-page';
import {DocPage} from '../../src/pages/doc-page';

const mockShareFile = vi.fn().mockResolvedValue(undefined);
const mockIgnoreNextResume = vi.fn();

vi.mock('../../src/services/share', () => ({
    shareFile: (...args: any[]) => mockShareFile(...args),
    shareFiles: vi.fn()
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

        await (el as any).onEditorShare(new CustomEvent('page-editor-share', {
            detail: {
                master: {bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1},
                format: 'jpg'
            }
        }));

        expect(mockIgnoreNextResume).toHaveBeenCalledWith('share-doc-editor', 120000);
        expect(mockShareFile).toHaveBeenCalledTimes(1);
        const filename = mockShareFile.mock.calls[0]?.[1] as string;
        expect(filename.endsWith('.jpg')).toBe(true);
    });
});
