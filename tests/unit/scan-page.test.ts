import {beforeEach, describe, expect, it, vi} from 'vitest';
import '../../src/pages/scan-page';
import {ScanPage} from '../../src/pages/scan-page';

// --- 1. GLOBAL JSDOM MOCKS ---

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({data: new Uint8ClampedArray(4)})),
    toBlob: vi.fn((cb: any) => cb(new Blob(['mock'], {type: 'image/jpeg'}))),
    measureText: vi.fn(() => ({width: 0})),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
})) as any;

HTMLCanvasElement.prototype.toBlob = vi.fn((cb: any) => cb(new Blob(['mock'], {type: 'image/jpeg'})));

class MockOffscreenCanvas {
    width = 100;
    height = 100;

    getContext() {
        return {
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({data: new Uint8ClampedArray(4)}))
        };
    }
}

// @ts-ignore
global.OffscreenCanvas = MockOffscreenCanvas;

// --- 2. DEPENDENCY MOCKS ---
const mockState = vi.hoisted(() => ({
    isNativePlatform: false,
    mockScanDocument: vi.fn().mockResolvedValue({scannedImages: []}),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {isNativePlatform: () => mockState.isNativePlatform, convertFileSrc: (s: any) => s}
}));

vi.mock('@capacitor/haptics', () => ({
    Haptics: {impact: vi.fn()},
    ImpactStyle: {Medium: 'MEDIUM'}
}));

vi.mock('@capacitor-mlkit/document-scanner', () => ({
    DocumentScanner: {scanDocument: (...args: any[]) => mockState.mockScanDocument(...args)}
}));

const mockCameraStart = vi.fn().mockResolvedValue({width: 1920, height: 1080});
const mockCameraStop = vi.fn();

vi.mock('../../src/lib/camera/camera-manager', () => {
    return {
        CameraManager: class {
            start = mockCameraStart;
            stop = mockCameraStop;
            isRunning = false;
            torchSupported = true;

            async toggleTorch() {
            }
        }
    };
});

const mockCreateDoc = vi.fn().mockResolvedValue({id: 'doc_123', title: 'Test Scan'});
const mockAddNewPage = vi.fn().mockResolvedValue('page_123');
const mockRecordSaveReminder = vi.fn().mockReturnValue(false);
const mockShareFile = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/pages/scan/scan-repo', () => {
    return {
        ScanRepo: class {
            createDoc = mockCreateDoc;
            addNewPage = mockAddNewPage;
            getDoc = vi.fn().mockResolvedValue(null);
            getDocStrip = vi.fn().mockResolvedValue({items: [], pageCount: 0});
            getPageImageBytes = vi.fn().mockResolvedValue(new Uint8Array(0));
            updateExistingPage = vi.fn();
        }
    };
});

vi.mock('../../src/services/backup-reminder', () => ({
    recordSuccessfulSaveAndShouldRemind: (...args: any[]) => mockRecordSaveReminder(...args)
}));

vi.mock('../../src/services/share', () => ({
    shareFile: (...args: any[]) => mockShareFile(...args)
}));

// Mock Worker
class MockWorker {
    onmessage: ((ev: any) => void) | null = null;

    postMessage(data: any) {
        if (data.type === 'detect' && this.onmessage) {
            setTimeout(() => {
                this.onmessage!({data: {type: 'result', confidence: 0.9, quad: null}} as MessageEvent);
            }, 0);
        }
    }

    terminate() {
    }
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

async function waitForButtonWithText(parent: HTMLElement, text: string, timeout = 1500): Promise<HTMLButtonElement> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const btn = Array.from(parent.querySelectorAll('button')).find(
            b => b.textContent?.trim().includes(text)
        ) as HTMLButtonElement | undefined;
        if (btn) return btn;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout: Button with text '${text}' not found`);
}

// --- 4. THE TESTS ---

describe('ScanPage Component', () => {
    let element: ScanPage;

    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = ''; // Clean DOM
        mockRecordSaveReminder.mockReturnValue(false);
        mockState.isNativePlatform = false;
        mockState.mockScanDocument.mockResolvedValue({scannedImages: []});

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
        await new Promise(r => setTimeout(r, 0));
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

        const openBtn = await waitForButtonWithText(element, 'Open Camera');
        openBtn.click();

        // Wait for video element to appear
        await waitForElement(element, 'video');

        expect(mockCameraStart).toHaveBeenCalled();
        expect(element.querySelector('video')).toBeTruthy();
    });

    it('uses native quick mode and invokes native scanner', async () => {
        mockState.isNativePlatform = true;
        localStorage.setItem('sahifah.scanMode', 'quick');
        element = await mountPage(true);

        const startBtn = await waitForButtonWithText(element, 'Start Scanner');
        startBtn.click();

        await new Promise(r => setTimeout(r, 30));

        expect(mockState.mockScanDocument).toHaveBeenCalledTimes(1);
    });

    it('uses manual camera flow on native when scan mode is manual', async () => {
        mockState.isNativePlatform = true;
        localStorage.setItem('sahifah.scanMode', 'manual');
        element = await mountPage(true);

        const startBtn = await waitForButtonWithText(element, 'Open Camera');
        startBtn.click();

        await waitForElement(element, 'video');
        await new Promise(r => setTimeout(r, 120));

        expect(mockCameraStart).toHaveBeenCalledTimes(1);
        expect(mockState.mockScanDocument).not.toHaveBeenCalled();
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

        const captureBtn = element.querySelector('button[aria-label="Capture"]') as HTMLButtonElement | null;
        expect(captureBtn).toBeTruthy();
        captureBtn!.click();

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

        expect(mockRecordSaveReminder).toHaveBeenCalled();
        expect(mockCreateDoc).toHaveBeenCalled();
        expect(mockAddNewPage).toHaveBeenCalled();
    });

    it('shares from editor without creating a document', async () => {
        element = await mountPage(true);

        (element as any).captured = new Blob(['mock'], {type: 'image/jpeg'});
        (element as any).session.setStage('edit');
        element.requestUpdate();
        await element.updateComplete;

        const editor = await waitForElement(element, 'page-editor');
        editor.dispatchEvent(new CustomEvent('page-editor-share', {
            detail: {
                master: {
                    bytes: new Uint8Array([1, 2, 3]),
                    width: 1,
                    height: 1
                },
                format: 'jpg'
            },
            bubbles: true,
            composed: true
        }));

        await new Promise(r => setTimeout(r, 50));

        expect(mockShareFile).toHaveBeenCalledTimes(1);
        expect(mockCreateDoc).not.toHaveBeenCalled();
        expect(mockAddNewPage).not.toHaveBeenCalled();
    });

    it('shares PDF when editor share format is pdf', async () => {
        element = await mountPage(true);
        (element as any).buildSinglePagePdf = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

        (element as any).captured = new Blob(['mock'], {type: 'image/jpeg'});
        (element as any).session.setStage('edit');
        element.requestUpdate();
        await element.updateComplete;

        const editor = await waitForElement(element, 'page-editor');
        editor.dispatchEvent(new CustomEvent('page-editor-share', {
            detail: {
                master: {
                    bytes: new Uint8Array([1, 2, 3]),
                    width: 1,
                    height: 1
                },
                format: 'pdf'
            },
            bubbles: true,
            composed: true
        }));

        await new Promise(r => setTimeout(r, 80));

        expect(mockShareFile).toHaveBeenCalledTimes(1);
        const filename = mockShareFile.mock.calls[0]?.[1] as string;
        expect(filename.endsWith('.pdf')).toBe(true);
    });
});
