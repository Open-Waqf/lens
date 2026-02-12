import {html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import type {FilterMode} from '../domain/types';
import type {Point, Quad} from '../lib/scan/quad';
import {quadArea} from '../lib/scan/quad';
import {computeOutputSize} from '../lib/image/warp';
import type {WorkerRequest, WorkerResponse} from '../lib/image/worker';
import {haptics} from '../services/haptics';
import {ImpactStyle} from "@capacitor/haptics";

export type PageEditorSaveDetail = {
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
    extractText: boolean;
};

// We define the available filters here, but the visual style is now dynamic
const FILTERS: FilterMode[] = ['original', 'magic', 'bw', 'grayscale', 'whiteboard'];

@customElement('page-editor')
export class PageEditor extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({type: Boolean}) extractText = true;
    @property({attribute: false}) blob!: Blob;
    @property({attribute: false}) filter: FilterMode = 'original';
    @property({type: Boolean}) disableAutoDetect = false;

    @state() private rotation: 0 | 90 | 180 | 270 = 0;
    @state() private busy = false;
    @state() private err: string | null = null;

    private sourceBitmap: ImageBitmap | null = null;
    private baseCanvas: HTMLCanvasElement | null = null;

    // Small thumbnail for the filter picker UI
    @state() private thumbUrl: string | null = null;

    private baseW = 0;
    private baseH = 0;
    @state() private quad: Quad | null = null;

    private _previewTimer: number | null = null;
    private _previewToken = 0;
    private worker: Worker | null = null;

    @query('canvas[data-edges]') private edgesEl!: HTMLCanvasElement;
    private dragIdx: number | null = null;
    @query('canvas[data-preview]') private previewEl!: HTMLCanvasElement;
    @query('canvas[data-magnify]') private magnifyEl!: HTMLCanvasElement;

    private history: Array<{ quad: Quad; filter: FilterMode; rotation: 0 | 90 | 180 | 270 }> = [];
    @state() private showMagnify = false;
    @state() private magnifyX = 0;
    @state() private magnifyY = 0;

    // --- Helper for CSS Filters (Visual Preview only) ---
    private getCssFilter(mode: string): string {
        switch (mode) {
            case 'grayscale':
                return 'grayscale(100%)';
            case 'bw':
                return 'grayscale(100%) contrast(150%) brightness(90%)';
            case 'magic':
                return 'contrast(110%) saturate(130%) sepia(10%)';
            case 'whiteboard':
                return 'grayscale(20%) brightness(110%) contrast(120%)';
            default:
                return 'none';
        }
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
        this.stopWorker();
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = null;
        if (this.sourceBitmap) {
            this.sourceBitmap.close();
            this.sourceBitmap = null;
        }
        super.disconnectedCallback();
    }

    updated(ch: Map<string, unknown>) {
        if (ch.has('blob')) void this.loadBlob();
        if (ch.has('filter')) this.queuePreview();
    }

    reset() {
        this.err = null;
        this.history = [];
        void this.loadBlob();
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
        this.rotation = 0;
        this.history = [];
        try {
            if (this.sourceBitmap) this.sourceBitmap.close();
            this.sourceBitmap = await createImageBitmap(this.blob);
            this.updateBaseCanvasFromSource();

            this.quad = fullQuad(this.baseW, this.baseH);
            await this.updateComplete;
            this.drawEdges();

            if (!this.disableAutoDetect) {
                void this.autoDetectEdges();
            } else {
                this.queuePreview();
            }
        } catch (e) {
            this.err = "Failed to load image";
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

        this.updateThumbUrl(c);
    }

    private updateThumbUrl(source: HTMLCanvasElement) {
        const t = document.createElement('canvas');
        // Create slightly larger thumbnail for clearer preview
        const scale = 160 / Math.max(source.width, source.height);
        t.width = source.width * scale;
        t.height = source.height * scale;
        t.getContext('2d')?.drawImage(source, 0, 0, t.width, t.height);
        this.thumbUrl = t.toDataURL('image/jpeg', 0.8);
    }

    private drawEdges(): void {
        const canvas = this.edgesEl;
        if (!canvas || !this.baseCanvas || !this.quad) return;
        const maxW = canvas.parentElement?.clientWidth ?? 320;
        const scale = Math.min(1, maxW / this.baseW);
        const w = Math.max(1, Math.round(this.baseW * scale));
        const h = Math.max(1, Math.round(this.baseH * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(this.baseCanvas, 0, 0, w, h);
        const q = this.quad;
        const sx = w / this.baseW;
        const sy = h / this.baseH;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(16,185,129,0.95)';
        ctx.fillStyle = 'rgba(16,185,129,0.95)';
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
            ctx.arc(p.x * sx, p.y * sy, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    private pickHandle(ev: PointerEvent): number | null {
        if (!this.edgesEl || !this.quad) return null;

        const rect = this.edgesEl.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;

        const canvasScaleX = this.edgesEl.width / rect.width;
        const canvasScaleY = this.edgesEl.height / rect.height;

        const clickX = x * canvasScaleX;
        const clickY = y * canvasScaleY;

        const sx = this.edgesEl.width / this.baseW;
        const sy = this.edgesEl.height / this.baseH;

        let best: { i: number; d: number } | null = null;

        for (let i = 0; i < 4; i++) {
            const p = this.quad[i];
            const px = p.x * sx;
            const py = p.y * sy;
            const d = Math.hypot(px - clickX, py - clickY);
            if (d < 40 && (!best || d < best.d)) best = {i, d};
        }
        return best ? best.i : null;
    }

    private onPointerDown = (ev: PointerEvent) => {
        if (!this.quad) return;
        const idx = this.pickHandle(ev);

        // FIX: If we didn't hit a handle, return immediately to let the browser scroll the page
        if (idx == null) return;

        // FIX: We hit a handle, so prevent scrolling to start dragging
        ev.preventDefault();

        this.pushHistory();
        this.dragIdx = idx;
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
        this.showMagnify = true;
    };

    private onPointerMove = (ev: PointerEvent) => {
        if (this.dragIdx == null || !this.quad) return;

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

    private onPointerUp = (_ev: PointerEvent) => {
        this.dragIdx = null;
        this.showMagnify = false;
        this.clearMagnifier();
    };

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

        this.busy = true;
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
            this.busy = false;
        }
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

    private async updatePreview(): Promise<void> {
        if (!this.sourceBitmap || !this.quad) return;
        const token = ++this._previewToken;
        this.busy = true;
        try {
            const mappedQuad = this.mapQuadToSource(this.quad);
            const outSize = computeOutputSize(mappedQuad);
            const maxPreview = 1400;
            const scale = Math.min(1, maxPreview / Math.max(outSize.w, outSize.h));
            const pW = Math.round(outSize.w * scale);
            const pH = Math.round(outSize.h * scale);
            const res = await this.runWorkerTask({
                id: `prev-${token}`,
                bitmap: await createImageBitmap(this.sourceBitmap),
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: pW,
                outH: pH,
                encode: false
            });
            if (token !== this._previewToken) return;
            if (!res.ok) throw new Error(res.error);
            if (!res.bitmap) throw new Error('No bitmap returned');
            const out = this.previewEl;
            if (!out) return;
            const dpr = window.devicePixelRatio || 1;
            const cw = Math.max(1, out.clientWidth || 1);
            const ch = Math.max(1, out.clientHeight || 1);
            out.width = Math.round(cw * dpr);
            out.height = Math.round(ch * dpr);
            const ctx = out.getContext('2d')!;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cw, ch);
            const s = Math.min(cw / res.width!, ch / res.height!);
            const dw = res.width! * s;
            const dh = res.height! * s;
            const dx = (cw - dw) / 2;
            const dy = (ch - dh) / 2;
            ctx.drawImage(res.bitmap, dx, dy, dw, dh);
            res.bitmap.close();
        } catch (e) {
        } finally {
            if (token === this._previewToken) this.busy = false;
        }
    }

    private async onSave(): Promise<void> {
        if (!this.sourceBitmap || !this.quad) return;
        this.err = null;
        this.busy = true;

        this.requestUpdate();
        await new Promise(r => setTimeout(r, 50));

        try {
            const mappedQuad = this.mapQuadToSource(this.quad);
            const rawSize = computeOutputSize(mappedQuad);

            const MIN_OCR_DIM = 1600;
            const MAX_DIM = 2500;

            const largestDim = Math.max(rawSize.w, rawSize.h);
            let mScale = 1;

            if (largestDim < MIN_OCR_DIM) {
                mScale = MIN_OCR_DIM / largestDim;
            } else if (largestDim > MAX_DIM) {
                mScale = MAX_DIM / largestDim;
            }

            const mW = Math.round(rawSize.w * mScale);
            const mH = Math.round(rawSize.h * mScale);

            const THUMB_MAX = 800;
            const tScale = Math.min(1, THUMB_MAX / largestDim);
            const tW = Math.round(rawSize.w * tScale);
            const tH = Math.round(rawSize.h * tScale);

            const masterTask = this.runWorkerTask({
                id: `save-m-${Date.now()}`,
                blob: this.blob,
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: mW,
                outH: mH,
                encode: true,
                quality: 0.92
            });

            const thumbTask = this.runWorkerTask({
                id: `save-t-${Date.now()}`,
                blob: this.blob,
                quad: mappedQuad,
                rotation: 0,
                filter: this.filter,
                outW: tW,
                outH: tH,
                encode: true,
                quality: 0.82
            });

            const [resM, resT] = await Promise.all([masterTask, thumbTask]);

            if (!resM.ok) throw new Error(resM.error || 'Failed to encode master');
            if (!resT.ok) throw new Error(resT.error || 'Failed to encode thumb');
            if (!resM.bytes) throw new Error('Missing master bytes');
            if (!resT.bytes) throw new Error('Missing thumb bytes');

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
        return html`
            ${this.err ? html`
                <div class="fixed top-4 left-4 right-4 z-[100] p-4 rounded-xl bg-red-950/90 backdrop-blur border border-red-900 text-red-100 shadow-xl flex items-center justify-between animate-bounce">
                    <span>${this.err}</span>
                    <button class="ml-2 font-bold" @click=${() => this.err = null}>✕</button>
                </div>` : null}

            <div class="flex flex-col min-h-dvh gap-6 p-4 pb-32 bg-black text-slate-100">

                <div class="flex flex-col gap-3">
                    <div class="flex items-center justify-between px-1">
                        <div class="text-xs font-bold text-slate-500 uppercase tracking-widest">Crop & Rotate</div>
                        <div class="flex gap-2">
                            <button class="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-bold text-slate-400 active:scale-95 transition-transform border border-slate-700 hover:text-white"
                                    ?disabled=${this.busy}
                                    @click=${() => void this.autoDetectEdges()}>
                                AUTO
                            </button>
                            <button class="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-bold text-slate-400 active:scale-95 transition-transform border border-slate-700 hover:text-white"
                                    @click=${() => this.rotate90()}>
                                ⟳ 90°
                            </button>
                            <button class="p-1.5 rounded-lg bg-slate-800 text-slate-400 active:scale-95 transition-transform border border-slate-700 hover:text-white"
                                    title="Undo"
                                    ?disabled=${this.busy || this.history.length === 0}
                                    @click=${() => this.undo()}>
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 shadow-2xl border border-slate-800">
                        <canvas data-edges class="w-full h-full object-contain select-none"
                                @pointerdown=${this.onPointerDown} @pointermove=${this.onPointerMove}
                                @pointerup=${this.onPointerUp} @pointercancel=${this.onPointerUp}></canvas>

                        <div class=${['absolute top-4 right-4 rounded-full overflow-hidden border-4 border-white shadow-2xl z-20 w-32 h-32 pointer-events-none transition-opacity duration-200', this.showMagnify ? 'opacity-100' : 'opacity-0'].join(' ')}>
                            <canvas data-magnify class="block w-full h-full bg-black"></canvas>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-3">
                    <div class="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Filter</div>
                    <div class="flex overflow-x-auto gap-3 pb-2 -mx-1 px-1 no-scrollbar snap-x">
                        ${FILTERS.map(mode => html`
                            <button @click=${() => {
                                this.pushHistory();
                                this.filter = mode;
                                this.queuePreview();
                                void haptics.impact(ImpactStyle.Light);
                            }}
                                    class="flex flex-col items-center gap-2 min-w-[70px] snap-start group relative">

                                <div class="relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all duration-200 
                                    ${this.filter === mode
                                        ? 'border-emerald-500 scale-105 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                                        : 'border-slate-800 opacity-70 group-hover:opacity-100 group-hover:border-slate-600'}">

                                    ${this.thumbUrl ? html`
                                        <img src=${this.thumbUrl}
                                             class="w-full h-full object-cover"
                                             style="filter: ${this.getCssFilter(mode)}">
                                    ` : html`
                                        <div class="w-full h-full bg-slate-900 animate-pulse"></div>`}

                                    ${this.filter === mode ? html`
                                        <div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                                            <div class="bg-emerald-500 rounded-full p-0.5 shadow-lg">
                                                <svg class="w-3 h-3 text-slate-900" fill="none" viewBox="0 0 24 24"
                                                     stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                          stroke-width="4" d="M5 13l4 4L19 7"/>
                                                </svg>
                                            </div>
                                        </div>
                                    ` : null}
                                </div>

                                <span class="text-[10px] font-bold tracking-wide uppercase transition-colors ${this.filter === mode ? 'text-emerald-400' : 'text-slate-500'}">
                                    ${mode}
                                </span>
                            </button>
                        `)}
                    </div>
                </div>

                <div class="flex flex-col gap-3">
                    <div class="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Final Result</div>
                    <div class="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 shadow-2xl border border-slate-800 group">
                        <canvas data-preview class="w-full h-full object-contain block"></canvas>
                        ${!this.sourceBitmap ? html`
                            <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                                <div class="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                                <span class="text-xs font-bold uppercase tracking-wider">Loading...</span>
                            </div>` : null}
                    </div>
                </div>

                <div class="flex flex-col gap-4 pt-2">
                    <label class="flex items-center gap-3 p-4 rounded-xl bg-slate-900/50 border border-slate-800 cursor-pointer select-none transition-colors hover:bg-slate-900">
                        <input type="checkbox"
                               class="w-5 h-5 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0"
                               .checked=${this.extractText}
                               @change=${(e: Event) => this.extractText = (e.target as HTMLInputElement).checked}>
                        <div class="flex-1">
                            <div class="text-sm font-bold text-slate-200">Extract Text (OCR)</div>
                            <div class="text-[10px] text-slate-500">Make document searchable</div>
                        </div>
                    </label>

                    <div class="flex gap-3">
                        <button class="flex-1 px-6 py-4 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 font-bold tracking-wide transition-colors"
                                ?disabled=${this.busy} @click=${this.onCancel}>
                            Back
                        </button>
                        <button class="flex-[2] px-6 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-95 transition-all text-white font-bold tracking-wide shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                ?disabled=${this.busy} @click=${() => void this.onSave()}>
                            ${this.busy
                                    ? html`
                                        <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Saving...`
                                    : 'Save Document'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

function fullQuad(w: number, h: number): Quad {
    return [{x: 0, y: 0}, {x: w - 1, y: 0}, {x: w - 1, y: h - 1}, {x: 0, y: h - 1}];
}

function rot90(p: Point, oldH: number): Point {
    return {x: (oldH - 1) - p.y, y: p.x};
}

function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
}