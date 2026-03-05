import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {keyed} from 'lit/directives/keyed.js';
import {Capacitor} from '@capacitor/core';
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
import {ConfirmModal} from '../components/confirm-modal';

import {CameraManager} from '../lib/camera/camera-manager';
import {ScanSessionState} from './scan/scan-session-state';
import {ScanRepo} from './scan/scan-repo';
import {ocrQueue} from '../services/ocr-queue';
import {AuthService} from "../services/auth-service";
import {App} from "@capacitor/app";
import {t} from '../lib/i18n';

const APPEND_DOC_KEY = 'sahifah.appendToDocId';
const AUTO_KEY = 'sahifah.autoCapture';
const JUST_SAVED_DOC_KEY = 'sahifah.justSavedDocId';
const REPLACE_PAGE_KEY = 'sahifah.replacePageId';
const WELCOME_KEY = 'sahifah.welcomeSeen';

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
    @state() private showWelcome = false;
    @state() private flashActive = false; // For visual feedback

    @state() private showPermissionError = false; // To control the error screen

    @state() private docTitle: string | null = null;
    @state() private targetDocTitle: string | null = null;

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

    private stableSince = 0;
    private cooldownUntil = 0;

    private detGov = new DetectGovernor();
    private detectLoopTimer: number | null = null;
    private detectLoopToken = 0;

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        window.addEventListener('hashchange', this.onHashChange);

        if (!localStorage.getItem(WELCOME_KEY)) {
            this.showWelcome = true;
        } else {
            await this.loadMode();
        }

        const pending = takePendingImport();
        if (pending?.length) {
            this.clearAppendKey();
            this.session.resetAll();

            this.targetDocTitle = null;
            this.docTitle = null;

            if (pending.length === 1) await this.openNewBlobInEditor(pending[0]);
            else await this.batchImport(pending);
        }
        ocrQueue.addEventListener('change', this.onOcrQueueChange);

        if (Capacitor.isNativePlatform()) {
            App.addListener('backButton', () => {
                if (this.session.stage === 'edit') {
                    void this.onEditorCancel();
                } else if (this.session.stage === 'camera') {
                    void this.exitScan();
                } else if (location.hash !== '#/library') {
                    location.hash = '#/library';
                }
            });

            // PAUSE CV ON BACKGROUND
            App.addListener('appStateChange', (state) => {
                if (!state.isActive) {
                    console.log('[ScanPage] App backgrounded, pausing detector');
                    this.stopDetector();
                } else if (this.session.stage === 'camera') {
                    console.log('[ScanPage] App resumed, restarting detector');
                    this.startDetector();
                }
            });
        }
    }

    private async removePage(pageId: string, e?: Event) {
        if (e) e.stopPropagation(); // Stop the click from opening the editor

        // Optional: Confirm before deleting to prevent accidents
        const ok = await ConfirmModal.ask({
            title: t('scan.delete_scan'),
            description: t('scan.delete_body'),
            confirm: t('common.delete'),
            destructive: true
        });
        if (!ok) return;

        try {
            await this.repo.deletePage(pageId);
            this.newPageIds.delete(pageId);

            // 1. Refresh to see what's left
            await this.refreshDocInfo();

            // 2. Handle Empty State (Go back to Start)
            if (this.session.pageCount === 0) {
                this.clearEditor();
                this.session.setStage('idle');
                return;
            }

            // 3. Handle Multi-Page State
            // If we deleted the page we were looking at, switch to the new first page.
            if (this.editingPageId === pageId) {
                const newFirstPage = this.strip[0];
                if (newFirstPage) {
                    await this.openExistingPageInEditor(newFirstPage.id);
                } else {
                    this.session.setStage('camera'); // Fallback
                }
            }
            // If we deleted a background page, stay where we are (strip is already updated)

        } catch (e) {
            console.error("Failed to delete page", e);
        }
    }

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
        super.disconnectedCallback();
    }

    private onHashChange = () => {
        const h = location.hash || '';
        if (h.startsWith('#/scan')) void this.loadMode();
    };

    private async finishWelcome() {
        localStorage.setItem(WELCOME_KEY, '1');
        this.showWelcome = false;
        await this.loadMode();
        // User clicked "Start", so this is explicit
        this.beginCameraFromGesture(true);
    }

    private async loadMode(): Promise<void> {
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

        this.targetDocTitle = null;
        this.docTitle = null;

        if (appendId) {
            const doc = await this.repo.getDoc(appendId);
            this.targetDocTitle = doc?.title ?? t('common.document');
            this.docTitle = doc?.title ?? t('common.document');
            this.session.markCommitted();
            await this.refreshDocInfo();
        } else {
            this.session.setPageCount(0);
        }

        if (params.get('import') === '1') {
            setTimeout(() => void this.pickFiles({multiple: !this.replacePageId}), 0);
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

        if (decision.kind === 'confirm-discard') {
            const ok = await ConfirmModal.ask({
                title: t('scan.discard_scan'),
                description: decision.message,
                confirm: t('common.discard'),
                destructive: true
            });
            if (!ok) return;

            await this.repo.deleteDocCompletely(decision.docId);
            this.session.resetAll();
            this.revokeStrip();
            this.newPageIds.clear();
            this.clearEditor();
            location.hash = '#/library';
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

        if (!this.session.isAppend) this.session.markCommitted();
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

    private async openNewBlobInEditor(blob: Blob, initialQuad: Quad | null = null): Promise<void> {
        this.showPermissionError = false;
        await this.stopCamera();
        this.captured = blob;
        this.editingPageId = null;
        this.editorInitialQuad = initialQuad;
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
            this.session.setStage('edit');
            this.editorKey++;
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
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

        try {
            const {master, thumb, extractText} = ev.detail;
            const docId = await this.ensureDocId();

            const targetId = this.editingPageId || this.replacePageId;

            if (targetId) {
                await this.repo.updateExistingPage(targetId, master, thumb, extractText);
                if (this.editingPageId) this.newPageIds.delete(this.editingPageId);
                this.selectedPageId = targetId;

                if (this.replacePageId) {
                    this.replacePageId = null;
                    localStorage.removeItem(REPLACE_PAGE_KEY);
                    await this.exitScan();
                    return;
                }
            } else {
                const pageId = await this.repo.addNewPage(docId, master, thumb, extractText);
                this.newPageIds.add(pageId);
                this.selectedPageId = pageId;
            }

            this.session.markCommitted();
            await this.refreshDocInfo();

            if (this.editingPageId && this.importReviewQueue.length > 0 && this.importReviewQueue[0] === this.editingPageId) {
                this.importReviewQueue.shift(); // Remove the one we just saved
                const nextId = this.importReviewQueue[0]; // Peek next

                if (nextId) {
                    this.importReviewIndex = this.importReviewTotal - this.importReviewQueue.length + 1;
                    await new Promise(r => setTimeout(r, 50));
                    await this.openExistingPageInEditor(nextId);
                    return; // RETURN EARLY to prevent falling through to clearEditor
                } else {
                    // Queue is done
                    this.clearImportReview();
                }
            }

            this.clearEditor();
            if (this.importReviewQueue.length === 0) {
                this.session.setStage('idle');
            }
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
        } finally {
            this.busy = false;
        }
    };

    private revokeStrip() {
        for (const it of this.strip) URL.revokeObjectURL(it.url);
        this.strip = [];
    }

    private async ensureDocId(): Promise<string> {
        if (this.session.docId) return this.session.docId;

        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
        const timeStr = now.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
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
            const url = URL.createObjectURL(bytesToBlob(it.thumbBytes, 'image/jpeg'));
            items.push({id: it.id, url, isNew: this.newPageIds.has(it.id)});
        }
        this.strip = items;
    }

    // UPDATED: Added explicit flag to handle the regression
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
                    this.error = (e as Error).message ?? String(e);
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
        AuthService.setIgnoreNextResume(true);
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
                if (files.length === 1) await this.openNewBlobInEditor(files[0]);
                else await this.batchImport(files);
            }
        } catch (e) {
        } finally {
            AuthService.setIgnoreNextResume(false);
            this.busy = false;
        }
    }

    private async stopCamera(): Promise<void> {
        await this.camera.stop();
    }

    private async capturePhoto(): Promise<void> {
        this.error = null;
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

            // CRITICAL FIX: If no document found (e.g. face), force FULL IMAGE crop
            if (!detectedQuadForEditor) {
                detectedQuadForEditor = [
                    {x: 0, y: 0}, {x: w, y: 0},
                    {x: w, y: h}, {x: 0, y: h}
                ];
            }

            const blob: Blob = await new Promise((resolve, reject) =>
                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('scan.capture_failed')))), 'image/jpeg', 0.95),
            );

            await this.openNewBlobInEditor(blob, detectedQuadForEditor);
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
        } finally {
            this.captureInFlight = false;
        }
    }

    private async pickFiles(opts: { multiple: boolean }): Promise<void> {
        this.error = null;

        // Use the input rendered in the DOM for better reliability
        const input = this.renderRoot.querySelector('#import-input') as HTMLInputElement;

        if (!input) {
            this.error = t('scan.import_unavailable');
            return;
        }

        input.multiple = opts.multiple;
        input.value = ''; // Reset value to allow selecting same file twice

        AuthService.setIgnoreNextResume(true);
        // We use a one-time promise wrapper for the change event
        return new Promise((resolve) => {
            const handler = async () => {
                input.removeEventListener('change', handler); // Cleanup
                const files = input.files ? Array.from(input.files) : [];

                if (files.length === 0) {
                    resolve();
                    return;
                }

                this.showPermissionError = false;

                if (files.length === 1) await this.openNewBlobInEditor(files[0]);
                else await this.batchImport(files);
                resolve();
            };

            input.addEventListener('change', handler);
            input.click();
        });
    }

    private async batchImport(files: File[]): Promise<void> {
        this.busy = true;
        this.error = null;
        try {
            const docId = await this.ensureDocId();

            if (this.replacePageId && files.length > 0) {
                const {master, thumb} = await processPhoto({blob: files[0], rotation: 0, filter: 'original'} as any);
                await this.repo.updateExistingPage(this.replacePageId, master, thumb);
                this.replacePageId = null;
                localStorage.removeItem(REPLACE_PAGE_KEY);
                await this.exitScan();
                return;
            }

            const importedPageIds: string[] = [];
            for (const file of files) {
                const {master, thumb} = await processPhoto({blob: file, rotation: 0, filter: 'original'} as any);
                const pageId = await this.repo.addNewPage(docId, master, thumb);
                importedPageIds.push(pageId);
                this.newPageIds.add(pageId);
            }
            await this.refreshDocInfo();
            if (importedPageIds.length > 0) {
                this.importReviewQueue = importedPageIds.slice();
                this.importReviewTotal = importedPageIds.length;
                this.importReviewIndex = 1;
                await this.openExistingPageInEditor(importedPageIds[0]);
            } else {
                this.session.setStage(this.camera.isRunning ? 'camera' : 'idle');
            }
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
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
            void this.capturePhoto();
            this.cooldownUntil = Date.now() + 1200;
            this.stableSince = 0;
        }
    }

    private renderHiddenInput() {
        return html`
            <input type="file"
                   id="import-input"
                   accept="image/jpeg,image/png,image/webp,application/pdf"
                   multiple
                   style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;">
        `;
    }

    private renderBanner() {
        if (this.replacePageId) {
            return html`
                <div class="p-3 rounded-xl border border-amber-900 bg-amber-950 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-sm font-bold text-amber-100">${t('scan.retake_mode')}</div>
                        <div class="text-xs text-amber-200/70">${t('scan.retake_body')}</div>
                    </div>
                    <button class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                            @click=${() => void this.exitScan()}>
                        ${t('common.cancel')}
                    </button>
                </div>
            `;
        }

        if (this.session.isAppend) {
            const title = this.docTitle ?? this.targetDocTitle ?? t('common.document');
            return html`
                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-400">${t('scan.adding_to')}</div>
                        <div class="text-sm text-slate-100 truncate">${title}</div>
                        <div class="text-xs text-slate-500">${this.session.pageCount} page(s)</div>
                    </div>
                    <div class="flex gap-2">
                        <button class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                                ?disabled=${this.session.pageCount === 0} @click=${() => this.openDocument()}>
                            ${t('common.open')}
                        </button>
                        <button class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                                @click=${() => void this.exitScan()}>
                            ${this.session.exitLabel}
                        </button>
                    </div>
                </div>
            `;
        }
        if (!this.session.hasPages) return null;
        const title = this.docTitle ?? t('common.document');
        return html`
            <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-xs text-slate-400">${t('scan.building_doc')}</div>
                    <div class="text-sm text-slate-100 truncate">${title}</div>
                    <div class="text-xs text-slate-500">${this.session.pageCount} page(s)</div>
                </div>
                <div class="flex gap-2">
                    <button class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                            ?disabled=${this.session.pageCount === 0} @click=${() => this.openDocument()}>
                        ${t('common.open')}
                    </button>
                    <button class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                            @click=${() => void this.exitScan()}>
                        ${this.session.exitLabel}
                    </button>
                </div>
            </div>
        `;
    }

    private renderStrip() {
        if (!this.strip.length) return null;
        const selected = this.editingPageId || this.selectedPageId;

        return html`
            <div class="flex gap-4 overflow-x-auto py-3 px-4 no-scrollbar snap-x items-start">
                ${this.strip.map((it, idx) => html`
                    <div class="relative shrink-0 snap-center group pt-2">

                        <button class="relative block rounded-lg border ${selected === it.id ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-800'} overflow-hidden transition-all active:scale-95 bg-black"
                                style="width: 84px; height: 108px;"
                                title="Edit page"
                                @click=${() => void this.openExistingPageInEditor(it.id)}>

                            <img src=${it.url} class="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                                 alt="thumb"/>

                            <div class="absolute bottom-1 right-1 text-[9px] font-bold text-white bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm">
                                ${idx + 1}
                            </div>

                            ${it.isNew ? html`
                                <span class="absolute top-1 left-1 text-[8px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold shadow-sm">${t('common.new')}</span>
                            ` : null}
                        </button>

                        <button class="absolute top-0 right-[-6px] w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md z-10 active:scale-90 transition-transform border-2 border-slate-950"
                                @click=${(e: Event) => this.removePage(it.id, e)}>
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                      d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                `)}
            </div>
        `;
    }

    private renderWelcome() {
        return html`
            <div class="min-h-full flex flex-col items-center justify-center py-10 text-center space-y-8 animate-in fade-in duration-500">
                <div class="space-y-4">
                    <div class="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </div>
                    <h1 class="text-3xl font-bold text-slate-100">${t('scan.welcome_title')}</h1>
                    <p class="text-slate-400 max-w-xs mx-auto text-lg">
                        ${t('scan.welcome_body')}
                    </p>
                </div>

                <div class="space-y-4 max-w-xs w-full">
                    <div class="flex items-start gap-3 text-left text-sm text-slate-300 bg-slate-900/50 p-4 rounded-xl">
                        <svg class="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor"
                             viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                        <span .innerHTML=${t('scan.welcome_security')}></span>
                    </div>

                    <button class="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg shadow-lg shadow-emerald-900/20"
                            @click=${() => this.finishWelcome()}>
                        ${t('scan.start_scanning')}
                    </button>
                </div>
            </div>
        `;
    }

    private renderPermissionUI() {
        return html`
            <div class="flex flex-col items-center justify-center py-10 px-6 text-center space-y-8 min-h-full">
                <div class="w-20 h-20 bg-red-900/20 text-red-500 rounded-full flex items-center justify-center shadow-inner">
                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                </div>

                <div class="space-y-2">
                    <h2 class="text-2xl font-bold text-slate-100">${t('scan.permission_title')}</h2>
                    <p class="text-slate-400 text-sm leading-relaxed">
                        ${t('scan.permission_body')}
                    </p>
                </div>

                <div class="flex flex-col gap-3 w-full max-w-xs">
                    <button class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all"
                            @click=${() => this.beginCameraFromGesture(true)}>
                        ${t('scan.try_again')}
                    </button>

                    <button class="w-full py-3 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-xl font-bold transition-all"
                            ?disabled=${this.busy}
                            @click=${() => this.pickFiles({multiple: !this.replacePageId})}>
                        ${t('scan.import_files')}
                    </button>

                    <button class="w-full py-3 text-slate-500 hover:text-slate-300 font-medium transition-all"
                            @click=${() => {
                                this.showPermissionError = false;
                                this.session.setStage('idle');
                            }}>
                        ${t('scan.go_back')}
                    </button>
                </div>
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
        if (this.showWelcome) return this.renderWelcome();
        if (this.showPermissionError) return this.renderPermissionUI();

        const stage = this.session.stage;
        return html`
            <div class="space-y-4 pt-6">
                <div class="flex items-center justify-between px-1">
                    <div class="text-2xl font-bold tracking-tight">
                        ${this.replacePageId ? t('scan.retake') : (this.session.isAppend ? t('scan.add_pages') : t('scan.title'))}
                    </div>
                    ${!this.caps.isCapacitor ? html`
                        <div class="flex items-center gap-3 bg-slate-900/80 px-4 py-1.5 rounded-full border border-slate-800">
                            <span class="text-[10px] font-bold uppercase tracking-widest text-slate-500">${t('scan.auto_capture')}</span>
                            <button class="relative h-5 w-10 rounded-full transition-colors ${this.autoCapture ? 'bg-emerald-600' : 'bg-slate-700'}"
                                    @click=${() => {
                                        this.autoCapture = !this.autoCapture;
                                        try {
                                            localStorage.setItem(AUTO_KEY, this.autoCapture ? '1' : '0');
                                        } catch {
                                        }
                                    }}>
                                <span class="sr-only">${t('scan.auto_capture')}</span>
                                <span class="absolute top-0.5 left-0.5 ${this.autoCapture ? 'translate-x-5' : 'translate-x-0'} inline-block h-4 w-4 bg-white rounded-full transition duration-200"></span>
                            </button>
                        </div>
                    ` : null}
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}
                    </div>` : null}

                ${this.renderBanner()} ${this.renderStrip()}

                ${stage === 'idle' ? html`
                    <div class="p-10 border-2 border-dashed border-slate-800 rounded-[2.5rem] flex flex-col items-center justify-center space-y-8 bg-slate-900/10">
                        <div class="w-20 h-20 bg-emerald-950/30 text-emerald-500 rounded-3xl flex items-center justify-center">
                            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                            </svg>
                        </div>
                        <div class="w-full space-y-3">
                            <button class="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-[1.5rem] font-bold text-xl shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
                                    @click=${() => this.beginCameraFromGesture(true)}>
                                ${this.caps.isCapacitor ? t('scan.start_scanner') : t('scan.open_camera')}
                            </button>
                            <button class="w-full py-4 text-slate-400 font-semibold hover:text-white transition-colors"
                                    ?disabled=${this.busy}
                                    @click=${() => this.pickFiles({multiple: !this.replacePageId})}>
                                ${t('scan.import_docs')}
                            </button>
                        </div>
                    </div>
                ` : null}

                ${stage === 'camera' ? html`
                    <div class="space-y-8">
                        <div class="aspect-[3/4] rounded-[2.5rem] overflow-hidden bg-black relative border border-slate-800 shadow-2xl">
                            <video class="w-full h-full object-cover" autoplay playsinline muted></video>

                            <scan-overlay
                                    .detected=${this.lastDetect}
                                    .quad=${this.smoothedQuad}
                                    .guidance=${this.guidance}
                                    .videoW=${this.videoW}
                                    .videoH=${this.videoH}>
                            </scan-overlay>

                            <div class="absolute inset-0 bg-white transition-opacity duration-150 pointer-events-none ${this.flashActive ? 'opacity-90' : 'opacity-0'}"></div>

                            ${this.camera.torchSupported ? html`
                                <button class="absolute top-6 right-6 p-4 rounded-full bg-black/40 backdrop-blur-xl border border-white/10"
                                        @click=${async () => {
                                            try {
                                                await this.camera.toggleTorch();
                                                this.requestUpdate();
                                            } catch {
                                            }
                                        }}>
                                    <svg class="w-6 h-6 ${this.camera.torchOn ? 'text-yellow-400 fill-current' : 'text-white'}"
                                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                    </svg>
                                </button>
                            ` : null}
                        </div>

                        <div class="flex items-center justify-between px-10 pb-10">
                            <button class="p-5 text-slate-400 active:text-white"
                                    ?disabled=${this.busy}
                                    @click=${() => this.pickFiles({multiple: !this.replacePageId})}>
                                <svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                </svg>
                            </button>

                            <button aria-label="Capture"
                                    class="w-24 h-24 rounded-full border-4 border-white/20 p-2 active:scale-90 transition-transform bg-slate-900/50"
                                    @click=${() => void this.capturePhoto()}>
                                <div class="w-full h-full rounded-full bg-white shadow-xl"></div>
                            </button>

                            <button class="p-5 text-slate-400 active:text-white"
                                    @click=${() => void this.exitScan()}>
                                ${this.session.hasPages
                                        ? html`
                                            <div class="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/20">
                                                ${this.session.pageCount}
                                            </div>`
                                        : html`
                                            <svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M6 18L18 6M6 6l12 12"></path>
                                            </svg>`}
                            </button>
                        </div>
                    </div>
                ` : null}

                ${stage === 'edit' ? html`
                    <div class="space-y-3 pb-24">
                        ${this.importReviewTotal > 0 ? html`
                            <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 text-slate-200 flex items-center justify-between gap-3">
                                <div class="text-sm">${t('scan.review_title')} <span
                                        class="text-slate-400">${t('scan.review_pages', {
                                            current: this.importReviewIndex,
                                            total: this.importReviewTotal
                                        })}</span></div>
                                <div class="text-xs text-slate-400">${t('scan.review_save_continue')}</div>
                            </div>` : null}
                        ${keyed(this.editorKey, html`
                            <page-editor
                                    .blob=${this.captured!}
                                    .initialQuad=${this.editorInitialQuad}
                                    ?disableAutoDetect=${!!this.editingPageId || !!this.editorInitialQuad}
                                    @page-editor-save=${this.onEditorSave}
                                    @page-editor-cancel=${this.onEditorCancel}
                            ></page-editor>
                        `)}
                        <div class="flex justify-end mt-6 pb-10">
                            <button class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60 min-h-[44px]"
                                    ?disabled=${this.busy} @click=${() => void this.exitScan()}>
                                ${this.session.exitLabel}
                            </button>
                        </div>
                    </div>
                ` : null}
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
