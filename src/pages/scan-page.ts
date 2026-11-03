import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {keyed} from 'lit/directives/keyed.js';
import {Capacitor, type PluginListenerHandle} from '@capacitor/core';
import {FilePicker} from '@capawesome/capacitor-file-picker';
import {DocumentScanner} from '@capacitor-mlkit/document-scanner';
import {Haptics, ImpactStyle} from '@capacitor/haptics';

import type {DetectedQuad, Point, Quad} from '../lib/scan/quad';
import {lerpQuad, quadArea} from '../lib/scan/quad';

import {takePendingImport} from '../services/pending-import';
import {bytesToBlob} from '../lib/bytes';
import {processPhoto} from '../lib/image/pipeline';
import {DetectGovernor} from '../lib/scan/detect-governor';
import {getPlatformCaps} from '../services/platform';

import '../components/scan-overlay';
import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';
import type {PageEditorShareDetail} from '../components/page-editor';
import {ConfirmModal} from '../components/confirm-modal';

import {CameraManager} from '../lib/camera/camera-manager';
import {ScanSessionState, MAX_PAGES_PER_BATCH, type ScanStage} from './scan/scan-session-state';
import {ScanRepo} from './scan/scan-repo';
import {ocrQueue} from '../services/ocr-queue';
import {AuthService} from "../services/auth-service";
import {App} from "@capacitor/app";
import {i18n, t} from '../lib/i18n';
import {showToast} from '../components/toast-notification';
import {toUserErrorMessage} from '../lib/user-error';
import {shareFile} from '../services/share';
import {PDFDocument} from 'pdf-lib';
import {buildPdfForDoc} from '../lib/pdf';
import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {bytesToBlob as toBlob} from '../lib/bytes';

import {detectImageMime} from '../lib/image/mime';
import {resolveScanQualityPlan} from '../lib/image/quality';
import {pickedFileToBlob} from '../services/picked-file';
import {pageFileBase, safeFileName} from '../lib/file-name';
import {deleteWithUndo, LIBRARY_CHANGED} from '../services/pending-delete';
import {takePhotoWithCameraApp} from '../services/camera-capture';

const APPEND_DOC_KEY = 'sahifah.appendToDocId';
const AUTO_KEY = 'sahifah.autoCapture';
const JUST_SAVED_DOC_KEY = 'sahifah.justSavedDocId';
const REPLACE_PAGE_KEY = 'sahifah.replacePageId';
const AUTO_CAPTURE_SETTLE_MS = 150;

type StripItem = { id: string; url: string; isNew: boolean };

