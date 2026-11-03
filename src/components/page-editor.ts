import {html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import type {FilterMode} from '../domain/types';
import type {Point, Quad} from '../lib/scan/quad';
import {quadArea, isQuadConvex} from '../lib/scan/quad';
import {computeOutputSize} from '../lib/image/warp';
import type {WorkerRequest, WorkerResponse} from '../lib/image/worker';
import {resolveScanQualityPlan} from '../lib/image/quality';
import {haptics} from '../services/haptics';
import {ImpactStyle} from "@capacitor/haptics";
import {i18n, t} from '../lib/i18n';
import {Icons} from './icons';

export type PageEditorSaveDetail = {
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
    extractText: boolean;
};

export type PageEditorShareDetail = {
    master: { bytes: Uint8Array; width: number; height: number };
    format: 'jpg' | 'pdf';
};

// Three filters cover what people need (Nov 2026: Grayscale and Whiteboard removed).
// "Clean" is the magic filter (white paper, sharper text); Black & white suits printing.
const FILTERS: Array<{mode: FilterMode; labelKey: 'editor.filter_original' | 'editor.filter_clean' | 'editor.filter_bw'}> = [
    {mode: 'original', labelKey: 'editor.filter_original'},
    {mode: 'magic', labelKey: 'editor.filter_clean'},
    {mode: 'bw', labelKey: 'editor.filter_bw'},
];

@customElement('page-editor')
export class PageEditor extends LitElement {
    createRenderRoot() {
        return this;
    }

    connectedCallback() {
        super.connectedCallback();
        // The editor is a full-screen layer. The host element itself is that layer, so it
        // has a real size (tests and screen readers see it) and the page behind cannot scroll.
        this.classList.add('fixed', 'inset-0', 'z-40', 'flex', 'flex-col', 'bg-black', 'text-slate-100');
        this.style.paddingTop = 'env(safe-area-inset-top)';
        this.style.paddingBottom = 'env(safe-area-inset-bottom)';
    }

    @property({type: Boolean}) extractText = true;
    // Shown above the image while several imported pages are reviewed one by one ("2/5").
    @property({type: String}) reviewLabel = '';
    @property({attribute: false}) blob!: Blob;
    @property({attribute: false}) filter: FilterMode = 'original';
    @property({type: Boolean}) disableAutoDetect = false;
    @property({attribute: false}) initialQuad: Quad | null = null;
    // Where the image comes from. 'scanner' = Google's document scanner (Quick Scan): the
    // page is already found, straightened and cleaned, so it is saved as it is (no upscale,
    // no sharpening, no edge detection), unless the user picks a filter. Nov 2026.
    @property({type: String}) source: 'scanner' | 'camera' | 'file' = 'file';

    @state() private rotation: 0 | 90 | 180 | 270 = 0;
    // `busy` = saving or sharing: the only time the action buttons are disabled.
    // Edge detection and the preview do not block Save: a tap waits for them instead
    // (Nov 2026: a tap during that work used to do nothing, with no feedback).
    @state() private busy = false;
    @state() private detecting = false;
    // Crop mode: the image with its four corner handles replaces the result preview.
    @state() private cropMode = false;
    private loading: Promise<void> | null = null;
    private detection: Promise<void> | null = null;
    @state() private err: string | null = null;
    @state() private shareFormat: 'jpg' | 'pdf' = 'jpg';
    @state() private showShareSheet = false;

    private sourceBitmap: ImageBitmap | null = null;
    private baseCanvas: HTMLCanvasElement | null = null;

    private baseW = 0;
    private baseH = 0;
    @state() public quad: Quad | null = null; // Changed to public for test access

    private _previewTimer: number | null = null;
    private _previewToken = 0;
    private _containerObserver: ResizeObserver | null = null;
    private worker: Worker | null = null;

    @query('canvas[data-edges]') private edgesEl!: HTMLCanvasElement;
    private dragIdx: number | null = null;
    private dragPointerId: number | null = null;
    private scrollLockPrev: {
        bodyOverflow: string;
        bodyTouchAction: string;
        bodyOverscrollBehavior: string;
        htmlOverflow: string;
        htmlTouchAction: string;
        htmlOverscrollBehavior: string;
    } | null = null;
    @query('canvas[data-preview]') private previewEl!: HTMLCanvasElement;
    @query('canvas[data-magnify]') private magnifyEl!: HTMLCanvasElement;

    /** The crop is shown and crossed (not just "not loaded yet"). */
    private get isQuadInvalid(): boolean {
        return !!this.quad && !isQuadConvex(this.quad);
    }

    private history: Array<{ quad: Quad; filter: FilterMode; rotation: 0 | 90 | 180 | 270 }> = [];
    @state() private showMagnify = false;
    // The first preview is on the canvas. Until then the stage shows the spinner, not black.
    @state() private previewReady = false;
    @state() private magnifyX = 0;
    @state() private magnifyY = 0;

    private getCornerHandleStyle(index: number): string {
        if (!this.quad || !this.edgesEl) return 'display:none;';
        const p = this.quad[index];
        if (!p) return 'display:none;';
        // Use rendered CSS size, not backing store pixels.
        // Canvas can be visually scaled by max-h constraints; using width/height here
        // causes handles (especially bottom corners) to drift away from visible corners.
        const cssW = this.edgesEl.clientWidth || this.edgesEl.width;
        const cssH = this.edgesEl.clientHeight || this.edgesEl.height;
        const sx = cssW / this.baseW;
        const sy = cssH / this.baseH;
        const rawX = p.x * sx;
        const rawY = p.y * sy;
        // Canvas can be centered inside the stage; include its offset so
        // handles sit exactly over rendered corner points.
        const ox = this.edgesEl.offsetLeft || 0;
        const oy = this.edgesEl.offsetTop || 0;
        // The hit box is centred on the dot: the finger goes on the dot, not beside it.
        // At a canvas edge part of the box is clipped; the dot stays inside it.
        const hit = 60;
        return `left:${ox + rawX - hit / 2}px;top:${oy + rawY - hit / 2}px;`;
    }

    private pushHistory(): void {
        if (!this.quad) return;
        if (this.history.length > 80) this.history.shift();
        this.history.push({
            quad: this.quad.map(p => ({x: p.x, y: p.y})) as Quad,
            filter: this.filter,
            rotation: this.rotation
        });
    }

    private async undo(): Promise<void> {
        await new Promise(r => setTimeout(r, 50));
        const last = this.history.pop();
        if (!last) return;
        const rotChanged = last.rotation !== this.rotation;
        this.quad = last.quad;
        this.filter = last.filter;
        this.rotation = last.rotation;
        if (rotChanged) this.updateBaseCanvasFromSource();
        this.drawEdges();
        this.queuePreview();
    }

    disconnectedCallback(): void {
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        this.unlockPageScroll();
        this.stopWorker();
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = null;
        this._containerObserver?.disconnect();
        this._containerObserver = null;
        if (this.sourceBitmap) {
            this.sourceBitmap.close();
            this.sourceBitmap = null;
        }
        super.disconnectedCallback();
    }

    updated(ch: Map<string, unknown>) {
        if (ch.has('blob')) this.loading = this.loadBlob();
        if (ch.has('filter')) this.queuePreview();
        if (ch.has('cropMode')) {
            if (this.cropMode) {
                // The crop canvas is only made for crop mode, so the handles were laid out
                // before it existed. Draw it, then lay them out again over its corners.
                this.drawEdges();
                this.requestUpdate();
            } else {
                this.queuePreview();
            }
        }
    }

    private toggleCropMode(): void {
        this.cropMode = !this.cropMode;
    }

    reset() {
        this.err = null;
        this.history = [];
        this.loading = this.loadBlob();
    }

    rotate90() {
        if (!this.baseCanvas || !this.quad) return;
        this.pushHistory();
        const oldH = this.baseH;
        this.rotation = ((this.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        this.updateBaseCanvasFromSource();

        const q = this.quad;
        this.quad = [
            rot90(q[3], oldH),
            rot90(q[0], oldH),
            rot90(q[1], oldH),
            rot90(q[2], oldH),
        ];

        this.drawEdges();
        this.queuePreview();
    }

    private async loadBlob(): Promise<void> {
        this.err = null;
        this.quad = null;
        this.previewReady = false;
        this.rotation = 0;
        this.history = [];
        try {
            if (this.sourceBitmap) this.sourceBitmap.close();
            this.sourceBitmap = await createImageBitmap(this.blob);
            this.updateBaseCanvasFromSource();

            this.quad = this.initialQuad ? [...this.initialQuad] as Quad : fullQuad(this.baseW, this.baseH);
            await this.updateComplete;
            this.drawEdges();

            if (!this.disableAutoDetect && !this.initialQuad && this.source !== 'scanner') {
                this.detection = this.autoDetectEdges();
            } else {
                this.queuePreview();
                // Native scanner return can race layout; schedule bounded retries.
                window.setTimeout(() => this.queuePreview(), 140);
                window.setTimeout(() => this.queuePreview(), 280);
            }
        } catch (e) {
            this.err = t('editor.load_failed');
        }
    }

    private updateBaseCanvasFromSource(): void {
        if (!this.sourceBitmap) return;
        const img = this.sourceBitmap;
        const rot = this.rotation;
        const swap = rot === 90 || rot === 270;
        const w = swap ? img.height : img.width;
        const h = swap ? img.width : img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', {willReadFrequently: true})!;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
        this.baseCanvas = c;
        this.baseW = w;
        this.baseH = h;

    }

    private drawEdges(): void {
        const canvas = this.edgesEl;
        if (!canvas || !this.baseCanvas || !this.quad) return;
        const maxW = canvas.parentElement?.clientWidth ?? 320;
        const maxH = canvas.parentElement?.clientHeight ?? 480;
        const scale = Math.min(1, maxW / this.baseW, maxH / this.baseH);
        const cssW = Math.max(1, Math.round(this.baseW * scale));
        const cssH = Math.max(1, Math.round(this.baseH * scale));

        // Use DPR for sharpness on mobile screens
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.baseCanvas, 0, 0, canvas.width, canvas.height);

        const q = this.quad;
        const sx = canvas.width / this.baseW;
        const sy = canvas.height / this.baseH;

        const isValid = isQuadConvex(q);
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = isValid ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)';
        ctx.fillStyle = isValid ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)';

        ctx.beginPath();
        ctx.moveTo(q[0].x * sx, q[0].y * sy);
        ctx.lineTo(q[1].x * sx, q[1].y * sy);
        ctx.lineTo(q[2].x * sx, q[2].y * sy);
        ctx.lineTo(q[3].x * sx, q[3].y * sy);
        ctx.closePath();
        ctx.stroke();

        for (let i = 0; i < 4; i++) {
            const p = q[i];
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, 8 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        if (!isValid) {
            ctx.fillStyle = 'rgba(239,68,68,0.2)';
            ctx.fill();
        }
    }

    private onHandlePointerDown = (idx: number, ev: PointerEvent) => {
        if (!this.quad) return;
        this.startDraggingCorner(idx, ev);
    };

    private startDraggingCorner(idx: number, ev: PointerEvent) {
        ev.preventDefault();
        ev.stopPropagation();
        this.pushHistory();
        this.dragIdx = idx;
        this.dragPointerId = ev.pointerId;
        (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
        window.addEventListener('pointermove', this.onPointerMove, {passive: false});
        window.addEventListener('pointerup', this.onPointerUp, {passive: true});
        window.addEventListener('pointercancel', this.onPointerUp, {passive: true});
        this.lockPageScroll();
        this.showMagnify = true;
    }

    private onPointerMove = (ev: PointerEvent) => {
        if (this.dragIdx == null || !this.quad) return;
        if (this.dragPointerId != null && ev.pointerId !== this.dragPointerId) return;
        ev.preventDefault();
        const rect = this.edgesEl.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const ix = clamp((x / rect.width) * this.baseW, 0, this.baseW - 1);
        const iy = clamp((y / rect.height) * this.baseH, 0, this.baseH - 1);
        const q = [...this.quad] as Quad;
        q[this.dragIdx] = {x: ix, y: iy};
        this.quad = q;
        this.magnifyX = ix;
        this.magnifyY = iy;
        this.drawMagnifier();
        this.drawEdges();
        this.queuePreview();
    };

    private onPointerUp = (ev: PointerEvent) => {
        if (this.dragPointerId != null && ev.pointerId !== this.dragPointerId) return;
        this.dragIdx = null;
        this.dragPointerId = null;
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        this.unlockPageScroll();
        this.showMagnify = false;
        this.clearMagnifier();
    };

    private lockPageScroll(): void {
        if (this.scrollLockPrev) return;
        const bodyStyle = document.body.style;
        const htmlStyle = document.documentElement.style;
        this.scrollLockPrev = {
            bodyOverflow: bodyStyle.overflow || '',
            bodyTouchAction: bodyStyle.touchAction || '',
            bodyOverscrollBehavior: bodyStyle.overscrollBehavior || '',
            htmlOverflow: htmlStyle.overflow || '',
            htmlTouchAction: htmlStyle.touchAction || '',
            htmlOverscrollBehavior: htmlStyle.overscrollBehavior || '',
        };
        bodyStyle.overflow = 'hidden';
        bodyStyle.touchAction = 'none';
        bodyStyle.overscrollBehavior = 'none';
        htmlStyle.overflow = 'hidden';
        htmlStyle.touchAction = 'none';
        htmlStyle.overscrollBehavior = 'none';
    }

    private unlockPageScroll(): void {
        if (!this.scrollLockPrev) return;
        const bodyStyle = document.body.style;
        const htmlStyle = document.documentElement.style;
        bodyStyle.overflow = this.scrollLockPrev.bodyOverflow;
        bodyStyle.touchAction = this.scrollLockPrev.bodyTouchAction;
        bodyStyle.overscrollBehavior = this.scrollLockPrev.bodyOverscrollBehavior;
        htmlStyle.overflow = this.scrollLockPrev.htmlOverflow;
        htmlStyle.touchAction = this.scrollLockPrev.htmlTouchAction;
        htmlStyle.overscrollBehavior = this.scrollLockPrev.htmlOverscrollBehavior;
        this.scrollLockPrev = null;
    }

    private clearMagnifier(): void {
        const c = this.magnifyEl;
        if (!c) return;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
    }

    private drawMagnifier(): void {
        if (!this.showMagnify || !this.baseCanvas) return;
        const c = this.magnifyEl;
        if (!c) return;
        const size = 140;
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, size, size);
        const zoom = 5;
        const sample = Math.max(18, Math.round(size / zoom));
        const sx = clamp(this.magnifyX - sample / 2, 0, this.baseW - sample);
        const sy = clamp(this.magnifyY - sample / 2, 0, this.baseH - sample);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.baseCanvas, sx, sy, sample, sample, 0, 0, size, size);
        ctx.strokeStyle = 'rgba(16,185,129,0.95)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
        ctx.beginPath();
        ctx.moveTo(size / 2, 0);
        ctx.lineTo(size / 2, size);
        ctx.moveTo(0, size / 2);
        ctx.lineTo(size, size / 2);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    private async autoDetectEdges(): Promise<void> {
        if (!this.baseCanvas || !this.quad) return;
        this.detecting = true;
        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));
        try {
            this.startWorker();
            this.pushHistory();
            const maxDim = 640;
            const scale = Math.min(1, maxDim / Math.max(this.baseW, this.baseH));
            const w = Math.max(1, Math.round(this.baseW * scale));
            const h = Math.max(1, Math.round(this.baseH * scale));
            const tmp = document.createElement('canvas');
            tmp.width = w;
            tmp.height = h;
            const tctx = tmp.getContext('2d', {willReadFrequently: true})!;
            tctx.drawImage(this.baseCanvas, 0, 0, w, h);
            const img = tctx.getImageData(0, 0, w, h);
            const quad = await this.detectQuad(img.data, w, h);
            if (!quad) return;
            const sx = this.baseW / w;
            const sy = this.baseH / h;
            const mapped: Quad = [
                {x: quad[0].x * sx, y: quad[0].y * sy},
                {x: quad[1].x * sx, y: quad[1].y * sy},
                {x: quad[2].x * sx, y: quad[2].y * sy},
                {x: quad[3].x * sx, y: quad[3].y * sy},
            ];
            if (quadArea(mapped) / (this.baseW * this.baseH) < 0.08) return;
            this.quad = mapped;
            this.drawEdges();
            this.queuePreview();
        } finally {
            this.detecting = false;
        }
    }

    /** Wait until the image is loaded and edge detection is done, so Save uses the final crop. */
    private async settle(): Promise<void> {
        await this.loading;
        await this.detection;
    }

    private detectQuad(rgba: Uint8ClampedArray, w: number, h: number): Promise<Quad | null> {
        return new Promise((resolve) => {
            const wkr = new Worker(new URL('../lib/scan/edge-worker.ts', import.meta.url), {type: 'module'});
            const onMsg = (ev: MessageEvent<any>) => {
                const msg = ev.data;
                if (msg?.type !== 'result') return;
                wkr.terminate();
                const q = msg.quad as Point[] | null;
                if (!q || Number(msg.confidence) < 0.35) return resolve(null);
                resolve(q as Quad);
            };
            wkr.addEventListener('message', onMsg);
            wkr.postMessage({type: 'detect', width: w, height: h, rgba});
        });
    }

    private startWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL('../lib/image/worker.ts', import.meta.url), {type: 'module'});
    }

    private stopWorker() {
        this.worker?.terminate();
        this.worker = null;
    }

    private queuePreview() {
        if (!this.sourceBitmap || !this.quad) return;
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = window.setTimeout(() => void this.updatePreview(), 120);
    }

    private _waitForContainerWidth(out: HTMLCanvasElement): Promise<number> {
        return new Promise(resolve => {
            const container = out.parentElement;
            if (!container) { resolve(0); return; }
            const cw = container.clientWidth;
            if (cw >= 12) { resolve(cw); return; }
            this._containerObserver?.disconnect();
            this._containerObserver = new ResizeObserver(() => {
                const w = container.clientWidth;
                if (w >= 12) {
                    this._containerObserver?.disconnect();
                    this._containerObserver = null;
                    resolve(w);
                }
            });
            this._containerObserver.observe(container);
        });
    }

    private async updatePreview(): Promise<void> {
        if (!this.sourceBitmap || !this.quad) return;
        const token = ++this._previewToken;
        try {
            const mappedQuad = this.mapQuadToSource(this.quad);
            const outSize = computeOutputSize(mappedQuad);
            const out = this.previewEl;
            if (!out) return;

            // Wait for container to have a real layout width — fires instantly if already laid out.
            const cw = await this._waitForContainerWidth(out);
            if (!cw) return;
            const maxH = out.parentElement?.clientHeight || window.innerHeight * 0.65;

            // 2. Calculate aspect-ratio preserving dimensions
            const ratio = outSize.w / outSize.h;
            let finalW = cw;
            let finalH = cw / ratio;

            if (finalH > maxH) {
                finalH = maxH;
                finalW = finalH * ratio;
            }

            finalW = Math.round(finalW);
            finalH = Math.round(finalH);

            // 3. Set visual size (CSS) explicitly to avoid "small" rendering
            out.style.width = `${finalW}px`;
            out.style.height = `${finalH}px`;

            // 4. Set buffer size (DPR aware) for sharpness
            const dpr = window.devicePixelRatio || 1;
            out.width = Math.round(finalW * dpr);
            out.height = Math.round(finalH * dpr);

            // 5. Ask worker for a buffer that matches this resolution (or capped max)
            // We request a slightly larger buffer if possible to ensure downscaling is crisp
            const maxWorkerDim = 2048;
            const scale = Math.min(1, maxWorkerDim / Math.max(out.width, out.height));

            // We can ask worker to render at exact target scale if we pass outW/outH appropriately
            // But preserving the aspect ratio from computeOutputSize is safer.
            // We simply draw the result into our sized canvas.
            const reqW = Math.round(outSize.w * scale);
            const reqH = Math.round(outSize.h * scale);

            const res = await this.runWorkerTask({
                id: `prev-${token}`,
                bitmap: await createImageBitmap(this.sourceBitmap),
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: reqW,
                outH: reqH,
                encode: false
            });

            if (token !== this._previewToken) return;
            if (!res.ok) throw new Error(res.error);
            if (!res.bitmap) throw new Error(t('errors.editor_bitmap_missing'));

            const ctx = out.getContext('2d')!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, out.width, out.height);
            // Draw result to fill the calculated space
            ctx.drawImage(res.bitmap, 0, 0, out.width, out.height);
            res.bitmap.close();
            this.previewReady = true;
        } catch (e) {
            // worker task failed — queue one retry in case it was transient
            window.setTimeout(() => this.queuePreview(), 160);
        } finally {
            // The preview never blocks the buttons (see `busy`).
        }
    }

    private async onSave(): Promise<void> {
        if (this.busy) return;
        this.err = null;
        this.busy = true;
        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));
        try {
            await this.settle();
            if (!this.sourceBitmap || !this.quad) throw new Error(t('editor.load_failed'));
            if (!isQuadConvex(this.quad)) throw new Error(t('editor.invalid_selection'));
            const mappedQuad = this.mapQuadToSource(this.quad);
            const rawSize = computeOutputSize(mappedQuad);
            const qualityPlan = resolveScanQualityPlan({
                action: 'save',
                preset: this.source === 'scanner' ? 'original' : 'archive',
                filter: this.filter,
                rawWidth: rawSize.w,
                rawHeight: rawSize.h,
            });
            const masterTask = this.runWorkerTask({
                id: `save-m-${Date.now()}`,
                blob: this.blob,
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: qualityPlan.masterWidth,
                outH: qualityPlan.masterHeight,
                encode: true,
                quality: qualityPlan.masterJpegQuality,
                sharpenAmount: qualityPlan.sharpenAmount,
            });
            const tScale = Math.min(1, qualityPlan.thumbMax / Math.max(rawSize.w, rawSize.h));
            const tW = Math.round(rawSize.w * tScale);
            const tH = Math.round(rawSize.h * tScale);
            const thumbTask = this.runWorkerTask({
                id: `save-t-${Date.now()}`,
                blob: this.blob,
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: tW,
                outH: tH,
                encode: true,
                outputMime: 'image/webp',
                quality: qualityPlan.thumbJpegQuality,
                sharpenAmount: 0,
            });
            const [resM, resT] = await Promise.all([masterTask, thumbTask]);
            if (!resM.ok) throw new Error(resM.error || t('errors.editor_encode_master_failed'));
            if (!resT.ok) throw new Error(resT.error || t('errors.editor_encode_thumb_failed'));
            if (!resM.bytes) throw new Error(t('errors.editor_master_missing'));
            if (!resT.bytes) throw new Error(t('errors.editor_thumb_missing'));
            const detail: PageEditorSaveDetail = {
                master: {bytes: resM.bytes, width: resM.width!, height: resM.height!},
                thumb: {bytes: resT.bytes, width: resT.width!, height: resT.height!},
                extractText: this.extractText,
            };
            this.dispatchEvent(
                new CustomEvent<PageEditorSaveDetail>('page-editor-save', {detail, bubbles: true, composed: true}),
            );
        } catch (e) {
            this.err = (e as Error).message ?? String(e);
        } finally {
            this.busy = false;
        }
    }

    private async onShareNow(): Promise<void> {
        if (this.busy) return;
        this.err = null;
        this.busy = true;
        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));
        try {
            await this.settle();
            if (!this.sourceBitmap || !this.quad) throw new Error(t('editor.load_failed'));
            if (!isQuadConvex(this.quad)) throw new Error(t('editor.invalid_selection'));
            const mappedQuad = this.mapQuadToSource(this.quad);
            const rawSize = computeOutputSize(mappedQuad);
            const qualityPlan = resolveScanQualityPlan({
                action: 'share',
                preset: this.source === 'scanner' ? 'original' : 'share',
                filter: this.filter,
                rawWidth: rawSize.w,
                rawHeight: rawSize.h,
            });

            const resM = await this.runWorkerTask({
                id: `share-m-${Date.now()}`,
                blob: this.blob,
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: qualityPlan.masterWidth,
                outH: qualityPlan.masterHeight,
                encode: true,
                quality: qualityPlan.masterJpegQuality,
                sharpenAmount: qualityPlan.sharpenAmount,
            });
            if (!resM.ok) throw new Error(resM.error || t('errors.editor_encode_share_failed'));
            if (!resM.bytes) throw new Error(t('errors.editor_share_missing'));

            const detail: PageEditorShareDetail = {
                master: {bytes: resM.bytes, width: resM.width!, height: resM.height!},
                format: this.shareFormat,
            };
            this.dispatchEvent(
                new CustomEvent<PageEditorShareDetail>('page-editor-share', {detail, bubbles: true, composed: true}),
            );
        } catch (e) {
            this.err = (e as Error).message ?? String(e);
        } finally {
            this.busy = false;
        }
    }

    private async shareAs(format: 'jpg' | 'pdf'): Promise<void> {
        this.shareFormat = format;
        this.showShareSheet = false;
        await this.onShareNow();
    }

    private onCancel(): void {
        this.dispatchEvent(new CustomEvent('page-editor-cancel', {bubbles: true, composed: true}));
    }

    private mapQuadToSource(q: Quad): Quad {
        const bw = this.baseW;
        const bh = this.baseH;
        const sw = this.sourceBitmap!.width;
        const sh = this.sourceBitmap!.height;
        return q.map(p => {
            const tx = p.x - bw / 2;
            const ty = p.y - bh / 2;
            const rad = -this.rotation * (Math.PI / 180);
            const rx = tx * Math.cos(rad) - ty * Math.sin(rad);
            const ry = tx * Math.sin(rad) + ty * Math.cos(rad);
            return {x: rx + sw / 2, y: ry + sh / 2};
        }) as Quad;
    }

    private runWorkerTask(req: WorkerRequest): Promise<WorkerResponse> {
        if (!this.worker) this.startWorker();
        return new Promise(resolve => {
            const w = this.worker!;
            const onMsg = (ev: MessageEvent) => {
                if (ev.data.id === req.id) {
                    w.removeEventListener('message', onMsg);
                    resolve(ev.data);
                }
            };
            w.addEventListener('message', onMsg);
            const transfer: Transferable[] = [];
            if (req.bitmap) transfer.push(req.bitmap);
            w.postMessage(req, transfer);
        });
    }

    render() {
        const chip = (active: boolean) => `px-4 py-2 rounded-full text-sm font-semibold transition-colors min-h-[44px] ${active ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`;
        const tool = 'p-3 rounded-xl text-slate-200 hover:bg-slate-800 active:scale-95 transition-transform min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-40';
        return html`
            ${this.err ? html`
                <div class="fixed top-4 left-4 right-4 z-[100] p-4 rounded-xl bg-red-950/90 backdrop-blur border border-red-900 text-red-100 shadow-xl flex items-center justify-between">
                    <span>${this.err}</span>
                    <button aria-label=${t('editor.clear_error')} class="ml-2 font-bold" @click=${() => this.err = null}>✕</button>
                </div>` : null}

            <div class="flex-1 min-h-0 flex flex-col">
                <!-- One row of controls: back, what this is, crop tools -->
                <div class="flex items-center gap-1 px-2 py-1 shrink-0">
                    <button class=${tool} type="button" aria-label=${t('common.back')} ?disabled=${this.busy} @click=${this.onCancel}>
                        ${Icons.Back(i18n.getDirection() === 'rtl' ? 'w-6 h-6 rotate-180' : 'w-6 h-6')}
                    </button>
                    <div class="flex-1 min-w-0 text-sm font-semibold truncate">
                        ${this.cropMode ? t('editor.crop') : this.reviewLabel}
                    </div>
                    ${this.cropMode ? html`
                        <button class="px-3 py-2 rounded-xl bg-slate-800 text-xs font-bold text-slate-200 min-h-[44px]"
                                aria-label=${t('editor.auto_detect_edges')} ?disabled=${this.busy || this.detecting}
                                @click=${() => { this.detection = this.autoDetectEdges(); }}>${t('editor.auto_short')}</button>
                    ` : null}
                    <button class=${tool} type="button" aria-label=${t('editor.rotate_90')} ?disabled=${this.busy} @click=${() => this.rotate90()}>
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M20 20v-5h-5M5.6 9A8 8 0 0119 7.6M18.4 15A8 8 0 015 16.4"/></svg>
                    </button>
                    <button class=${tool} type="button" aria-label=${t('editor.undo')} title=${t('editor.undo')}
                            ?disabled=${this.busy || this.history.length === 0} @click=${() => this.undo()}>
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
                    </button>
                    ${this.cropMode ? null : html`
                        <button class=${tool} type="button" aria-label=${t('editor.crop')} ?disabled=${this.busy}
                                @click=${() => this.toggleCropMode()}>
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 3v14a1 1 0 001 1h13M3 7h14a1 1 0 011 1v13"/></svg>
                        </button>
                    `}
                </div>

                <!-- The stage: the document gets the rest of the screen -->
                <div class="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                    ${this.cropMode ? html`
                        <canvas data-edges class="max-w-full max-h-full w-auto h-auto object-contain select-none z-10"
                                style="touch-action: pan-y;"></canvas>
                        ${[0, 1, 2, 3].map(i => html`
                            <div data-testid="corner-handle-${i}"
                                 class="absolute z-[45] min-w-[60px] min-h-[60px] w-[60px] h-[60px] pointer-events-auto"
                                 style="${this.getCornerHandleStyle(i)} touch-action:none;"
                                 aria-label=${t('scan.edit_page')}
                                 @pointerdown=${(ev: PointerEvent) => this.onHandlePointerDown(i, ev)}></div>
                        `)}
                        <div class=${['absolute top-4 right-4 rounded-full overflow-hidden border-4 border-white shadow-2xl z-[45] w-32 h-32 pointer-events-none transition-opacity duration-200', this.showMagnify ? 'opacity-100' : 'opacity-0'].join(' ')}>
                            <canvas data-magnify class="block w-full h-full bg-black"></canvas>
                        </div>
                    ` : html`
                        <canvas data-preview class="block max-w-full max-h-full object-contain"
                                style="image-rendering: high-quality; backface-visibility: hidden;"></canvas>
                        ${!this.sourceBitmap || !this.previewReady ? html`
                            <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400" data-testid="editor-loading">
                                <div class="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                                <span class="text-xs font-bold uppercase tracking-wider">${t('common.loading')}</span>
                            </div>` : null}
                    `}
                    ${this.isQuadInvalid ? html`
                        <div data-testid="invalid-warning" class="absolute bottom-4 left-1/2 -translate-x-1/2 z-[45] px-4 py-2 bg-red-600/90 text-white text-xs font-bold rounded-full shadow-lg backdrop-blur-sm flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                            </svg>
                            ${t('editor.invalid_selection')}
                        </div>
                    ` : null}
                </div>

                <!-- Filters: three chips, nothing hidden -->
                ${this.cropMode ? null : html`
                    <div class="flex justify-center gap-2 px-4 py-2 shrink-0" role="group" aria-label=${t('editor.filter')}>
                        ${FILTERS.map(({mode, labelKey}) => html`
                            <button type="button" class=${chip(this.filter === mode)} aria-pressed=${this.filter === mode}
                                    @click=${() => {
                                        if (this.filter === mode) return;
                                        this.pushHistory();
                                        this.filter = mode;
                                        this.queuePreview();
                                        void haptics.impact(ImpactStyle.Light);
                                    }}>${t(labelKey)}</button>
                        `)}
                    </div>
                `}

                <!-- The main actions, always on the bottom edge -->
                <div class="flex items-center gap-2 px-4 py-2 shrink-0 border-t border-slate-800 bg-slate-950">
                    ${this.cropMode ? html`
                        <button class="flex-1 px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold min-h-[48px]"
                                type="button" ?disabled=${this.isQuadInvalid} @click=${() => this.toggleCropMode()}>
                            ${t('editor.crop_done')}
                        </button>
                    ` : html`
                        <button class="flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold min-h-[48px] flex items-center justify-center gap-2"
                                type="button" aria-label=${t('common.share_now')}
                                ?disabled=${this.busy || this.isQuadInvalid} @click=${() => this.showShareSheet = true}>
                            ${Icons.Share('w-5 h-5 block')}<span>${t('common.share_now')}</span>
                        </button>
                        <button class="flex-[1.4] px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold min-h-[48px] flex items-center justify-center gap-2 disabled:opacity-50"
                                type="button" aria-label=${t('scan.save_scan')}
                                ?disabled=${this.busy || this.isQuadInvalid} @click=${() => void this.onSave()}>
                            ${this.busy
                                    ? html`<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>`
                                    : Icons.Check('w-5 h-5 block')}
                            <span>${t('scan.save_scan')}</span>
                        </button>
                    `}
                </div>

                ${this.showShareSheet ? html`
                    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
                         @click=${() => this.showShareSheet = false}>
                        <div class="w-full p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] bg-slate-950 border-t border-slate-800 rounded-t-2xl space-y-3"
                             @click=${(e: Event) => e.stopPropagation()}>
                            <div class="text-sm font-semibold text-slate-200">${t('scan.share_as_title')}</div>
                            <button class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-100 text-sm font-medium min-h-[44px]"
                                    ?disabled=${this.busy} @click=${() => void this.shareAs('pdf')}>
                                ${t('scan.share_as_pdf')}
                            </button>
                            <button class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-100 text-sm font-medium min-h-[44px]"
                                    ?disabled=${this.busy} @click=${() => void this.shareAs('jpg')}>
                                ${t('scan.share_as_jpg')}
                            </button>
                            <button class="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-300 text-sm min-h-[44px]"
                                    @click=${() => this.showShareSheet = false}>
                                ${t('common.cancel')}
                            </button>
                        </div>
                    </div>
                ` : null}
            </div>
        `;
    }
}

function fullQuad(w: number, h: number): Quad {
    return [{x: 0, y: 0}, {x: w, y: 0}, {x: w, y: h}, {x: 0, y: h}];
}

function rot90(p: Point, oldH: number): Point {
    return {x: (oldH - 1) - p.y, y: p.x};
}

function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
}
