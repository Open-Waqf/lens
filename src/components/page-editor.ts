import {html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';

import type {FilterMode} from '../domain/types';
import type {Point, Quad} from '../lib/scan/quad';
import {quadArea} from '../lib/scan/quad';
import {computeOutputSize, warpRgbaToCanvas} from '../lib/image/warp';
import {adaptiveBwFromRgba} from '../lib/image/adaptive-bw';
import {magicColorFromRgba} from '../lib/image/magic-filter';

type Encoded = { bytes: Uint8Array; width: number; height: number };

export type PageEditorSaveDetail = {
    master: Encoded;
    thumb: Encoded;
};

@customElement('page-editor')
export class PageEditor extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({attribute: false}) blob!: Blob;
    @property({attribute: false}) filter: FilterMode = 'original';

    @state() private rotation: 0 | 90 | 180 | 270 = 0;

    @state() private busy = false;
    @state() private err: string | null = null;

    private baseCanvas: HTMLCanvasElement | null = null;
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

    private pushHistory(): void {
        if (!this.quad) return;
        if (this.history.length > 80) this.history.shift();
        this.history.push({
            quad: this.quad.map(p => ({x: p.x, y: p.y})) as Quad,
            filter: this.filter,
            rotation: this.rotation
        });
    }

    private undo(): void {
        const last = this.history.pop();
        if (!last) return;
        this.quad = last.quad;
        this.filter = last.filter;
        // Restore rotation if we had the mechanism, but for now just quad/filter
        this.drawEdges();
        this.queuePreview();
    }

    disconnectedCallback(): void {
        this.stopWorker();
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = null;
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
        void this.applyRotate90();
    }

    private async loadBlob(): Promise<void> {
        this.err = null;
        this.quad = null;
        this.rotation = 0;
        this.history = [];

        const img = await blobToImageBitmap(this.blob);

        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d', {willReadFrequently: true})!.drawImage(img, 0, 0);

        this.baseCanvas = c;
        this.baseW = img.width;
        this.baseH = img.height;

        this.quad = fullQuad(this.baseW, this.baseH);

        await this.updateComplete;
        this.drawEdges();
        void this.autoDetectEdges();
        this.queuePreview();
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
        const sx = this.edgesEl.width / this.baseW;
        const sy = this.edgesEl.height / this.baseH;

        let best: { i: number; d: number } | null = null;
        for (let i = 0; i < 4; i++) {
            const p = this.quad[i];
            const px = p.x * sx;
            const py = p.y * sy;
            const d = Math.hypot(px - x, py - y);
            if (d < 18 && (!best || d < best.d)) best = {i, d};
        }
        return best ? best.i : null;
    }

    private onPointerDown = (ev: PointerEvent) => {
        if (!this.quad) return;
        const idx = this.pickHandle(ev);
        if (idx == null) return;
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
        const ix = clamp((x / this.edgesEl.width) * this.baseW, 0, this.baseW - 1);
        const iy = clamp((y / this.edgesEl.height) * this.baseH, 0, this.baseH - 1);
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
    }

    private async autoDetectEdges(): Promise<void> {
        if (!this.baseCanvas || !this.quad) return;
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
    }

    private detectQuad(rgba: Uint8ClampedArray, w: number, h: number): Promise<Quad | null> {
        return new Promise((resolve) => {
            if (!this.worker) return resolve(null);
            const onMsg = (ev: MessageEvent<any>) => {
                if (ev.data?.type !== 'result') return;
                this.worker?.removeEventListener('message', onMsg);
                const q = ev.data.quad as Point[] | null;
                if (!q || Number(ev.data.confidence) < 0.35) return resolve(null);
                resolve(q as Quad);
            };
            this.worker.addEventListener('message', onMsg);
            this.worker.postMessage({type: 'detect', width: w, height: h, rgba});
        });
    }

    private startWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL('../lib/scan/edge-worker.ts', import.meta.url), {type: 'module'});
    }

    private stopWorker() {
        this.worker?.terminate();
        this.worker = null;
    }

    private async applyRotate90(): Promise<void> {
        if (!this.baseCanvas) return;
        this.pushHistory();
        const src = this.baseCanvas;
        const out = document.createElement('canvas');
        out.width = src.height;
        out.height = src.width;
        const ctx = out.getContext('2d', {willReadFrequently: true})!;
        ctx.translate(out.width / 2, out.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(src, -src.width / 2, -src.height / 2);
        const oldH = this.baseH;
        this.baseCanvas = out;
        this.baseW = out.width;
        this.baseH = out.height;
        this.rotation = (((this.rotation + 90) % 360) as any);
        if (this.quad) {
            this.quad = [
                rot90(this.quad[0], oldH),
                rot90(this.quad[1], oldH),
                rot90(this.quad[2], oldH),
                rot90(this.quad[3], oldH),
            ];
        } else {
            this.quad = fullQuad(this.baseW, this.baseH);
        }
        await this.updateComplete;
        this.drawEdges();
        this.queuePreview();
    }

    private queuePreview() {
        if (!this.baseCanvas || !this.quad) return;
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = window.setTimeout(() => void this.updatePreview(), 120);
    }

    private async updatePreview(): Promise<void> {
        if (!this.baseCanvas || !this.quad) return;
        const token = ++this._previewToken;
        this.busy = true;
        try {
            const previewCanvas = await this.renderFlattenedCanvas(1400);
            if (token !== this._previewToken) return;
            await this.updateComplete;
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
            const s = Math.min(cw / previewCanvas.width, ch / previewCanvas.height);
            const dw = previewCanvas.width * s;
            const dh = previewCanvas.height * s;
            const dx = (cw - dw) / 2;
            const dy = (ch - dh) / 2;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(previewCanvas, dx, dy, dw, dh);
        } catch {
        } finally {
            if (token === this._previewToken) this.busy = false;
        }
    }

    private async renderFlattenedCanvas(maxDim: number): Promise<HTMLCanvasElement> {
        const src = this.baseCanvas!;
        const srcW = this.baseW;
        const srcH = this.baseH;
        const q = this.quad!;
        const out0 = computeOutputSize(q);
        const s = Math.min(1, maxDim / Math.max(out0.w, out0.h));
        const outW = Math.max(1, Math.round(out0.w * s));
        const outH = Math.max(1, Math.round(out0.h * s));
        const ctx = src.getContext('2d', {willReadFrequently: true})!;
        const img = ctx.getImageData(0, 0, srcW, srcH);

        // Warp first (Main thread for now, need worker in future fix)
        const warped = warpRgbaToCanvas(img.data, srcW, srcH, q, outW, outH);

        // Apply Filters
        if (this.filter !== 'original') {
            const wctx = warped.getContext('2d', {willReadFrequently: true})!;
            const data = wctx.getImageData(0, 0, warped.width, warped.height);

            if (this.filter === 'grayscale') {
                grayscaleInPlace(data.data);
            } else if (this.filter === 'bw') {
                const bw = adaptiveBwFromRgba(data.data, warped.width, warped.height);
                data.data.set(new Uint8ClampedArray(bw));
            } else if (this.filter === 'magic') {
                const magic = magicColorFromRgba(data.data, warped.width, warped.height);
                data.data.set(new Uint8ClampedArray(magic));
            }

            wctx.putImageData(data, 0, 0);
        }
        return warped;
    }

    private async encode(masterMax = 2200, thumbMax = 360): Promise<PageEditorSaveDetail> {
        const masterCanvas = await this.renderFlattenedCanvas(masterMax);
        const thumbCanvas = resizeCanvas(masterCanvas, thumbMax);
        const [masterBytes, thumbBytes] = await Promise.all([
            canvasToJpegBytes(masterCanvas, 0.86),
            canvasToJpegBytes(thumbCanvas, 0.82),
        ]);
        return {
            master: {bytes: masterBytes, width: masterCanvas.width, height: masterCanvas.height},
            thumb: {bytes: thumbBytes, width: thumbCanvas.width, height: thumbCanvas.height},
        };
    }

    private async onSave(): Promise<void> {
        this.err = null;
        this.busy = true;
        try {
            const detail = await this.encode();
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

    render() {
        return html`
            ${this.err ? html`
                <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.err}</div>` : null}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="text-sm font-medium text-slate-200">Edges</div>
                        <div class="flex gap-2">
                            <button class="px-3 py-2 rounded-xl bg-slate-800 text-sm" ?disabled=${this.busy}
                                    @click=${() => void this.autoDetectEdges()}>Auto
                            </button>
                            <button class="px-3 py-2 rounded-xl bg-slate-800 text-sm"
                                    ?disabled=${this.busy || this.history.length === 0} @click=${() => this.undo()}>Undo
                            </button>
                        </div>
                    </div>
                    <div class="rounded-xl overflow-hidden border border-slate-800 bg-black relative">
                        <canvas data-edges class="w-full h-auto touch-none select-none"
                                @pointerdown=${this.onPointerDown} @pointermove=${this.onPointerMove}
                                @pointerup=${this.onPointerUp} @pointercancel=${this.onPointerUp}></canvas>
                        <div class=${['absolute top-2 right-2 rounded-xl overflow-hidden border border-slate-800 bg-black shadow-lg', this.showMagnify ? '' : 'hidden'].join(' ')}>
                            <canvas data-magnify class="block"></canvas>
                        </div>
                    </div>
                </div>

                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                        <div class="text-sm font-medium text-slate-200">Result</div>
                        <select class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white"
                                .value=${this.filter}
                                @change=${(e: Event) => {
                                    this.pushHistory();
                                    this.filter = (e.target as HTMLSelectElement).value as FilterMode;
                                    this.queuePreview();
                                }}>
                            <option value="original">Original</option>
                            <option value="magic">✨ Magic Color</option>
                            <option value="grayscale">Grayscale</option>
                            <option value="bw">B&W</option>
                        </select>
                    </div>

                    <div class="rounded-xl overflow-hidden border border-slate-800 bg-black aspect-[3/4] relative">
                        <canvas data-preview class="w-full h-full block"></canvas>
                        ${!this.baseCanvas ? html`
                            <div class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                                Preview...
                            </div>` : null}
                    </div>

                    <div class="flex gap-2">
                        <button class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                ?disabled=${this.busy} @click=${() => void this.onSave()}>
                            ${this.busy ? 'Saving…' : 'Save'}
                        </button>
                        <button class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700" ?disabled=${this.busy}
                                @click=${this.onCancel}>Back
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

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
    return await createImageBitmap(blob);
}

function grayscaleInPlace(rgba: Uint8ClampedArray) {
    for (let i = 0; i < rgba.length; i += 4) {
        const y = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = y;
    }
}

function resizeCanvas(src: HTMLCanvasElement, maxDim: number): HTMLCanvasElement {
    const s = Math.min(1, maxDim / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * s));
    const h = Math.max(1, Math.round(src.height * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    return c;
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
    return new Promise((resolve) => canvas.toBlob((b) => b?.arrayBuffer().then(buf => resolve(new Uint8Array(buf))), 'image/jpeg', quality));
}

