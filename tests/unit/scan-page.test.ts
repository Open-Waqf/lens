import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../src/pages/scan-page';
import { ScanPage } from '../../src/pages/scan-page';

// --- 1. GLOBAL JSDOM MOCKS ---

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    toBlob: vi.fn((cb: any) => cb(new Blob(['mock'], { type: 'image/jpeg' }))),
    measureText: vi.fn(() => ({ width: 0 })),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
})) as any;

HTMLCanvasElement.prototype.toBlob = vi.fn((cb: any) => cb(new Blob(['mock'], { type: 'image/jpeg' })));

class MockOffscreenCanvas {
    width = 100;
    height = 100;
    getContext() {
        return {
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) }))
        };
    }
}
// @ts-ignore
global.OffscreenCanvas = MockOffscreenCanvas;

// --- 2. DEPENDENCY MOCKS ---

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false, convertFileSrc: (s: any) => s }
}));

vi.mock('@capacitor/haptics', () => ({
    Haptics: { impact: vi.fn() },
    ImpactStyle: { Medium: 'MEDIUM' }
}));

vi.mock('@capacitor-mlkit/document-scanner', () => ({
    DocumentScanner: { scanDocument: vi.fn() }
}));

const mockCameraStart = vi.fn().mockResolvedValue({ width: 1920, height: 1080 });
const mockCameraStop = vi.fn();

vi.mock('../../src/lib/camera/camera-manager', () => {
    return {
        CameraManager: class {
            start = mockCameraStart;
            stop = mockCameraStop;
            isRunning = false;
            torchSupported = true;
            async toggleTorch() {}
        }
    };
});

const mockCreateDoc = vi.fn().mockResolvedValue({ id: 'doc_123', title: 'Test Scan' });
const mockAddNewPage = vi.fn().mockResolvedValue('page_123');

vi.mock('../../src/pages/scan/scan-repo', () => {
    return {
        ScanRepo: class {
            createDoc = mockCreateDoc;
            addNewPage = mockAddNewPage;
            getDoc = vi.fn().mockResolvedValue(null);
            getDocStrip = vi.fn().mockResolvedValue({ items: [], pageCount: 0 });
            getPageImageBytes = vi.fn().mockResolvedValue(new Uint8Array(0));
            updateExistingPage = vi.fn();
        }
    };
});

// Mock Worker
class MockWorker {
    onmessage: ((ev: any) => void) | null = null;
    postMessage(data: any) {
        if (data.type === 'detect' && this.onmessage) {
            setTimeout(() => {
                this.onmessage!({ data: { type: 'result', confidence: 0.9, quad: null } } as MessageEvent);
            }, 0);
        }
    }
    terminate() {}
}
global.Worker = MockWorker as any;

global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// --- 3. HELPER: Wait for DOM element ---
async function waitForElement(parent: HTMLElement, selector: string, timeout = 1000): Promise<Element> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = parent.querySelector(selector);
        if (el) return el;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout: Element '${selector}' not found in ${parent.innerHTML.substring(0, 100)}...`);
}

// --- 4. THE TESTS ---

describe('ScanPage Component', () => {
    let element: ScanPage;

    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = ''; // Clean DOM

        vi.mock('../../src/services/pending-import', () => ({
            takePendingImport: () => []
        }));
    });

    async function mountPage(welcomeSeen = false) {
        if (welcomeSeen) {
            localStorage.setItem('sahifah.welcomeSeen', '1');
        }
        const el = document.createElement('scan-page') as ScanPage;
        document.body.appendChild(el);
        await el.updateComplete;
        return el;
    }

    it('renders the Welcome screen for new users (Default)', async () => {
        element = await mountPage(false);
        const welcomeTitle = element.querySelector('h1');
        expect(welcomeTitle?.textContent).toContain('Welcome to Lens');
    });

    it('dismisses Welcome screen and shows Scan controls', async () => {
        element = await mountPage(false);
        const startBtn = element.querySelector('button') as HTMLButtonElement;
        startBtn.click();
        await element.updateComplete;

        expect(localStorage.getItem('sahifah.welcomeSeen')).toBe('1');
        expect(element.textContent).toContain('Open Camera');
    });

    it('starts the camera when "Open Camera" is clicked', async () => {
        element = await mountPage(true); // Welcome already seen

        const buttons = Array.from(element.querySelectorAll('button'));
        const openBtn = buttons.find(b => b.textContent?.trim().includes('Open Camera'));

        openBtn?.click();

        // Wait for video element to appear
        await waitForElement(element, 'video');

        expect(mockCameraStart).toHaveBeenCalled();
        expect(element.querySelector('video')).toBeTruthy();
    });

    it('enters Edit Mode after capturing a photo', async () => {
        element = await mountPage(true);

        // Manually force Camera Stage
        (element as any).session.setStage('camera');
        (element as any).videoW = 1000;
        (element as any).videoH = 1000;
        element.requestUpdate();
        await element.updateComplete;

        // Ensure button exists before searching
        await waitForElement(element, 'button');

        const allBtns = Array.from(element.querySelectorAll('button'));
        const realCaptureBtn = allBtns.find(b => b.textContent?.trim() === 'Capture');

        expect(realCaptureBtn).toBeTruthy();
        realCaptureBtn?.click();

        // Wait for editor to appear
        await waitForElement(element, 'page-editor');

        // @ts-ignore
        expect(element.session.stage).toBe('edit');
    });

    it('saves a page and creates a new document', async () => {
        element = await mountPage(true);

        // Manually force Edit Stage
        (element as any).captured = new Blob(['mock'], {type: 'image/jpeg'});
        (element as any).session.setStage('edit');
        element.requestUpdate();
        await element.updateComplete;

        // Wait for editor
        const editor = await waitForElement(element, 'page-editor');

        editor.dispatchEvent(new CustomEvent('page-editor-save', {
            detail: {
                master: new Blob([]),
                thumb: new Blob([]),
                extractText: null
            },
            bubbles: true,
            composed: true
        }));

        // Wait for mock call
        await new Promise(r => setTimeout(r, 50));

        expect(mockCreateDoc).toHaveBeenCalled();
        expect(mockAddNewPage).toHaveBeenCalled();
    });
});