@customElement('scan-page')
export class ScanPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @query('video') private videoEl!: HTMLVideoElement;

    private camera = new CameraManager();
    private session = new ScanSessionState(() => this.requestUpdate());
    private repo = new ScanRepo();
    private caps = getPlatformCaps();

    @state() private busy = false;
    @state() private error: string | null = null;
    @state() private flashActive = false; // For visual feedback

    @state() private showPermissionError = false; // Controls inline recovery panel in idle state.

    @state() private docTitle: string | null = null;

    @state() private strip: StripItem[] = [];
    private newPageIds = new Set<string>();

    @state() private captured: Blob | null = null;
    @state() private editingPageId: string | null = null;
    @state() private replacePageId: string | null = null;
    @state() private editorKey = 0;

    @state() private selectedPageId: string | null = null;

    @state() private importReviewTotal = 0;
    @state() private importReviewIndex = 0;
    private importReviewQueue: string[] = [];

    @state() private autoCapture = readBool(AUTO_KEY, false);

    @state() private videoW = 0;
    @state() private videoH = 0;

    @state() private guidance: string | null = null;

    private captureInFlight = false;

    private worker: Worker | null = null;
    private offscreen: HTMLCanvasElement | null = null;
    private offCtx: CanvasRenderingContext2D | null = null;
    private detecting = false;

    @state() private lastDetect: DetectedQuad | null = null;
    @state() private smoothedQuad: Quad | null = null;
    @state() private editorInitialQuad: Quad | null = null;
    @state() private editorSource: 'scanner' | 'camera' | 'file' = 'file';

    private stableSince = 0;
    private cooldownUntil = 0;

    private detGov = new DetectGovernor();
    private detectLoopTimer: number | null = null;
    private detectLoopToken = 0;
    private lastAnnouncedStage: ScanStage | null = null;
    private autoCaptureSettleTimer: number | null = null;
    private appBackListener: PluginListenerHandle | null = null;

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        window.addEventListener('hashchange', this.onHashChange);

        const pending = takePendingImport();
        await this.loadMode(!!pending?.length);

        if (pending?.length) {
            this.clearAppendKey();
            this.session.resetAll();
            this.docTitle = null;

            if (pending.length === 1) await this.openNewBlobInEditor(pending[0]);
            else await this.batchImport(pending);
        }
        ocrQueue.addEventListener('change', this.onOcrQueueChange);
        window.addEventListener(LIBRARY_CHANGED, this.onLibraryChanged);

        if (Capacitor.isNativePlatform()) {
            void App.addListener('backButton', () => {
                if (this.session.stage === 'edit') {
                    void this.onEditorCancel();
                } else if (this.session.stage === 'camera') {
                    void this.exitScan();
                } else if (location.hash !== '#/library') {
                    location.hash = '#/library';
                }
            }).then(h => this.appBackListener = h);
        }
    }

    /** Remove a page from the document being built, with Undo in a toast. */
    private async removePage(pageId: string, e?: Event) {
        if (e) e.stopPropagation(); // Stop the click from opening the editor
        try {
            await deleteWithUndo('page', [pageId]);
            this.newPageIds.delete(pageId);
            await this.refreshDocInfo();
            if (this.session.pageCount === 0) {
                this.clearEditor();
                this.session.setStage('idle');
            }
        } catch (err) {
            console.error('Failed to delete page', err);
        }
    }

    private onLibraryChanged = () => {
        if (this.session.stage === 'idle') void this.refreshDocInfo();
    };

    private onOcrQueueChange = () => {
        this.requestUpdate();
    };

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this.onHashChange);
        if (this.session.isAppend) this.clearAppendKey();
        localStorage.removeItem(REPLACE_PAGE_KEY);

        void this.stopCamera();
        this.stopDetector();
        this.revokeStrip();
        this.clearImportReview();
        ocrQueue.removeEventListener('change', this.onOcrQueueChange);
        window.removeEventListener(LIBRARY_CHANGED, this.onLibraryChanged);
        void this.appBackListener?.remove();
        this.appBackListener = null;
        this.dispatchStageChange('idle');
        super.disconnectedCallback();
    }

    protected updated(): void {
        const currentStage = this.session.stage;
        if (this.lastAnnouncedStage === currentStage) return;
        this.dispatchStageChange(currentStage);
    }

    private dispatchStageChange(stage: ScanStage): void {
        this.lastAnnouncedStage = stage;
        this.dispatchEvent(new CustomEvent<{ stage: ScanStage }>('scan-stage-change', {
            detail: {stage},
            bubbles: true,
            composed: true
        }));
    }

    private onHashChange = () => {
        const h = location.hash || '';
        if (h.startsWith('#/scan')) void this.loadMode();
    };

    // The scanner was opened by arriving here, not by a tap on this screen.
    private autoLaunched = false;

    private async loadMode(takenPending = false): Promise<void> {
        await this.stopCamera();
        this.stopDetector();
        this.revokeStrip();

        this.error = null;
        this.busy = false;
        this.showPermissionError = false;

        this.clearEditor();
        this.newPageIds.clear();
        this.clearImportReview();
        this.selectedPageId = null;

        this.lastDetect = null;
        this.smoothedQuad = null;

        const params = this.getHashParams();
        const forceNew = params.get('new') === '1';
        if (forceNew) {
            this.clearAppendKey();
            localStorage.removeItem(REPLACE_PAGE_KEY);
        }

        const appendId = forceNew ? null : safeGet(APPEND_DOC_KEY);
        this.replacePageId = forceNew ? null : safeGet(REPLACE_PAGE_KEY);

        this.session.resetAll();
        this.session.setAppend(appendId);
        this.session.setStage('idle');
        this.docTitle = null;

        if (appendId) {
            const doc = await this.repo.getDoc(appendId);
            this.docTitle = doc?.title ?? t('common.document');
            await this.refreshDocInfo();
        } else {
            this.session.setPageCount(0);
        }

        if (params.get('import') === '1') {
            setTimeout(() => void this.pickFiles({multiple: !this.replacePageId}), 0);
        } else if (this.caps.isCapacitor && !takenPending && params.get('scan') === '1') {
            // Android: "+" and "Add pages" open Google's scanner at once (their links carry
            // scan=1). The scan screen before it only held one button: a tap for nothing.
            // Any other way onto this screen just shows it (Nov 2026).
            this.autoLaunched = true;
            setTimeout(() => void this.invokeNativeScanner(), 0);
        }
    }

    /** The scan fallback: one photo from the phone's camera app, straight into the editor. */
    private async captureWithCameraApp(scannerError: unknown): Promise<void> {
        try {
            const photo = await takePhotoWithCameraApp();
            if (!photo) {
                if (this.autoLaunched && !this.session.hasPages) void this.exitScan();
                else this.session.setStage('idle');
                return;
            }
            await this.openNewBlobInEditor(photo, null, 'camera');
        } catch (e) {
            this.error = t('scan.quick_scan_failed', {error: toUserErrorMessage(scannerError)}) + ' ' + toUserErrorMessage(e);
            this.session.setStage('idle');
        }
    }

    private async triggerHaptic() {
        try {
            if (this.caps.isCapacitor) {
                await Haptics.impact({style: ImpactStyle.Medium});
            } else if (navigator.vibrate) {
                navigator.vibrate(40);
            }
        } catch {
        }
    }

    private async exitScan(): Promise<void> {
        await this.stopCamera();
        this.stopDetector();

        if (this.replacePageId && this.session.docId) {
            location.hash = `#/doc/${this.session.docId}`;
            return;
        }

        const decision = this.session.decideExit();

        if (decision.kind === 'nav-doc') {
            this.clearAppendKey();
            location.hash = `#/doc/${decision.docId}`;
            return;
        }

        if (decision.kind === 'nav-library') {
            if (decision.markJustSavedDocId) {
                try {
                    sessionStorage.setItem(JUST_SAVED_DOC_KEY, decision.markJustSavedDocId);
                } catch {
                }
            }
            location.hash = '#/library';
        }
    }

    private openDocument(): void {
        const id = this.session.docId;
        if (!id || this.session.pageCount === 0) return;

        this.clearAppendKey();
        location.hash = `#/doc/${id}`;
    }

    private clearEditor() {
        this.captured = null;
        this.editingPageId = null;
        this.editorInitialQuad = null;
        this.editorKey++;
    }

    private clearImportReview() {
        this.importReviewQueue = [];
        this.importReviewTotal = 0;
        this.importReviewIndex = 0;
    }

    private async openNewBlobInEditor(blob: Blob, initialQuad: Quad | null = null, source: 'scanner' | 'camera' | 'file' = 'file'): Promise<void> {
        this.showPermissionError = false;
        await this.stopCamera();
        this.captured = blob;
        this.editingPageId = null;
        this.editorInitialQuad = initialQuad;
        this.editorSource = source;
        this.session.setStage('edit');
        this.editorKey++;
    }

    private async openExistingPageInEditor(pageId: string): Promise<void> {
        this.showPermissionError = false;
        this.error = null;
        await this.stopCamera();
        try {
            const bytes = await this.repo.getPageImageBytes(pageId);
            if (!bytes) return;

            this.captured = bytesToBlob(bytes, 'image/jpeg');
            this.editingPageId = pageId;
            this.selectedPageId = pageId;
            if (this.importReviewQueue.length > 0) {
                const pos = this.importReviewQueue.indexOf(pageId);
                if (pos >= 0) {
                    const reviewed = this.importReviewTotal - this.importReviewQueue.length;
                    this.importReviewIndex = reviewed + pos + 1;
                }
            }
            this.session.setStage('edit');
            this.editorKey++;
        } catch (e) {
            this.error = toUserErrorMessage(e);
        }
    }

    private onEditorCancel = async () => {
        if (this.importReviewQueue.length > 0) {
            const remaining = this.importReviewQueue.length;
            const ok = await ConfirmModal.ask({
                title: t('scan.stop_review'),
                description: t('scan.stop_review_body', {count: remaining}),
                confirm: t('common.stop'),
                destructive: true
            });
            if (!ok) return;
            this.clearImportReview();
        } else if (this.captured) {
            const isEdit = !!this.editingPageId;
            const ok = await ConfirmModal.ask({
                title: isEdit ? t('scan.discard_edits') : t('scan.discard_capture'),
                description: t('scan.discard_body'),
                confirm: t('common.discard'),
                destructive: true
            });
            if (!ok) return;
        }

        this.clearEditor();
        this.error = null;

        this.session.setStage('idle');
    };

    private onEditorSave = async (ev: CustomEvent<PageEditorSaveDetail>) => {
        this.busy = true;
        this.error = null;
        this.requestUpdate();
        const reviewedPageId = this.editingPageId;

        try {
            const {master, thumb} = ev.detail;
            const docId = await this.ensureDocId();

            const targetId = this.editingPageId || this.replacePageId;

            if (targetId) {
                await this.repo.updateExistingPage(targetId, master, thumb);
                if (this.editingPageId) this.newPageIds.delete(this.editingPageId);
                this.selectedPageId = targetId;

                if (this.replacePageId) {
                    this.replacePageId = null;
                    localStorage.removeItem(REPLACE_PAGE_KEY);
                    await this.exitScan();
                    return;
                }
            } else {
                const pageId = await this.repo.addNewPage(docId, master, thumb);
                this.newPageIds.add(pageId);
                this.selectedPageId = pageId;
            }

            await this.refreshDocInfo();

            if (this.importReviewQueue.length > 0) {
                // Remove whichever reviewed imported page was saved, even if user reviewed out of order.
                if (reviewedPageId) {
                    const savedIdx = this.importReviewQueue.indexOf(reviewedPageId);
                    if (savedIdx >= 0) this.importReviewQueue.splice(savedIdx, 1);
                }
                const nextId = this.importReviewQueue[0];
                if (nextId) {
                    this.importReviewIndex = this.importReviewTotal - this.importReviewQueue.length + 1;
                    await new Promise(r => setTimeout(r, 50));
                    await this.openExistingPageInEditor(nextId);
                    return;
                }
                this.clearImportReview();
            }

            this.clearEditor();
            if (this.importReviewQueue.length === 0) {
                this.session.setStage('idle');
            }
        } catch (e) {
            this.error = toUserErrorMessage(e);
        } finally {
            this.busy = false;
        }
    };

    private onEditorShare = async (ev: CustomEvent<PageEditorShareDetail>) => {
        this.busy = true;
        this.error = null;
        this.requestUpdate();

        try {
            const {master, format} = ev.detail;
            // One page shared alone is named from its own text once OCR has read it; before
            // that it carries the document's name and, in a document of several pages, its number.
            const own = this.editingPageId ? await this.repo.pageTitle(this.editingPageId) : null;
            const pageNo = this.editingPageId && this.session.pageCount > 1
                    ? this.strip.findIndex(it => it.id === this.editingPageId) + 1 : 0;
            const safeTitle = pageNo > 0 || own
                    ? pageFileBase(this.docTitle || t('scan.title'), pageNo, own)
                    : safeFileName(this.docTitle || t('scan.title')); // the only page: the document's name
            const filename = format === 'pdf' ? `${safeTitle}.pdf` : `${safeTitle}.jpg`;
            const file = format === 'pdf'
                ? new File([bytesToBlob(await this.buildSinglePagePdf(master.bytes), 'application/pdf')], filename, {type: 'application/pdf'})
                : new File([bytesToBlob(master.bytes, 'image/jpeg')], filename, {type: 'image/jpeg'});
            AuthService.ignoreNextResumeForExternalAction('share-scan-quick', AuthService.SHARE_BYPASS_TTL_MS);
            await shareFile(file, filename);
        } catch (e) {
            this.error = toUserErrorMessage(e);
        } finally {
            this.busy = false;
        }
    };

    /** Share the whole document as one PDF, right after scanning: no detour via the library. */
    private async sharePdf(): Promise<void> {
        const docId = this.session.docId;
        if (!docId || this.busy) return;
        this.busy = true;
        this.error = null;
        try {
            const doc = await this.repo.getDoc(docId);
            if (!doc) return;
            const pages = await db.pages.where('docId').equals(docId).toArray();
            const byId = new Map(pages.map(p => [p.id, p]));
            // A page deleted a moment ago (its Undo still open) is not in the PDF.
            const ordered = doc.pageIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p && !p.deletedAt);
            const bytes = await buildPdfForDoc(getFileStore(), ordered, {quality: 'original'});
            const name = `${safeFileName(doc.title)}.pdf`;
            AuthService.ignoreNextResumeForExternalAction('share-scan-pdf', AuthService.SHARE_BYPASS_TTL_MS);
            await shareFile(new File([toBlob(bytes, 'application/pdf')], name, {type: 'application/pdf'}), name);
        } catch (e) {
            this.error = toUserErrorMessage(e);
        } finally {
            this.busy = false;
        }
    }

    private async buildSinglePagePdf(imageBytes: Uint8Array): Promise<Uint8Array> {
        const pdf = await PDFDocument.create();
        const image = await pdf.embedJpg(imageBytes);
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, {x: 0, y: 0, width: image.width, height: image.height});
        return await pdf.save();
    }

    private revokeStrip() {
        for (const it of this.strip) URL.revokeObjectURL(it.url);
        this.strip = [];
    }

    private async ensureDocId(): Promise<string> {
        if (this.session.docId) return this.session.docId;

        const now = new Date();
        const dateStr = now.toLocaleDateString(i18n.getLocale(), {month: 'short', day: 'numeric'});
        const timeStr = now.toLocaleTimeString(i18n.getLocale(), {hour: 'numeric', minute: '2-digit'});
        const title = `${t('scan.title')} ${dateStr} ${timeStr}`;

        const doc = await this.repo.createDoc(title);
        this.docTitle = doc.title;
        this.session.setCurrentDocId(doc.id);
        this.session.setPageCount(0);
        return doc.id;
    }

    private async refreshDocInfo(): Promise<void> {
        const docId = this.session.docId;
        if (!docId) return;
        const info = await this.repo.getDocStrip(docId, 16);
        if (!info) return;
        this.docTitle = info.title;
        this.session.setPageCount(info.pageCount);
        this.revokeStrip();
        const items: StripItem[] = [];
        for (const it of info.items) {
            const url = URL.createObjectURL(bytesToBlob(it.thumbBytes, detectImageMime(it.thumbBytes)));
            items.push({id: it.id, url, isNew: this.newPageIds.has(it.id)});
        }
        this.strip = items;
    }

    // On Android the scan always uses Google's document scanner (Quick Scan). The live
    // camera below is for the web only: the Android app has no camera permission, and the
    // in-app camera mode never worked there (removed Nov 2026).
    private beginCameraFromGesture(explicit: boolean = false): void {
        this.error = null;
        if (this.caps.isCapacitor) {
            void this.invokeNativeScanner();
            return;
        }
        this.session.setStage('camera');
        // Reset this initially so we don't show error while loading
        this.showPermissionError = false;

        setTimeout(async () => {
            try {
                if (!this.videoEl) return;
                const res = await this.camera.start(this.videoEl);
                this.videoW = res.width;
                this.videoH = res.height;
                this.startDetector();
            } catch (e) {
                // FIXED LOGIC:
                // If user clicked the button (explicit), show the blocking error.
                // If app tried to auto-start (implicit), just go to dashboard.
                if (explicit) {
                    this.error = toUserErrorMessage(e);
                    this.showPermissionError = true;
                    this.session.setStage('idle');
                } else {
                    console.warn("Camera auto-start failed (likely permission), fallback to idle.");
                    this.session.setStage('idle');
                }
            }
        }, 60);
    }

    private async invokeNativeScanner(): Promise<void> {
        this.busy = true;
        this.error = null;
        AuthService.ignoreNextResumeForExternalAction('native-doc-scanner', 120_000);
        const wasAuto = this.autoLaunched;
        try {
            const limit = this.replacePageId ? 1 : 24;
            const {scannedImages} = await DocumentScanner.scanDocument({pageLimit: limit});
            if (scannedImages && scannedImages.length > 0) {
                const files: File[] = [];
                for (const uri of scannedImages) {
                    const webPath = Capacitor.convertFileSrc(uri);
                    const res = await fetch(webPath);
                    const blob = await res.blob();
                    files.push(new File([blob], 'scan.jpg', {type: 'image/jpeg'}));
                }
                // Google's scanner already let the user crop, rotate, filter and review the
                // pages: save them as they are and show the result (Share, Scan another,
                // Done). Tapping a page still opens the editor. Nov 2026.
                await this.batchImport(files, 'scanner');
            }
        } catch (e: any) {
            if (e?.message?.toLowerCase().includes('cancel') || e?.code === 'USER_CANCELLED') {
                // Cancelled straight after "+": go back where the user came from.
                if (this.autoLaunched && !this.session.hasPages) void this.exitScan();
                return;
            }
            // Google's scanner is not on this phone (no Google Play services) or failed:
            // the phone's own camera app takes the photo, and the editor finds the edges.
            await this.captureWithCameraApp(e);
        } finally {
            this.busy = false;
            if (wasAuto) this.autoLaunched = false;
        }
    }

    private async stopCamera(): Promise<void> {
        await this.camera.stop();
    }

    private async capturePhoto(): Promise<void> {
        this.error = null;
        if (!this.session.canAddPage && !this.replacePageId) {
            this.error = t('scan.max_pages_reached', {max: MAX_PAGES_PER_BATCH});
            return;
        }
        if (this.captureInFlight) return;

        this.flashActive = true;
        void this.triggerHaptic();
        setTimeout(() => this.flashActive = false, 150);

        this.captureInFlight = true;
        try {
            const v = this.videoEl;
            const maxDim = 1800;
            const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
            const w = Math.max(1, Math.round(v.videoWidth * scale));
            const h = Math.max(1, Math.round(v.videoHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(v, 0, 0, w, h);

            let detectedQuadForEditor: Quad | null = null;
            const det = this.lastDetect;
            const q = this.smoothedQuad;

            if (det?.quad && q && det.confidence >= 0.50) {
                const sx = w / det.width;
                const sy = h / det.height;
                detectedQuadForEditor = [
                    {x: q[0].x * sx, y: q[0].y * sy},
                    {x: q[1].x * sx, y: q[1].y * sy},
                    {x: q[2].x * sx, y: q[2].y * sy},
                    {x: q[3].x * sx, y: q[3].y * sy},
                ];
            }

            if (!detectedQuadForEditor) {
                // Show hint only when a quad was visible (confidence 0.35–0.49) but didn't
                // pass the post-capture gate — user saw the overlay and will wonder why it reset.
                if (det?.quad && q) {
                    showToast(t('scan.edges_unclear'), 'info');
                }
                detectedQuadForEditor = [
                    {x: 0, y: 0}, {x: w, y: 0},
                    {x: w, y: h}, {x: 0, y: h}
                ];
            }

            const blob: Blob = await new Promise((resolve, reject) =>
                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('scan.capture_failed')))), 'image/jpeg', 0.95),
            );

            await this.openNewBlobInEditor(blob, detectedQuadForEditor, 'camera');
        } catch (e) {
            this.error = toUserErrorMessage(e);
        } finally {
            this.captureInFlight = false;
        }
    }

    private async pickFiles(opts: { multiple: boolean }): Promise<void> {
        this.error = null;

        if (this.caps.isCapacitor) {
            try {
                this.busy = true;
                this.requestUpdate();

                AuthService.ignoreNextResumeForExternalAction('scan-file-picker-native', 120_000);
                const result = await FilePicker.pickFiles({
                    limit: opts.multiple ? 0 : 1,
                    types: ['image/jpeg', 'image/png', 'image/webp'], // no PDF: nothing here can open one (Nov 2026)
                    readData: true
                });

                if (result.files.length === 0) return;

                const files: File[] = [];
                for (const f of result.files) {
                    const blob = await pickedFileToBlob(f);
                    if (!blob) continue;
                    files.push(new File([blob], f.name, {type: f.mimeType || blob.type || 'application/octet-stream'}));
                }

                if (files.length === 0) {
                    this.error = t('scan.import_unavailable');
                    return;
                }
                if (files.length === 1) await this.openNewBlobInEditor(files[0]);
                else await this.batchImport(files);
            } catch (e: any) {
                // Graceful cancel handling
                if (e?.message?.toLowerCase().includes('cancel') || e?.code === 'USER_CANCELLED') {
                    console.log('User cancelled picker');
                } else {
                    this.error = t('scan.picker_error', {error: toUserErrorMessage(e)});
                }
            } finally {
                this.busy = false;
            }
            return;
        }

        // WEB FALLBACK
        const input = this.renderRoot.querySelector('#import-input') as HTMLInputElement;
        if (!input) {
            this.error = t('scan.import_unavailable');
            return;
        }

        input.multiple = opts.multiple;
        input.value = '';
        AuthService.ignoreNextResumeForExternalAction('scan-file-picker-web', 120_000);

        return new Promise((resolve) => {
            const handler = async () => {
                input.removeEventListener('change', handler);
                const files = input.files ? Array.from(input.files) : [];
                if (files.length > 0) {
                    this.showPermissionError = false;
                    if (files.length === 1) await this.openNewBlobInEditor(files[0]);
                    else await this.batchImport(files);
                }
                resolve();
            };
            input.addEventListener('change', handler);
            input.click();
        });
    }

    private onImportClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        void this.pickFiles({multiple: !this.replacePageId});
    };

    private onTryCameraClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.beginCameraFromGesture(true);
    };

    private async batchImport(files: File[], source: 'scanner' | 'file' = 'file'): Promise<void> {
        this.busy = true;
        this.error = null;
        try {
            const docId = await this.ensureDocId();

            if (this.replacePageId && files.length > 0) {
                const replacePlan = await this.resolveImportQualityPlan(files[0]);
                const {master, thumb} = await processPhoto({
                    blob: files[0],
                    rotation: 0,
                    filter: 'original',
                    masterJpegQuality: replacePlan.masterJpegQuality,
                    thumbMax: replacePlan.thumbMax,
                    thumbJpegQuality: replacePlan.thumbJpegQuality,
                } as any);
                await this.repo.updateExistingPage(this.replacePageId, master, thumb);
                this.replacePageId = null;
                localStorage.removeItem(REPLACE_PAGE_KEY);
                await this.exitScan();
                return;
            }

            const currentCount = this.session.pageCount;
            const remaining = MAX_PAGES_PER_BATCH - currentCount;
            if (remaining <= 0) {
                throw new Error(t('scan.max_pages_reached', {max: MAX_PAGES_PER_BATCH}));
            }

            const filesToImport = files.slice(0, remaining);
            const importedPageIds: string[] = [];
            for (const file of filesToImport) {
                const qualityPlan = await this.resolveImportQualityPlan(file, source === 'scanner' ? 'original' : 'archive');
                const {master, thumb} = await processPhoto({
                    blob: file,
                    rotation: 0,
                    filter: 'original',
                    masterJpegQuality: qualityPlan.masterJpegQuality,
                    thumbMax: qualityPlan.thumbMax,
                    thumbJpegQuality: qualityPlan.thumbJpegQuality,
                } as any);
                const pageId = await this.repo.addNewPage(docId, master, thumb);
                importedPageIds.push(pageId);
                this.newPageIds.add(pageId);
            }

            if (files.length > remaining) {
                this.error = t('scan.max_pages_reached', {max: MAX_PAGES_PER_BATCH});
            }

            await this.refreshDocInfo();
            if (source === 'scanner' && importedPageIds.length > 0) {
                this.selectedPageId = importedPageIds[importedPageIds.length - 1];
                this.session.setStage('idle');
                return;
            }
            if (importedPageIds.length > 0) {
                this.importReviewQueue = importedPageIds.slice();
                this.importReviewTotal = importedPageIds.length;
                this.importReviewIndex = 1;
                await this.openExistingPageInEditor(importedPageIds[0]);
            } else {
                this.session.setStage(this.camera.isRunning ? 'camera' : 'idle');
            }
        } catch (e) {
            this.error = toUserErrorMessage(e);
        } finally {
            this.busy = false;
        }
    }

    private startDetector(): void {
        if (this.worker) return;
        this.worker = new Worker(new URL('../lib/scan/edge-worker.ts', import.meta.url), {type: 'module'});
        this.worker.onmessage = (ev: MessageEvent<any>) => {
            const msg = ev.data;
            if (msg?.type !== 'result') return;
            this.detecting = false;
            const tMs = Number(msg.tMs ?? 0);
            if (tMs > 0) this.detGov.onResult(tMs);
            if (this.detGov.isTooSlowForAutoCapture) this.stableSince = 0;

            const quad = msg.quad as Point[] | null;
            const confidence = Number(msg.confidence ?? 0);
            const w = Number(msg.width ?? 0);
            const h = Number(msg.height ?? 0);
            const det: DetectedQuad = {quad: quad ? (quad as any) : null, confidence, width: w, height: h};
            this.lastDetect = det;

            if (det.quad && det.confidence >= 0.35) {
                const q = det.quad as Quad;
                this.smoothedQuad = this.smoothedQuad ? lerpQuad(this.smoothedQuad, q, 0.35) : q;
                this.guidance = det.confidence < 0.65 ? t('scan.guide_hold_steady') : null;
            } else {
                this.smoothedQuad = null;
                this.stableSince = 0;
                this.guidance = det.confidence > 0.1 ? t('scan.guide_move_closer') : null;
            }
            this.maybeAutoCapture();
        };

        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d', {willReadFrequently: true});
        const token = ++this.detectLoopToken;
        const tick = () => {
            if (token !== this.detectLoopToken) return;
            if (!this.worker) return;
            if (!this.camera.isRunning || this.session.stage !== 'camera') {
                this.detectLoopTimer = window.setTimeout(tick, 250);
                return;
            }
            if (document.hidden) {
                this.detectLoopTimer = window.setTimeout(tick, 800);
                return;
            }
            this.grabAndDetect();
            this.detectLoopTimer = window.setTimeout(tick, this.detGov.intervalMs);
        };
        tick();
    }

    private stopDetector(): void {
        this.detectLoopToken++;
        if (this.detectLoopTimer) window.clearTimeout(this.detectLoopTimer);
        this.detectLoopTimer = null;
        if (this.autoCaptureSettleTimer) window.clearTimeout(this.autoCaptureSettleTimer);
        this.autoCaptureSettleTimer = null;
        this.worker?.terminate();
        this.worker = null;
        this.offscreen = null;
        this.offCtx = null;
        this.detecting = false;
        this.lastDetect = null;
        this.smoothedQuad = null;
        this.stableSince = 0;
        this.cooldownUntil = 0;
        this.guidance = null;
    }

    private grabAndDetect(): void {
        if (!this.worker || !this.offCtx || !this.offscreen || this.detecting) return;
        const v = this.videoEl;
        if (!v || v.videoWidth === 0 || v.videoHeight === 0) return;
        const maxDim = this.detGov.maxDim;
        const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * scale));
        const h = Math.max(1, Math.round(v.videoHeight * scale));
        this.offscreen.width = w;
        this.offscreen.height = h;
        this.offCtx.drawImage(v, 0, 0, w, h);
        const img = this.offCtx.getImageData(0, 0, w, h);
        this.detecting = true;
        // Optimization: Zero-Copy Transferable
        this.worker.postMessage({type: 'detect', width: img.width, height: img.height, rgba: img.data}, [img.data.buffer]);
    }

    private quadStabilityScore(q: Quad, det: DetectedQuad): number {
        if (!this.smoothedQuad) return 1;
        const norm = (p: Point) => ({x: p.x / det.width, y: p.y / det.height});
        const a = this.smoothedQuad.map(norm) as Quad;
        const b = q.map(norm) as Quad;
        let sum = 0;
        for (let i = 0; i < 4; i++) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
        return sum / 4;
    }

    private maybeAutoCapture(): void {
        if (!this.autoCapture
            || this.captureInFlight
            || Date.now() < this.cooldownUntil
            || this.session.stage !== 'camera') return;
        if (this.detGov.isTooSlowForAutoCapture) {
            this.stableSince = 0;
            return;
        }
        if (!this.lastDetect?.quad || !this.smoothedQuad) {
            this.stableSince = 0;
            return;
        }
        const det = this.lastDetect;
        const q = this.smoothedQuad;
        if (det.confidence < 0.72) {
            this.stableSince = 0;
            return;
        }
        const area = quadArea(q) / (det.width * det.height);
        if (area < 0.18) {
            this.stableSince = 0;
            return;
        }
        const jitter = this.quadStabilityScore(q, det);
        if (jitter > 0.012) {
            this.stableSince = 0;
            return;
        }
        if (this.stableSince === 0) this.stableSince = Date.now();
        if (Date.now() - this.stableSince > 650) {
            if (this.autoCaptureSettleTimer) return;
            this.cooldownUntil = Date.now() + 1200 + AUTO_CAPTURE_SETTLE_MS;
            this.autoCaptureSettleTimer = window.setTimeout(() => {
                this.autoCaptureSettleTimer = null;
                if (!this.autoCapture || this.session.stage !== 'camera' || this.captureInFlight) return;
                if (this.stableSince === 0 || Date.now() - this.stableSince < 650) return;
                void this.capturePhoto();
                this.stableSince = 0;
            }, AUTO_CAPTURE_SETTLE_MS);
        }
    }

    private async resolveImportQualityPlan(file: Blob, preset: 'archive' | 'original' = 'archive'): Promise<ReturnType<typeof resolveScanQualityPlan>> {
        const bmp = await createImageBitmap(file);
        try {
            return resolveScanQualityPlan({
                action: 'save',
                preset,
                filter: 'original',
                rawWidth: bmp.width,
                rawHeight: bmp.height,
            });
        } finally {
            bmp.close();
        }
    }

    private renderHiddenInput() {
        return html`
            <input type="file"
                   id="import-input"
                   accept="image/jpeg,image/png,image/webp"
                   multiple
                   style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;">
        `;
    }

    /** The pages scanned so far, as a grid of thumbnails. */
    private renderStrip() {
        if (!this.strip.length) return null;
        const selected = this.editingPageId || this.selectedPageId;
        return html`
            <!-- Every page tile has the same size, one page or ten, and shows the whole page. -->
            <div class="flex flex-wrap justify-center gap-3" data-testid="scan-strip">
                ${this.strip.map((it, idx) => html`
                    <div class="relative w-[calc(50%-0.375rem)]">
                        <button class="relative block w-full aspect-[3/4] rounded-xl border-2 ${selected === it.id ? 'border-emerald-500' : 'border-slate-800'} overflow-hidden bg-slate-900 active:scale-95 transition-transform"
                                title=${t('scan.edit_page')} aria-label=${t('scan.edit_page')}
                                @click=${() => void this.openExistingPageInEditor(it.id)}>
                            <img src=${it.url} class="w-full h-full object-contain" alt=${t('scan.thumbnail_alt', {index: idx + 1})}/>
                            <div class="absolute bottom-1 left-1 text-[11px] font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">${idx + 1}</div>
                        </button>
                        <button class="absolute -top-2 -right-2 w-8 h-8 bg-slate-800 text-slate-100 rounded-full flex items-center justify-center shadow-md border border-slate-600 active:scale-90 transition-transform"
                                aria-label=${t('scan.remove_page')}
                                @click=${(e: Event) => this.removePage(it.id, e)}>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                `)}
            </div>
        `;
    }

    render() {
        return html`
            ${this.renderHiddenInput()}
            ${this.renderContent()}
        `;
    }

    renderContent() {

        const stage = this.session.stage;
        const primary = 'w-full py-4 rounded-2xl bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold text-lg shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98] min-h-[56px] disabled:opacity-50';
        const secondary = 'flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold min-h-[48px] disabled:opacity-50';

        if (stage === 'edit') {
            const review = this.importReviewTotal > 0
                    ? `${t('scan.review_title')} ${t('scan.review_pages', {current: this.importReviewIndex, total: this.importReviewTotal})}`
                    : '';
            return html`
                ${keyed(this.editorKey, html`
                    <page-editor
                            .blob=${this.captured!}
                            .initialQuad=${this.editorInitialQuad}
                            .source=${this.editorSource}
                            .reviewLabel=${review}
                            ?disableAutoDetect=${(!!this.editingPageId && this.importReviewQueue.length === 0) || !!this.editorInitialQuad}
                            @page-editor-save=${this.onEditorSave}
                            @page-editor-share=${this.onEditorShare}
                            @page-editor-cancel=${this.onEditorCancel}
                    ></page-editor>
                `)}
            `;
        }

        const title = this.replacePageId ? t('scan.retake') : (this.session.isAppend ? t('scan.add_pages') : t('scan.title'));
        return html`
            <div class="flex flex-col gap-4 pt-4 min-h-[calc(100dvh-8rem)]">
                <div class="flex items-center justify-between px-1">
                    <h1 class="text-2xl font-bold tracking-tight">${title}</h1>
                    ${!this.caps.isCapacitor ? html`
                        <label class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            ${t('scan.auto_capture')}
                            <button class="relative h-5 w-10 rounded-full transition-colors ${this.autoCapture ? 'bg-emerald-700' : 'bg-slate-700'}"
                                    aria-label=${t('scan.auto_capture')} aria-pressed=${this.autoCapture}
                                    @click=${() => {
                                        this.autoCapture = !this.autoCapture;
                                        try {
                                            localStorage.setItem(AUTO_KEY, this.autoCapture ? '1' : '0');
                                        } catch {
                                        }
                                    }}>
                                <span class="absolute top-0.5 left-0.5 ${this.autoCapture ? 'translate-x-5' : 'translate-x-0'} inline-block h-4 w-4 bg-white rounded-full transition duration-200"></span>
                            </button>
                        </label>
                    ` : null}
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}</div>` : null}

                ${stage === 'camera' ? this.renderCamera() : null}

                ${stage === 'idle' && this.session.hasPages ? html`
                    <!-- Pages so far, then what to do with them -->
                    <div class="text-sm text-slate-400 px-1">
                        ${this.docTitle ?? t('common.document')} · ${this.session.pageCount === 1 ? t('library.page_count_one') : t('library.page_count_other', {count: this.session.pageCount})}
                    </div>
                    ${this.renderStrip()}
                    <div class="mt-auto space-y-3 pb-2">
                        ${this.replacePageId ? html`
                            <button class=${primary} type="button" @click=${() => void this.exitScan()}>${t('common.cancel')}</button>
                        ` : html`
                            ${this.session.isAppend ? null : html`
                                <button class=${primary} type="button" data-testid="btn-share-pdf"
                                        ?disabled=${this.busy} @click=${() => void this.sharePdf()}>
                                    ${this.busy ? t('common.processing') : t('scan.share_pdf')}
                                </button>
                            `}
                            <div class="flex gap-3">
                                <button class=${secondary} type="button" data-testid="btn-scan-another"
                                        ?disabled=${this.busy || !this.session.canAddPage} @click=${this.onTryCameraClick}>
                                    ${t('scan.scan_another')}
                                </button>
                                <button class=${secondary} type="button" data-testid="btn-done"
                                        ?disabled=${this.busy} @click=${() => this.openDocument()}>
                                    ${this.session.isAppend ? t('scan.back_to_document') : t('scan.done')}
                                </button>
                            </div>
                            <button class="w-full py-3 text-slate-400 font-semibold hover:text-white transition-colors min-h-[44px]"
                                    type="button" ?disabled=${this.busy} @click=${this.onImportClick}>
                                ${t('scan.import_docs')}
                            </button>
                        `}
                    </div>
                ` : null}

                ${stage === 'idle' && !this.session.hasPages ? html`
                    <!-- Nothing scanned yet: one big button, no boxes -->
                    <div class="flex-1 flex flex-col items-center justify-center text-center gap-6 py-6">
                        ${this.replacePageId ? html`
                            <div class="text-sm text-slate-300">${t('scan.retake_body')}</div>
                        ` : html`
                            <svg class="w-14 h-14 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            </svg>
                            <p class="text-slate-300 max-w-xs">${this.caps.isCapacitor ? t('scan.mode_quick_desc') : t('scan.idle_hint_web')}</p>
                        `}
                    </div>
                    <div class="space-y-2 pb-2">
                        ${this.busy ? html`
                            <div class="w-full py-4 rounded-2xl border border-slate-800 bg-slate-900/70 text-slate-200 text-center font-semibold">
                                ${t('scan.importing_files')}
                            </div>
                        ` : this.showPermissionError ? html`
                            <div class="p-3 rounded-xl border border-amber-900/40 bg-amber-950/20 text-amber-200 space-y-2">
                                <div class="text-sm font-semibold">${t('scan.permission_title')}</div>
                                <div class="text-xs text-amber-100/90">${t('scan.permission_body')}</div>
                                <div class="flex gap-2 pt-1">
                                    <button class="flex-1 py-2 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-slate-950 text-sm font-semibold min-h-[44px]"
                                            type="button" @click=${this.onTryCameraClick}>${t('scan.try_again')}</button>
                                    <button class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-semibold min-h-[44px]"
                                            type="button" ?disabled=${this.busy} @click=${this.onImportClick}>${t('scan.import_files')}</button>
                                </div>
                            </div>
                        ` : html`
                            <button class=${primary} type="button" @click=${this.onTryCameraClick}>
                                ${this.caps.isCapacitor ? t('scan.start_scanner') : t('scan.open_camera')}
                            </button>
                        `}
                        <button class="w-full py-3 text-slate-400 font-semibold hover:text-white transition-colors min-h-[44px]"
                                type="button" ?disabled=${this.busy} @click=${this.onImportClick}>
                            ${t('scan.import_docs')}
                        </button>
                        ${this.session.isAppend || this.replacePageId ? html`
                            <button class="w-full py-3 text-slate-400 font-semibold hover:text-white min-h-[44px]" type="button"
                                    @click=${() => void this.exitScan()}>${this.session.exitLabel}</button>
                        ` : null}
                    </div>
                ` : null}
            </div>
        `;
    }

    /** The live camera (web only): the view, the torch, the shutter. */
    private renderCamera() {
        return html`
            <div class="space-y-6">
                <div class="aspect-[3/4] rounded-2xl overflow-hidden bg-black relative border border-slate-800">
                    <video class="w-full h-full object-cover pointer-events-none select-none" autoplay playsinline muted></video>
                    <scan-overlay class="pointer-events-none" .detected=${this.lastDetect} .quad=${this.smoothedQuad}
                                  .guidance=${this.guidance} .videoW=${this.videoW} .videoH=${this.videoH}></scan-overlay>
                    <div class="absolute inset-0 bg-white transition-opacity duration-150 pointer-events-none ${this.flashActive ? 'opacity-90' : 'opacity-0'}"></div>
                    ${this.camera.torchSupported ? html`
                        <button class="absolute top-4 right-4 p-3 rounded-full bg-black/40 backdrop-blur-xl border border-white/10"
                                aria-label=${t('scan.toggle_torch')}
                                @click=${async () => {
                                    try {
                                        await this.camera.toggleTorch();
                                        this.requestUpdate();
                                    } catch {
                                    }
                                }}>
                            <svg class="w-6 h-6 ${this.camera.torchOn ? 'text-yellow-400 fill-current' : 'text-white'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                            </svg>
                        </button>
                    ` : null}
                </div>
                <div class="flex items-center justify-between px-6">
                    <button class="p-4 text-slate-300 active:text-white min-w-[44px] min-h-[44px]" type="button"
                            aria-label=${t('scan.import_files')} ?disabled=${this.busy} @click=${this.onImportClick}>
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                    </button>
                    <button aria-label=${t('scan.capture')}
                            class="w-20 h-20 rounded-full border-4 border-white/20 p-2 active:scale-90 transition-transform bg-slate-900/50"
                            @click=${() => void this.capturePhoto()}>
                        <div class="w-full h-full rounded-full bg-white shadow-xl"></div>
                    </button>
                    <button class="p-4 text-slate-300 active:text-white min-w-[44px] min-h-[44px]" aria-label=${t('scan.done')}
                            @click=${() => void this.exitScan()}>
                        ${this.session.hasPages
                                ? html`<div class="w-10 h-10 bg-emerald-700 rounded-xl flex items-center justify-center text-white font-black text-sm">${this.session.pageCount}</div>`
                                : html`<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`}
                    </button>
                </div>
            </div>
        `;
    }

    private clearAppendKey() {
        try {
            localStorage.removeItem(APPEND_DOC_KEY);
        } catch {
        }
    }

    private getHashParams(): URLSearchParams {
        try {
            const raw = location.hash || '';
            const q = raw.includes('?') ? raw.split('?')[1] : '';
            return new URLSearchParams(q);
        } catch {
            return new URLSearchParams();
        }
    }
}

function safeGet(k: string): string | null {
    try {
        return localStorage.getItem(k);
    } catch {
        return null;
    }
}

function readBool(k: string, def: boolean): boolean {
    try {
        const v = localStorage.getItem(k);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch {
    }
    return def;
}
