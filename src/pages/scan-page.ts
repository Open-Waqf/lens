import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {keyed} from 'lit/directives/keyed.js';
import {nanoid} from 'nanoid';

import type {DocRecord, PageRecord} from '../domain/types';
import {db} from '../services/db';
import {getFileStore} from '../services/filestore';

import type {DetectedQuad, Point, Quad} from '../lib/scan/quad';
import {lerpQuad, quadArea} from '../lib/scan/quad';
import {computeOutputSize, warpRgbaToCanvas} from '../lib/image/warp';
import {takePendingImport} from '../services/pending-import';
import {bytesToBlob} from '../lib/bytes';
import {processPhoto} from '../lib/image/pipeline';

import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';

type ScanStage = 'idle' | 'camera' | 'edit';

const APPEND_DOC_KEY = 'sahifah.appendToDocId';
const AUTO_KEY = 'sahifah.autoCapture';
const JUST_SAVED_DOC_KEY = 'sahifah.justSavedDocId';

type StripItem = { id: string; url: string; isNew: boolean };

@customElement('scan-page')
export class ScanPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @query('video') private videoEl!: HTMLVideoElement;
    @query('canvas[data-overlay]') private overlayEl!: HTMLCanvasElement;

    @state() private stage: ScanStage = 'idle';
    @state() private stream: MediaStream | null = null;

    @state() private appendToDocId: string | null = null;
    @state() private targetDocTitle: string | null = null;

    private currentDocId: string | null = null;

    @state() private docTitle: string | null = null;
    @state() private pageCount = 0;
    @state() private strip: StripItem[] = [];

    private newPageIds = new Set<string>();
    private committed = false;

    @state() private captured: Blob | null = null;
    @state() private editingPageId: string | null = null;

    @state() private busy = false;
    @state() private error: string | null = null;

    @state() private autoCapture = readBool(AUTO_KEY, false);

    // remount the editor to reset its internal state per page
    @state() private editorKey = 0;

    // edge detection
    private worker: Worker | null = null;
    private offscreen: HTMLCanvasElement | null = null;
    private offCtx: CanvasRenderingContext2D | null = null;
    private detecting = false;

    private lastDetect: DetectedQuad | null = null;
    private smoothedQuad: Quad | null = null;

    private stableSince = 0;
    private cooldownUntil = 0;
    private captureInFlight = false;

    // ----------------- computed helpers -----------------

    private get isAppend(): boolean {
        return !!this.appendToDocId;
    }

    private get docId(): string | null {
        return this.appendToDocId ?? this.currentDocId;
    }

    private get hasPages(): boolean {
        return this.pageCount > 0;
    }

    private get exitLabel(): string {
        if (this.isAppend) return 'Back to document';
        if (!this.docId && !this.hasPages) return 'Cancel';
        if (!this.committed && this.hasPages) return 'Discard';
        if (this.committed) return 'Back to library';
        return 'Cancel';
    }

    // ----------------- lifecycle -----------------

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        window.addEventListener('hashchange', this.onHashChange);

        await this.loadMode();

        const pending = takePendingImport();
        if (pending?.length) {
            this.appendToDocId = null;
            this.targetDocTitle = null;

            if (pending.length === 1) {
                await this.openNewBlobInEditor(pending[0]);
            } else {
                await this.batchImport(pending);
            }
        }
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this.onHashChange);

        if (this.appendToDocId) this.clearAppendKey();
        void this.stopCamera();
        this.stopDetector();
        this.revokeStrip();
        super.disconnectedCallback();
    }

    private onHashChange = () => {
        // app-root routing ignores query, so scan-page must handle "#/scan?new=1"
        const h = location.hash || '';
        if (h.startsWith('#/scan')) void this.loadMode();
    };

    // ----------------- storage helpers -----------------

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

    // ----------------- mode/load -----------------

    private async loadMode(): Promise<void> {
        const params = this.getHashParams();

        const forceNew = params.get('new') === '1';
        if (forceNew) this.clearAppendKey();

        const appendId = forceNew ? null : safeGet(APPEND_DOC_KEY);
        this.appendToDocId = appendId;
        this.currentDocId = appendId;

        this.error = null;
        this.stage = 'idle';

        // reset session state
        this.committed = false;
        this.newPageIds.clear();
        this.clearEditor();

        if (appendId) {
            const doc = await db.docs.get(appendId);
            this.targetDocTitle = doc?.title ?? 'Document';
            this.docTitle = doc?.title ?? 'Document';
            this.committed = true; // append is always "keep"
            await this.refreshDocInfo();
        } else {
            this.targetDocTitle = null;
            this.docTitle = null;
            this.pageCount = 0;
            this.revokeStrip();
        }

        if (params.get('import') === '1') {
            setTimeout(() => void this.pickFiles({multiple: true}), 0);
        }
    }

    // ----------------- exit logic -----------------

    private async exitScan(): Promise<void> {
        await this.stopCamera();

        if (this.appendToDocId) {
            const id = this.appendToDocId;
            this.clearAppendKey();
            this.appendToDocId = null;
            location.hash = `#/doc/${id}`;
            return;
        }

        const id = this.currentDocId;

        // nothing created
        if (!id || (!this.hasPages && !this.docId)) {
            // important: avoid stale "NEW" marker
            try {
                sessionStorage.removeItem(JUST_SAVED_DOC_KEY);
            } catch {
            }
            location.hash = '#/library';
            return;
        }

        // doc exists with pages but nothing committed => discard doc entirely
        if (this.hasPages && !this.committed) {
            const ok = confirm('Discard this document? Imported pages will be lost.');
            if (!ok) return;

            await this.deleteDocCompletely(id);
            this.resetAllState();

            // avoid stuck highlight from older doc
            try {
                sessionStorage.removeItem(JUST_SAVED_DOC_KEY);
            } catch {
            }

            location.hash = '#/library';
            return;
        }

        // committed => keep doc, mark just-saved for library highlight
        if (this.committed && this.hasPages) {
            try {
                sessionStorage.setItem(JUST_SAVED_DOC_KEY, id);
            } catch {
            }
        }

        location.hash = '#/library';
    }

    private resetAllState(): void {
        this.currentDocId = null;
        this.docTitle = null;
        this.pageCount = 0;
        this.revokeStrip();
        this.newPageIds.clear();
        this.committed = false;
        this.clearEditor();
        this.error = null;
        this.stage = 'idle';
    }

    private async deleteDocCompletely(docId: string): Promise<void> {
        const store = getFileStore();
        const pages = await db.pages.where('docId').equals(docId).toArray();

        for (const p of pages) {
            try {
                await store.del(p.imagePath);
            } catch {
            }
            try {
                await store.del(p.thumbPath);
            } catch {
            }
        }

        await db.pages.where('docId').equals(docId).delete();
        await db.docs.delete(docId);
    }

    private openDocument(): void {
        const id = this.docId;
        if (!id || this.pageCount === 0) return;

        if (!this.isAppend) this.committed = true;

        this.clearAppendKey();
        this.appendToDocId = null;

        location.hash = `#/doc/${id}`;
    }

    // ----------------- editor state -----------------

    private clearEditor() {
        this.captured = null;
        this.editingPageId = null;
        // invalidate editor instance
        this.editorKey++;
    }

    private async openNewBlobInEditor(blob: Blob): Promise<void> {
        this.captured = blob;
        this.editingPageId = null;
        this.stage = 'edit';
        this.editorKey++;
    }

    private async openExistingPageInEditor(pageId: string): Promise<void> {
        this.error = null;
        try {
            const page = await db.pages.get(pageId);
            if (!page) return;

            const store = getFileStore();
            const bytes = await store.get(page.imagePath);
            const blob = bytesToBlob(bytes, 'image/jpeg');

            this.captured = blob;
            this.editingPageId = pageId;
            this.stage = 'edit';
            this.editorKey++;
        } catch (e) {
            this.error = (e as Error).message;
        }
    }

    private onEditorCancel = () => {
        this.clearEditor();
        this.stage = this.stream ? 'camera' : 'idle';
    };

    private onEditorSave = async (ev: CustomEvent<PageEditorSaveDetail>) => {
        this.busy = true;
        this.error = null;

        try {
            const {master, thumb} = ev.detail;

            const docId = await this.ensureDocId();
            const store = getFileStore();

            const doc = await db.docs.get(docId);
            if (!doc) throw new Error('Doc missing');

            if (this.editingPageId) {
                const page = await db.pages.get(this.editingPageId);
                if (!page) throw new Error('Page missing');

                await store.put(page.imagePath, master.bytes, 'image/jpeg');
                await store.put(page.thumbPath, thumb.bytes, 'image/jpeg');

                await db.pages.put({
                    ...page,
                    width: master.width,
                    height: master.height,
                    rotation: 0
                });

                this.newPageIds.delete(this.editingPageId);
            } else {
                const pageId = nanoid();

                const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
                const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

                await store.put(imagePath, master.bytes, 'image/jpeg');
                await store.put(thumbPath, thumb.bytes, 'image/jpeg');

                await db.pages.add({
                    id: pageId,
                    docId,
                    imagePath,
                    thumbPath,
                    width: master.width,
                    height: master.height,
                    rotation: 0,
                    createdAt: Date.now()
                } as PageRecord);

                doc.pageIds = [...doc.pageIds, pageId];
                this.newPageIds.add(pageId);
            }

            doc.updatedAt = Date.now();
            await db.docs.put(doc);

            this.committed = true;

            this.clearEditor();
            await this.refreshDocInfo();
            this.stage = this.stream ? 'camera' : 'idle';
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    };

    // ----------------- doc bookkeeping -----------------

    private revokeStrip() {
        for (const it of this.strip) URL.revokeObjectURL(it.url);
        this.strip = [];
    }

    private async ensureDocId(): Promise<string> {
        if (this.appendToDocId) return this.appendToDocId;
        if (this.currentDocId) return this.currentDocId;

        const id = nanoid();
        const now = Date.now();
        const title = `Scan ${new Date(now).toLocaleString()}`;

        await db.docs.add({
            id,
            title,
            folder: null,
            tags: [],
            createdAt: now,
            updatedAt: now,
            pageIds: []
        } as DocRecord);

        this.currentDocId = id;
        this.docTitle = title;
        return id;
    }

    private async refreshDocInfo(): Promise<void> {
        const docId = this.docId;
        if (!docId) return;

        const doc = await db.docs.get(docId);
        if (!doc) return;

        this.docTitle = doc.title;
        this.pageCount = doc.pageIds.length;

        const N = 16;
        const ids = doc.pageIds.slice(-N);

        const pages = await db.pages.where('docId').equals(docId).toArray();
        const pageMap = new Map(pages.map((p) => [p.id, p]));
        const store = getFileStore();

        this.revokeStrip();
        const items: StripItem[] = [];

        for (const id of ids) {
            const p = pageMap.get(id);
            if (!p) continue;
            const bytes = await store.get(p.thumbPath);
            const url = URL.createObjectURL(bytesToBlob(bytes, 'image/jpeg'));
            items.push({id: p.id, url, isNew: this.newPageIds.has(p.id)});
        }

        this.strip = items;
    }

    // ----------------- camera / capture / import -----------------

    private beginCameraFromGesture(): void {
        this.error = null;
        this.stage = 'camera';

        if (this.stream) return;

        navigator.mediaDevices
            .getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false})
            .then(async (s) => {
                this.stream = s;
                await this.updateComplete;

                const v = this.videoEl;
                v.srcObject = s;
                v.onloadedmetadata = () => {
                    v.play().catch(() => {
                    });
                    this.startDetector();
                };
            })
            .catch((e) => {
                this.error = (e as Error).message ?? String(e);
                this.stage = 'idle';
            });
    }

    private async stopCamera(): Promise<void> {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.stopDetector();
    }

    private async capturePhoto(fromAuto = false): Promise<void> {
        this.error = null;
        if (this.captureInFlight) return;
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

            const det = this.lastDetect;
            const q = this.smoothedQuad;
            let finalCanvas: HTMLCanvasElement = canvas;

            if (det?.quad && q && det.confidence >= 0.65) {
                const sx = w / det.width;
                const sy = h / det.height;

                const mapped: Quad = [
                    {x: q[0].x * sx, y: q[0].y * sy},
                    {x: q[1].x * sx, y: q[1].y * sy},
                    {x: q[2].x * sx, y: q[2].y * sy},
                    {x: q[3].x * sx, y: q[3].y * sy}
                ];

                const src = ctx.getImageData(0, 0, w, h);
                const out = computeOutputSize(mapped);

                const cap = 1800;
                const s2 = Math.min(1, cap / Math.max(out.w, out.h));
                const outW = Math.max(1, Math.round(out.w * s2));
                const outH = Math.max(1, Math.round(out.h * s2));

                finalCanvas = warpRgbaToCanvas(src.data, w, h, mapped, outW, outH);
            }

            const blob: Blob = await new Promise((resolve, reject) =>
                finalCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.9)
            );

            await this.openNewBlobInEditor(blob);
        } catch (e) {
            this.error = (e as Error).message;
            if (fromAuto) this.cooldownUntil = Date.now() + 1500;
        } finally {
            this.captureInFlight = false;
        }
    }

    private async pickFiles(opts: { multiple: boolean }): Promise<void> {
        this.error = null;
        try {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = opts.multiple;

            const files: File[] = await new Promise((resolve) => {
                input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
                input.click();
            });

            if (files.length === 0) return;

            if (files.length === 1) {
                await this.openNewBlobInEditor(files[0]);
                return;
            }

            await this.batchImport(files);
        } catch (e) {
            this.error = (e as Error).message;
        }
    }

    private async batchImport(files: File[]): Promise<void> {
        this.busy = true;
        this.error = null;

        try {
            const docId = await this.ensureDocId();
            const store = getFileStore();
            const doc = await db.docs.get(docId);
            if (!doc) throw new Error('Doc missing');

            const importedPageIds: string[] = [];

            for (const file of files) {
                const {master, thumb} = await processPhoto({blob: file, rotation: 0, filter: 'original'} as any);

                const pageId = nanoid();
                importedPageIds.push(pageId);
                this.newPageIds.add(pageId);

                const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
                const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

                await store.put(imagePath, master.bytes, 'image/jpeg');
                await store.put(thumbPath, thumb.bytes, 'image/jpeg');

                await db.pages.add({
                    id: pageId,
                    docId,
                    imagePath,
                    thumbPath,
                    width: master.width,
                    height: master.height,
                    rotation: 0,
                    createdAt: Date.now()
                } as PageRecord);

                doc.pageIds.push(pageId);
            }

            doc.updatedAt = Date.now();
            await db.docs.put(doc);

            await this.refreshDocInfo();

            if (importedPageIds.length > 0) {
                await this.openExistingPageInEditor(importedPageIds[0]);
            } else {
                this.stage = this.stream ? 'camera' : 'idle';
            }
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    // ----------------- edge detection -----------------

    private startDetector(): void {
        if (this.worker) return;

        this.worker = new Worker(new URL('../lib/scan/edge-worker.ts', import.meta.url), {type: 'module'});
        this.worker.onmessage = (ev: MessageEvent<any>) => {
            const msg = ev.data;
            if (msg?.type !== 'result') return;

            this.detecting = false;

            const quad = (msg.quad as Point[] | null);
            const confidence = Number(msg.confidence ?? 0);
            const w = Number(msg.width ?? 0);
            const h = Number(msg.height ?? 0);

            const det: DetectedQuad = {quad: quad ? (quad as any) : null, confidence, width: w, height: h};
            this.lastDetect = det;

            if (det.quad && det.confidence >= 0.35) {
                const q = det.quad as Quad;
                this.smoothedQuad = this.smoothedQuad ? lerpQuad(this.smoothedQuad, q, 0.35) : q;
            } else {
                this.smoothedQuad = null;
                this.stableSince = 0;
            }

            this.drawOverlay();
            this.maybeAutoCapture();
        };

        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d', {willReadFrequently: true});

        const tick = () => {
            if (!this.worker || !this.stream || this.stage !== 'camera') return;
            this.grabAndDetect();
            setTimeout(tick, 140);
        };
        tick();
    }

    private stopDetector(): void {
        this.worker?.terminate();
        this.worker = null;
        this.detecting = false;
        this.lastDetect = null;
        this.smoothedQuad = null;
        this.stableSince = 0;
        this.cooldownUntil = 0;
        this.captureInFlight = false;
    }

    private grabAndDetect(): void {
        if (!this.worker || !this.offCtx || !this.offscreen) return;
        if (this.detecting) return;

        const v = this.videoEl;
        if (!v || v.videoWidth === 0 || v.videoHeight === 0) return;

        const maxDim = 640;
        const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * scale));
        const h = Math.max(1, Math.round(v.videoHeight * scale));

        this.offscreen.width = w;
        this.offscreen.height = h;

        this.offCtx.drawImage(v, 0, 0, w, h);
        const img = this.offCtx.getImageData(0, 0, w, h);

        this.detecting = true;
        this.worker.postMessage({type: 'detect', width: w, height: h, rgba: img.data});
    }

    private drawOverlay(): void {
        const c = this.overlayEl;
        if (!c) return;

        const v = this.videoEl;
        if (!v || v.videoWidth === 0 || v.videoHeight === 0) return;

        c.width = v.videoWidth;
        c.height = v.videoHeight;

        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);

        const det = this.lastDetect;
        const q = this.smoothedQuad;
        if (!det || !q) return;

        const sx = c.width / det.width;
        const sy = c.height / det.height;

        const conf = det.confidence;
        ctx.lineWidth = 6;
        ctx.strokeStyle = conf >= 0.65 ? 'rgba(16,185,129,0.9)' : 'rgba(234,179,8,0.9)';

        ctx.beginPath();
        ctx.moveTo(q[0].x * sx, q[0].y * sy);
        ctx.lineTo(q[1].x * sx, q[1].y * sy);
        ctx.lineTo(q[2].x * sx, q[2].y * sy);
        ctx.lineTo(q[3].x * sx, q[3].y * sy);
        ctx.closePath();
        ctx.stroke();
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
        if (!this.autoCapture) return;
        if (this.captureInFlight) return;
        if (Date.now() < this.cooldownUntil) return;
        if (this.stage !== 'camera') return;
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
            void this.capturePhoto(true);
            this.cooldownUntil = Date.now() + 1200;
            this.stableSince = 0;
        }
    }

    // ----------------- UI helpers -----------------

    private renderBanner() {
        if (this.isAppend) {
            const title = this.docTitle ?? this.targetDocTitle ?? 'Document';
            return html`
                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-400">Adding pages to</div>
                        <div class="text-sm text-slate-100 truncate">${title}</div>
                        <div class="text-xs text-slate-500">${this.pageCount} page(s)</div>
                    </div>
                    <div class="flex gap-2">
                        <button
                                class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                                ?disabled=${this.pageCount === 0}
                                @click=${() => this.openDocument()}
                        >Open
                        </button>
                        <button
                                class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                                @click=${() => void this.exitScan()}
                        >${this.exitLabel}
                        </button>
                    </div>
                </div>
            `;
        }

        if (!this.hasPages) return null;

        const title = this.docTitle ?? 'Document';
        return html`
            <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-xs text-slate-400">Building document</div>
                    <div class="text-sm text-slate-100 truncate">${title}</div>
                    <div class="text-xs text-slate-500">${this.pageCount} page(s)</div>
                </div>
                <div class="flex gap-2">
                    <button
                            class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                            ?disabled=${this.pageCount === 0}
                            @click=${() => this.openDocument()}
                    >Open
                    </button>
                    <button
                            class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                            @click=${() => void this.exitScan()}
                    >${this.exitLabel}
                    </button>
                </div>
            </div>
        `;
    }

    private renderStrip() {
        if (!this.strip.length) return null;
        const selected = this.editingPageId;

        return html`
            <div class="flex gap-2 overflow-x-auto py-1">
                ${this.strip.map(it => html`
                    <button
                            class="relative shrink-0 rounded-lg border ${selected === it.id ? 'border-emerald-500' : 'border-slate-800'} overflow-hidden ${it.isNew ? '' : 'opacity-60'}"
                            style="width: 76px; height: 96px;"
                            title=${it.isNew ? 'Edit page' : 'Locked (already saved)'}
                            @click=${() => {
                                if (!it.isNew) return;
                                void this.openExistingPageInEditor(it.id);
                            }}
                    >
                        <img src=${it.url} class="w-full h-full object-cover" alt="thumb"/>
                        ${it.isNew ? html`
                            <span class="absolute top-1 left-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-semibold">NEW</span>
                        ` : null}
                    </button>
                `)}
            </div>
        `;
    }

    // ----------------- render -----------------

    render() {
        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div class="text-lg font-semibold">${this.isAppend ? 'Add pages' : 'Scan'}</div>
                    <label class="text-xs text-slate-400 flex items-center gap-2 select-none">
                        <input
                                type="checkbox"
                                .checked=${this.autoCapture}
                                @change=${(e: Event) => {
                                    const v = (e.target as HTMLInputElement).checked;
                                    this.autoCapture = v;
                                    try {
                                        localStorage.setItem(AUTO_KEY, v ? '1' : '0');
                                    } catch {
                                    }
                                }}
                        />
                        Auto-capture
                    </label>
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}</div>
                ` : null}

                ${this.renderBanner()}
                ${this.renderStrip()}

                ${this.stage === 'idle' ? html`
                    <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                        <div class="text-sm text-slate-300">
                            ${this.isAppend ? `Adding pages to: ${this.targetDocTitle ?? 'Document'}` : 'Start a new document'}
                        </div>

                        <div class="flex gap-2">
                            <button
                                    class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                    @click=${() => this.beginCameraFromGesture()}
                            >Open camera
                            </button>

                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => this.pickFiles({multiple: true})}
                            >Import
                            </button>

                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                    @click=${() => void this.exitScan()}
                            >${this.exitLabel}
                            </button>
                        </div>
                    </div>
                ` : null}

                ${this.stage === 'camera' ? html`
                    <div class="space-y-3">
                        <div class="rounded-xl overflow-hidden border border-slate-800 bg-black relative">
                            <video class="w-full h-[60vh] object-cover" autoplay playsinline muted></video>
                            <canvas data-overlay class="absolute inset-0 w-full h-full pointer-events-none"></canvas>
                        </div>

                        <div class="flex gap-2">
                            <button
                                    class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => void this.capturePhoto(false)}
                            >Capture
                            </button>

                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => this.pickFiles({multiple: true})}
                            >Import
                            </button>

                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                    @click=${() => void this.exitScan()}
                            >${this.exitLabel}
                            </button>
                        </div>

                        <button
                                class="text-sm text-slate-300 hover:underline"
                                @click=${async () => {
                                    await this.stopCamera();
                                    this.stage = 'idle';
                                }}
                        >← Back
                        </button>
                    </div>
                ` : null}

                ${this.stage === 'edit' ? html`
                    <div class="space-y-3">
                        ${keyed(this.editorKey, html`
                            <page-editor
                                    .blob=${this.captured!}
                                    @page-editor-save=${this.onEditorSave}
                                    @page-editor-cancel=${this.onEditorCancel}
                            ></page-editor>
                        `)}

                        <div class="flex justify-end">
                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => void this.exitScan()}
                            >${this.exitLabel}
                            </button>
                        </div>
                    </div>
                ` : null}
            </div>
        `;
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
