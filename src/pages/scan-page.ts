import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {keyed} from 'lit/directives/keyed.js';

import type {DetectedQuad, Point, Quad} from '../lib/scan/quad';
import {lerpQuad, quadArea} from '../lib/scan/quad';
import {computeOutputSize, warpRgbaToCanvas} from '../lib/image/warp';

import {takePendingImport} from '../services/pending-import';
import {bytesToBlob} from '../lib/bytes';
import {processPhoto} from '../lib/image/pipeline';
import {DetectGovernor} from '../lib/scan/detect-governor';

import '../components/scan-overlay';
import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';

import {CameraManager} from '../lib/camera/camera-manager';
import {ScanSessionState, type ScanStage} from './scan/scan-session-state';
import {ScanRepo} from './scan/scan-repo';

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

    private camera = new CameraManager();
    private session = new ScanSessionState(() => this.requestUpdate());
    private repo = new ScanRepo();

    @state() private busy = false;
    @state() private error: string | null = null;

    @state() private docTitle: string | null = null;
    @state() private targetDocTitle: string | null = null;

    @state() private strip: StripItem[] = [];
    private newPageIds = new Set<string>();

    @state() private captured: Blob | null = null;
    @state() private editingPageId: string | null = null;
    @state() private editorKey = 0;

    @state() private autoCapture = readBool(AUTO_KEY, false);

    @state() private videoW = 0;
    @state() private videoH = 0;

    private captureInFlight = false;

    private worker: Worker | null = null;
    private offscreen: HTMLCanvasElement | null = null;
    private offCtx: CanvasRenderingContext2D | null = null;
    private detecting = false;

    @state() private lastDetect: DetectedQuad | null = null;
    @state() private smoothedQuad: Quad | null = null;

    private stableSince = 0;
    private cooldownUntil = 0;

    private detGov = new DetectGovernor();
    private detectLoopTimer: number | null = null;
    private detectLoopToken = 0;

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        window.addEventListener('hashchange', this.onHashChange);

        await this.loadMode();

        const pending = takePendingImport();
        if (pending?.length) {
            // pending import always => new doc flow
            this.clearAppendKey();
            this.session.resetAll();

            this.targetDocTitle = null;
            this.docTitle = null;

            if (pending.length === 1) await this.openNewBlobInEditor(pending[0]);
            else await this.batchImport(pending);
        }
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this.onHashChange);
        if (this.session.isAppend) this.clearAppendKey();

        void this.stopCamera();
        this.stopDetector();
        this.revokeStrip();

        super.disconnectedCallback();
    }

    private onHashChange = () => {
        const h = location.hash || '';
        if (h.startsWith('#/scan')) void this.loadMode();
    };

    private async loadMode(): Promise<void> {
        await this.stopCamera();
        this.stopDetector();
        this.revokeStrip();

        this.error = null;
        this.busy = false;

        this.clearEditor();
        this.newPageIds.clear();

        this.lastDetect = null;
        this.smoothedQuad = null;

        const params = this.getHashParams();

        const forceNew = params.get('new') === '1';
        if (forceNew) this.clearAppendKey();

        const appendId = forceNew ? null : safeGet(APPEND_DOC_KEY);

        this.session.resetAll();
        this.session.setAppend(appendId);
        this.session.setStage('idle');

        this.targetDocTitle = null;
        this.docTitle = null;

        if (appendId) {
            const doc = await this.repo.getDoc(appendId);
            this.targetDocTitle = doc?.title ?? 'Document';
            this.docTitle = doc?.title ?? 'Document';
            this.session.markCommitted(); // append always kept
            await this.refreshDocInfo();
        } else {
            this.session.setPageCount(0);
        }

        if (params.get('import') === '1') {
            setTimeout(() => void this.pickFiles({multiple: true}), 0);
        }
    }

    private async exitScan(): Promise<void> {
        await this.stopCamera();
        this.stopDetector();

        const decision = this.session.decideExit();

        if (decision.kind === 'nav-doc') {
            this.clearAppendKey();
            location.hash = `#/doc/${decision.docId}`;
            return;
        }

        if (decision.kind === 'confirm-discard') {
            const ok = confirm(decision.message);
            if (!ok) return;

            await this.repo.deleteDocCompletely(decision.docId);

            this.session.resetAll();
            this.revokeStrip();
            this.newPageIds.clear();
            this.clearEditor();

            this.docTitle = null;
            this.targetDocTitle = null;

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
        this.editorKey++;
    }

    private async openNewBlobInEditor(blob: Blob): Promise<void> {
        this.captured = blob;
        this.editingPageId = null;
        this.session.setStage('edit');
        this.editorKey++;
    }

    private async openExistingPageInEditor(pageId: string): Promise<void> {
        this.error = null;
        try {
            const bytes = await this.repo.getPageImageBytes(pageId);
            if (!bytes) return;

            this.captured = bytesToBlob(bytes, 'image/jpeg');
            this.editingPageId = pageId;
            this.session.setStage('edit');
            this.editorKey++;
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
        }
    }

    private onEditorCancel = () => {
        this.clearEditor();
        this.session.setStage(this.camera.isRunning ? 'camera' : 'idle');
    };

    private onEditorSave = async (ev: CustomEvent<PageEditorSaveDetail>) => {
        this.busy = true;
        this.error = null;

        try {
            const {master, thumb} = ev.detail;
            const docId = await this.ensureDocId();

            if (this.editingPageId) {
                await this.repo.updateExistingPage(this.editingPageId, master, thumb);
                this.newPageIds.delete(this.editingPageId);
            } else {
                const pageId = await this.repo.addNewPage(docId, master, thumb);
                this.newPageIds.add(pageId);
            }

            this.session.markCommitted();

            this.clearEditor();
            await this.refreshDocInfo();

            this.session.setStage(this.camera.isRunning ? 'camera' : 'idle');
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

        const now = Date.now();
        const title = `Scan ${new Date(now).toLocaleString()}`;

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

    private beginCameraFromGesture(): void {
        this.error = null;
        this.session.setStage('camera');

        if (this.camera.isRunning) return;

        void (async () => {
            try {
                await this.updateComplete;
                const res = await this.camera.start(this.videoEl);
                this.videoW = res.width;
                this.videoH = res.height;
                this.startDetector();
            } catch (e) {
                this.error = (e as Error).message ?? String(e);
                this.session.setStage('idle');
            }
        })();
    }

    private async stopCamera(): Promise<void> {
        await this.camera.stop();
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
                    {x: q[3].x * sx, y: q[3].y * sy},
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
                finalCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.9),
            );

            await this.openNewBlobInEditor(blob);
        } catch (e) {
            this.error = (e as Error).message ?? String(e);
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
            this.error = (e as Error).message ?? String(e);
        }
    }

    private async batchImport(files: File[]): Promise<void> {
        this.busy = true;
        this.error = null;

        try {
            const docId = await this.ensureDocId();
            const importedPageIds: string[] = [];

            for (const file of files) {
                const {master, thumb} = await processPhoto({blob: file, rotation: 0, filter: 'original'} as any);
                const pageId = await this.repo.addNewPage(docId, master, thumb);
                importedPageIds.push(pageId);
                this.newPageIds.add(pageId);
            }

            await this.refreshDocInfo();

            if (importedPageIds.length > 0) await this.openExistingPageInEditor(importedPageIds[0]);
            else this.session.setStage(this.camera.isRunning ? 'camera' : 'idle');
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

            // If detection too slow, avoid stability accumulation (prevents misfires)
            if (this.detGov.isTooSlowForAutoCapture) {
                this.stableSince = 0;
            }

            const quad = msg.quad as Point[] | null;
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

            this.maybeAutoCapture();
        };

        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d', {willReadFrequently: true});

        // Dynamic loop (uses governor intervalMs each tick)
        const token = ++this.detectLoopToken;

        const tick = () => {
            if (token !== this.detectLoopToken) return;
            if (!this.worker) return;

            // If not in active camera stage, just reschedule later.
            if (!this.camera.isRunning || this.session.stage !== 'camera') {
                this.detectLoopTimer = window.setTimeout(tick, 250);
                return;
            }

            // Optional: be nice when tab is hidden
            if (document.hidden) {
                this.detectLoopTimer = window.setTimeout(tick, 800);
                return;
            }

            this.grabAndDetect();

            // Key part: use *current* governor interval
            this.detectLoopTimer = window.setTimeout(tick, this.detGov.intervalMs);
        };

        tick();
    }

    private stopDetector(): void {
        // cancel loop
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
    }


    private grabAndDetect(): void {
        if (!this.worker || !this.offCtx || !this.offscreen) return;
        if (this.detecting) return;

        const v = this.videoEl;
        if (!v || v.videoWidth === 0 || v.videoHeight === 0) return;

        const maxDim = this.detGov.maxDim; // ✅ governor-driven
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
        if (this.session.stage !== 'camera') return;

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
            void this.capturePhoto(true);
            this.cooldownUntil = Date.now() + 1200;
            this.stableSince = 0;
        }
    }

    private renderBanner() {
        if (this.session.isAppend) {
            const title = this.docTitle ?? this.targetDocTitle ?? 'Document';
            return html`
                <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-400">Adding pages to</div>
                        <div class="text-sm text-slate-100 truncate">${title}</div>
                        <div class="text-xs text-slate-500">${this.session.pageCount} page(s)</div>
                    </div>
                    <div class="flex gap-2">
                        <button
                                class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                                ?disabled=${this.session.pageCount === 0}
                                @click=${() => this.openDocument()}
                        >
                            Open
                        </button>
                        <button
                                class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                                @click=${() => void this.exitScan()}
                        >
                            ${this.session.exitLabel}
                        </button>
                    </div>
                </div>
            `;
        }

        if (!this.session.hasPages) return null;

        const title = this.docTitle ?? 'Document';
        return html`
            <div class="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-xs text-slate-400">Building document</div>
                    <div class="text-sm text-slate-100 truncate">${title}</div>
                    <div class="text-xs text-slate-500">${this.session.pageCount} page(s)</div>
                </div>
                <div class="flex gap-2">
                    <button
                            class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60"
                            ?disabled=${this.session.pageCount === 0}
                            @click=${() => this.openDocument()}
                    >
                        Open
                    </button>
                    <button
                            class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                            @click=${() => void this.exitScan()}
                    >
                        ${this.session.exitLabel}
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
                ${this.strip.map(
                        (it) => html`
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
                                ${it.isNew
                                        ? html`<span
                                                class="absolute top-1 left-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-semibold">NEW</span>`
                                        : null}
                            </button>
                        `,
                )}
            </div>
        `;
    }

    render() {
        const stage: ScanStage = this.session.stage;

        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div class="text-lg font-semibold">${this.session.isAppend ? 'Add pages' : 'Scan'}</div>
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

                ${this.error
                        ? html`
                            <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}
                            </div>`
                        : null}

                ${this.renderBanner()} ${this.renderStrip()}

                ${stage === 'idle'
                        ? html`
                            <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                                <div class="text-sm text-slate-300">
                                    ${this.session.isAppend ? `Adding pages to: ${this.targetDocTitle ?? 'Document'}` : 'Start a new document'}
                                </div>

                                <div class="flex gap-2">
                                    <button
                                            class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                            @click=${() => this.beginCameraFromGesture()}
                                    >
                                        Open camera
                                    </button>

                                    <button
                                            class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                            ?disabled=${this.busy}
                                            @click=${() => this.pickFiles({multiple: true})}
                                    >
                                        Import
                                    </button>

                                    <button
                                            class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                            @click=${() => void this.exitScan()}
                                    >
                                        ${this.session.exitLabel}
                                    </button>
                                </div>
                            </div>
                        `
                        : null}

                ${stage === 'camera'
                        ? html`
                            <div class="space-y-3">
                                <div class="rounded-xl overflow-hidden border border-slate-800 bg-black relative">
                                    <video class="w-full h-[60vh] object-cover" autoplay playsinline muted></video>

                                    <scan-overlay
                                            .detected=${this.lastDetect}
                                            .quad=${this.smoothedQuad}
                                            .videoW=${this.videoW}
                                            .videoH=${this.videoH}
                                    ></scan-overlay>
                                </div>

                                <div class="flex gap-2">
                                    <button
                                            class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                            ?disabled=${this.busy}
                                            @click=${() => void this.capturePhoto(false)}
                                    >
                                        Capture
                                    </button>

                                    <button
                                            class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                            ?disabled=${this.busy}
                                            @click=${() => this.pickFiles({multiple: true})}
                                    >
                                        Import
                                    </button>

                                    <button
                                            class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                            @click=${() => void this.exitScan()}
                                    >
                                        ${this.session.exitLabel}
                                    </button>
                                </div>

                                <button
                                        class="text-sm text-slate-300 hover:underline"
                                        @click=${async () => {
                                            await this.stopCamera();
                                            this.stopDetector();
                                            this.session.setStage('idle');
                                        }}
                                >
                                    ← Back
                                </button>
                            </div>
                        `
                        : null}

                ${stage === 'edit'
                        ? html`
                            <div class="space-y-3">
                                ${keyed(
                                        this.editorKey,
                                        html`
                                            <page-editor
                                                    .blob=${this.captured!}
                                                    @page-editor-save=${this.onEditorSave}
                                                    @page-editor-cancel=${this.onEditorCancel}
                                            ></page-editor>
                                        `,
                                )}

                                <div class="flex justify-end">
                                    <button
                                            class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60"
                                            ?disabled=${this.busy}
                                            @click=${() => void this.exitScan()}
                                    >
                                        ${this.session.exitLabel}
                                    </button>
                                </div>
                            </div>
                        `
                        : null}
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