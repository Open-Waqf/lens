import {html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';

import type {FilterMode} from '../domain/types';
import type {Point, Quad} from '../lib/scan/quad';
import {quadArea} from '../lib/scan/quad';
import {computeOutputSize, warpRgbaToCanvas} from '../lib/image/warp';
import {adaptiveBwFromRgba} from '../lib/image/adaptive-bw';

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

    // rotation is owned here; scan-page can reset by remounting or calling reset()
    @state() private rotation: 0 | 90 | 180 | 270 = 0;

    @state() private busy = false;
    @state() private err: string | null = null;

    // image base (already rotated)
    private baseCanvas: HTMLCanvasElement | null = null;
    private baseCtx: CanvasRenderingContext2D | null = null;
    private baseW = 0;
    private baseH = 0;

    @state() private quad: Quad | null = null;
    @state() private previewUrl: string | null = null;
    private _previewTimer: number | null = null;
    private _previewToken = 0;

    private worker: Worker | null = null;

    // drag
    @query('canvas[data-edges]') private edgesEl!: HTMLCanvasElement;
    private dragIdx: number | null = null;

    disconnectedCallback(): void {
        this.stopWorker();
        this.revokePreview();
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = null;
        super.disconnectedCallback();
    }

    updated(ch: Map<string, unknown>) {
        if (ch.has('blob')) {
            void this.loadBlob();
        }
        if (ch.has('filter')) {
            this.queuePreview();
        }
    }

    // ---------- public helpers ----------

    reset() {
        this.rotation = 0;
        this.err = null;
        // reset quad to full rect
        if (this.baseW && this.baseH) {
            this.quad = fullQuad(this.baseW, this.baseH);
            this.drawEdges();
            this.queuePreview();
        }
    }

    rotate90() {
        void this.applyRotate90();
    }

    // ---------- loading ----------

    private async loadBlob(): Promise<void> {
        this.err = null;
        this.revokePreview();
        this.quad = null;
        this.rotation = 0;

        const img = await blobToImageBitmap(this.blob);

        // base canvas = decoded image
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d', {willReadFrequently: true})!;
        ctx.drawImage(img, 0, 0);

        this.baseCanvas = c;
        this.baseCtx = ctx;
        this.baseW = img.width;
        this.baseH = img.height;

        // default quad = full
        this.quad = fullQuad(this.baseW, this.baseH);

        await this.updateComplete;
        this.drawEdges();

        // auto-detect edges (best effort)
        void this.autoDetectEdges();

        // preview
        this.queuePreview();
    }

    // ---------- edges + dragging ----------

    private drawEdges(): void {
        const canvas = this.edgesEl;
        if (!canvas || !this.baseCanvas || !this.quad) return;

        // fit to container width, keep aspect
        const maxW = canvas.parentElement?.clientWidth ?? 320;
        const scale = Math.min(1, maxW / this.baseW);

        const w = Math.max(1, Math.round(this.baseW * scale));
        const h = Math.max(1, Math.round(this.baseH * scale));

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);

        // draw image
        ctx.drawImage(this.baseCanvas, 0, 0, w, h);

        // quad
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

        // handles
        for (let i = 0; i < 4; i++) {
            const p = q[i];
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.stroke();
            ctx.strokeStyle = 'rgba(16,185,129,0.95)';
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
        this.dragIdx = idx;
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
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

        this.drawEdges();
        this.queuePreview();
    };

    private onPointerUp = (_ev: PointerEvent) => {
        this.dragIdx = null;
    };

    private async autoDetectEdges(): Promise<void> {
        if (!this.baseCanvas || !this.baseCtx) return;

        this.startWorker();

        // downscale for detection
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

        // map to full-res
        const sx = this.baseW / w;
        const sy = this.baseH / h;

        const mapped: Quad = [
            {x: quad[0].x * sx, y: quad[0].y * sy},
            {x: quad[1].x * sx, y: quad[1].y * sy},
            {x: quad[2].x * sx, y: quad[2].y * sy},
            {x: quad[3].x * sx, y: quad[3].y * sy},
        ];

        // avoid ridiculous tiny quads
        const areaNorm = quadArea(mapped) / (this.baseW * this.baseH);
        if (areaNorm < 0.08) return;

        this.quad = mapped;
        this.drawEdges();
        this.queuePreview();
    }

    private detectQuad(rgba: Uint8ClampedArray, w: number, h: number): Promise<Quad | null> {
        return new Promise((resolve) => {
            if (!this.worker) return resolve(null);
            const onMsg = (ev: MessageEvent<any>) => {
                const msg = ev.data;
                if (msg?.type !== 'result') return;
                this.worker?.removeEventListener('message', onMsg);

                const q = msg.quad as Point[] | null;
                const conf = Number(msg.confidence ?? 0);
                if (!q || conf < 0.35) return resolve(null);

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

    // ---------- rotate ----------

    private async applyRotate90(): Promise<void> {
        if (!this.baseCanvas) return;

        // rotate base canvas clockwise
        const src = this.baseCanvas;
        const out = document.createElement('canvas');
        out.width = src.height;
        out.height = src.width;

        const ctx = out.getContext('2d', {willReadFrequently: true})!;
        ctx.translate(out.width / 2, out.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(src, -src.width / 2, -src.height / 2);

        // rotate quad points too
        const oldH = this.baseH;

        this.baseCanvas = out;
        this.baseCtx = ctx;
        this.baseW = out.width;
        this.baseH = out.height;

        this.rotation = (((this.rotation + 90) % 360) as any);

        if (this.quad) {
            // (x,y) -> (H - y, x) based on OLD dims
            const rotated: Quad = [
                    rot90(this.quad[0], oldH),
                    rot90(this.quad[1], oldH),
                    rot90(this.quad[2], oldH),
                    rot90(this.quad[3], oldH),
                ]
            ;
            this.quad = rotated;
        } else {
            this.quad = fullQuad(this.baseW, this.baseH);
        }

        await this.updateComplete;
        this.drawEdges();
        this.queuePreview();
    }

    // ---------- preview + save ----------

    private revokePreview() {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = null;
    }

    private queuePreview() {
        if (!this.baseCanvas || !this.quad) return;
        if (this._previewTimer) window.clearTimeout(this._previewTimer);
        this._previewTimer = window.setTimeout(() => void this.updatePreview(), 140);
    }

    private async updatePreview(): Promise<void> {
        if (!this.baseCanvas || !this.quad) return;
        const token = ++this._previewToken;

        this.busy = true;
        try {
            const previewCanvas = await this.renderFlattenedCanvas(1400);
            if (token !== this._previewToken) return;

            // encode lightweight preview
            const blob = await canvasToJpegBlob(previewCanvas, 0.82);
            if (token !== this._previewToken) return;

            this.revokePreview();
            this.previewUrl = URL.createObjectURL(blob);
        } catch {
            // ignore preview failures
        } finally {
            if (token === this._previewToken) this.busy = false;
        }
    }

    private async renderFlattenedCanvas(maxDim: number): Promise<HTMLCanvasElement> {
        const src = this.baseCanvas!;
        const srcW = this.baseW;
        const srcH = this.baseH;
        const q = this.quad!;

        // output size + cap
        const out0 = computeOutputSize(q);
        const s = Math.min(1, maxDim / Math.max(out0.w, out0.h));
        const outW = Math.max(1, Math.round(out0.w * s));
        const outH = Math.max(1, Math.round(out0.h * s));

        const ctx = src.getContext('2d', {willReadFrequently: true})!;
        const img = ctx.getImageData(0, 0, srcW, srcH);

        const warped = warpRgbaToCanvas(img.data, srcW, srcH, q, outW, outH);

        // filters (in-place)
        if (this.filter !== 'original') {
            const wctx = warped.getContext('2d', {willReadFrequently: true})!;
            const data = wctx.getImageData(0, 0, warped.width, warped.height);

            if (this.filter === 'grayscale') {
                grayscaleInPlace(data.data);
            } else if (this.filter === 'bw') {
                // ensure ArrayBuffer-backed array for ImageData constructor
                const bw = adaptiveBwFromRgba(data.data, warped.width, warped.height);
                const bwCopy = new Uint8ClampedArray(bw);
                data.data.set(bwCopy);
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
            ${this.err
                    ? html`
                        <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.err}</div>`
                    : null}

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="text-sm font-medium text-slate-200">Edges</div>
                            <div class="text-xs text-slate-500">Auto edges + drag corners</div>
                        </div>
                        <div class="flex gap-2">
                            <button
                                    class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => void this.autoDetectEdges()}
                            >
                                Auto
                            </button>
                            <button
                                    class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => this.reset()}
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    <div class="rounded-xl overflow-hidden border border-slate-800 bg-black">
                        <canvas
                                data-edges
                                class="w-full h-auto touch-none select-none"
                                @pointerdown=${this.onPointerDown}
                                @pointermove=${this.onPointerMove}
                                @pointerup=${this.onPointerUp}
                                @pointercancel=${this.onPointerUp}
                        ></canvas>
                    </div>
                </div>

                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="text-sm font-medium text-slate-200">Flattened</div>
                            <div class="text-xs text-slate-500">${this.busy ? 'Updating…' : 'Live preview'}</div>
                        </div>

                        <button
                                class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${() => this.rotate90()}
                        >
                            Rotate 90°
                        </button>
                    </div>

                    <div class="flex flex-wrap gap-2 items-center">
                        <label class="text-sm text-slate-300">Filter</label>
                        <select
                                class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm"
                                .value=${this.filter}
                                @change=${(e: Event) => {
                                    this.filter = (e.target as HTMLSelectElement).value as FilterMode;
                                }}
                        >
                            <option value="original">Original</option>
                            <option value="grayscale">Grayscale</option>
                            <option value="bw">B&W (adaptive)</option>
                        </select>
                    </div>

                    <div class="rounded-xl overflow-hidden border border-slate-800 bg-black aspect-[3/4] flex items-center justify-center">
                        ${this.previewUrl
                                ? html`<img src=${this.previewUrl} class="w-full h-full object-contain" alt="preview"/>`
                                : html`
                                    <div class="text-xs text-slate-500 px-3 text-center">Preparing preview…</div>`}
                    </div>

                    <div class="flex gap-2">
                        <button
                                class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${() => void this.onSave()}
                        >
                            ${this.busy ? 'Saving…' : 'Save page'}
                        </button>
                        <button
                                class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${this.onCancel}
                        >
                            Back
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

// ---------- helpers ----------

function fullQuad(w: number, h: number): Quad {
    return [
        {x: 0, y: 0},
        {x: w - 1, y: 0},
        {x: w - 1, y: h - 1},
        {x: 0, y: h - 1},
    ];
}

function rot90(p: Point, oldH: number): Point {
    return {x: (oldH - 1) - p.y, y: p.x};
}

function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
}

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
    // works well in modern browsers
    return await createImageBitmap(blob);
}

function grayscaleInPlace(rgba: Uint8ClampedArray) {
    for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        rgba[i] = y;
        rgba[i + 1] = y;
        rgba[i + 2] = y;
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

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality),
    );
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
    const b = await canvasToJpegBlob(canvas, quality);
    return new Uint8Array(await b.arrayBuffer());
}