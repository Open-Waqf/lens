import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {nanoid} from 'nanoid';

import type {FilterMode} from '../domain/types';
import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {processPhoto, type Rotation} from '../lib/image/pipeline';

import '../components/cropper';
import type {Cropper} from '../components/cropper';

type ScanStage = 'idle' | 'camera' | 'edit';
const APPEND_DOC_KEY = 'sahifah.appendToDocId';

@customElement('scan-page')
export class ScanPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @query('video') private videoEl!: HTMLVideoElement;

    @state() private stage: ScanStage = 'idle';
    @state() private stream: MediaStream | null = null;

    @state() private appendToDocId: string | null = null;
    @state() private targetDocTitle: string | null = null;

    // Current doc being built (new doc mode) OR append target
    private currentDocId: string | null = null;

    @state() private captured: Blob | null = null;
    @state() private filter: FilterMode = 'original';
    @state() private rotation: Rotation = 0;

    @state() private busy = false;
    @state() private error: string | null = null;

    // track whether at least one page was saved in this visit to Scan
    private savedAnyPage = false;

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        await this.loadMode();
    }

    disconnectedCallback(): void {
        void this.stopCamera();
        super.disconnectedCallback();
    }

    private async loadMode(): Promise<void> {
        const appendId = (() => {
            try {
                return localStorage.getItem(APPEND_DOC_KEY);
            } catch {
                return null;
            }
        })();

        this.appendToDocId = appendId;
        this.currentDocId = appendId; // append uses existing doc
        this.savedAnyPage = false;
        this.stage = 'idle';

        if (appendId) {
            const doc = await db.docs.get(appendId);
            this.targetDocTitle = doc?.title ?? 'Document';
        } else {
            this.targetDocTitle = null;
        }

        try {
            const raw = location.hash || '';
            const q = raw.includes('?') ? raw.split('?')[1] : '';
            const params = new URLSearchParams(q);
            if (params.get('import') === '1') {
                location.hash = '#/scan';
                setTimeout(() => {
                    void this.pickFiles({multiple: true});
                }, 0);
            }
        } catch {
            // ignore
        }
    }

    private beginCameraFromGesture(): void {
        this.error = null;
        this.stage = 'camera';

        if (this.stream) return;

        navigator.mediaDevices.getUserMedia({
            video: {facingMode: {ideal: 'environment'}},
            audio: false
        }).then(async (s) => {
            this.stream = s;
            await this.updateComplete;

            const v = this.videoEl;
            if (!v) return;

            v.srcObject = s;
            v.onloadedmetadata = () => {
                v.play().catch(() => {
                });
            };
        }).catch((e) => {
            this.error = (e as Error).message ?? String(e);
            this.stage = 'idle';
        });
    }

    private async stopCamera(): Promise<void> {
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
    }

    private async ensureDocId(): Promise<string> {
        // append mode uses existing doc
        if (this.appendToDocId) return this.appendToDocId;

        // new doc mode: create only when first page is saved
        if (this.currentDocId) return this.currentDocId;

        const id = nanoid();
        const now = Date.now();
        await db.docs.add({
            id,
            title: `Scan ${new Date(now).toLocaleString()}`,
            folder: null,
            tags: [],
            createdAt: now,
            updatedAt: now,
            pageIds: []
        });
        this.currentDocId = id;
        return id;
    }

    private async capturePhoto(): Promise<void> {
        this.error = null;
        try {
            const u = new URL(location.href);
            if (u.searchParams.get('mockCam') === '1') {
                const res = await fetch('./test-images/page1.jpg');
                this.captured = await res.blob();
                this.rotation = 0;
                this.filter = 'original';
                this.stage = 'edit';
                return;
            }

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

            const blob: Blob = await new Promise((resolve, reject) =>
                canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.9)
            );

            this.captured = blob;
            this.rotation = 0;
            this.filter = 'original';
            this.stage = 'edit';
        } catch (e) {
            this.error = (e as Error).message;
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
                this.captured = files[0];
                this.rotation = 0;
                this.filter = 'original';
                this.stage = 'edit';
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

            for (const file of files) {
                const {master, thumb} = await processPhoto({
                    blob: file,
                    rotation: 0,
                    filter: 'original'
                });

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
                });

                doc.pageIds.push(pageId);
            }

            doc.updatedAt = Date.now();
            await db.docs.put(doc);

            this.savedAnyPage = true;

            // If it was a NEW doc import, jump to doc to show editing hint
            if (!this.appendToDocId) {
                sessionStorage.setItem('sahifah.justImported', '1');
                location.hash = `#/doc/${docId}`;
                return;
            }

            // append mode: stay in camera to continue
            this.stage = 'camera';
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async addPage(): Promise<void> {
        if (!this.captured) return;

        this.busy = true;
        this.error = null;

        try {
            const docId = await this.ensureDocId();

            const cropper = this.renderRoot.querySelector('sl-cropper') as Cropper | null;
            const crop = cropper ? await cropper.getCropRectPixels() : null;

            const {master, thumb} = await processPhoto({
                blob: this.captured,
                crop: crop ?? undefined,
                rotation: this.rotation,
                filter: this.filter
            });

            const pageId = nanoid();
            const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
            const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

            const store = getFileStore();
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
            });

            const doc = await db.docs.get(docId);
            if (!doc) throw new Error('Doc missing');
            doc.pageIds = [...doc.pageIds, pageId];
            doc.updatedAt = Date.now();
            await db.docs.put(doc);

            this.savedAnyPage = true;

            // reset edit state and return to camera
            this.captured = null;
            this.rotation = 0;
            this.filter = 'original';
            this.stage = this.stream ? 'camera' : 'idle';
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async done(): Promise<void> {
        const docId = this.appendToDocId ?? this.currentDocId;

        await this.stopCamera();

        // clear append mode when done
        if (this.appendToDocId) {
            try {
                localStorage.removeItem(APPEND_DOC_KEY);
            } catch {
            }
            this.appendToDocId = null;
        }

        // If nothing was saved, go back to library
        if (!docId || !this.savedAnyPage) {
            location.hash = '#/library';
            return;
        }

        location.hash = `#/doc/${docId}`;
    }

    render() {
        const isAppend = !!this.appendToDocId;

        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div class="text-lg font-semibold">Scan</div>
                    ${isAppend
                            ? html`
                                <div class="text-xs text-slate-400">Add pages to: ${this.targetDocTitle ?? 'Document'}
                                </div>`
                            : html`
                                <div class="text-xs text-slate-500">New document</div>`}
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}</div>
                ` : null}

                ${this.stage === 'idle' ? html`
                    <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                        ${isAppend ? html`
                            <div class="text-sm text-slate-300">You are adding pages to:</div>
                            <div class="text-sm text-slate-100 font-medium">${this.targetDocTitle ?? 'Document'}</div>
                        ` : html`
                            <div class="text-sm text-slate-300">Create a new document.</div>
                        `}

                        <div class="flex gap-2">
                            <button
                                    class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                    @click=${() => this.beginCameraFromGesture()}
                            >
                                Open camera
                            </button>
                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700"
                                    @click=${() => this.pickFiles({multiple: true})}
                            >
                                Import
                            </button>
                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                    @click=${() => this.done()}
                            >
                                Done
                            </button>
                        </div>

                        <button
                                class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                @click=${() => {
                                    // cancel append mode and go back
                                    if (isAppend) {
                                        try {
                                            localStorage.removeItem(APPEND_DOC_KEY);
                                        } catch {
                                        }
                                        if (this.appendToDocId) location.hash = `#/doc/${this.appendToDocId}`;
                                        else location.hash = '#/library';
                                    } else {
                                        location.hash = '#/library';
                                    }
                                }}
                        >
                            Cancel
                        </button>
                    </div>
                ` : null}

                ${this.stage === 'camera' ? html`
                    <div class="space-y-3">
                        <div class="rounded-xl overflow-hidden border border-slate-800 bg-black">
                            <video class="w-full h-[60vh] object-contain" autoplay playsinline muted></video>
                        </div>

                        <div class="flex gap-2">
                            <button
                                    class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                    @click=${() => this.capturePhoto()}
                            >
                                Capture
                            </button>
                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700"
                                    @click=${() => this.pickFiles({multiple: true})}
                            >
                                Import
                            </button>
                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800"
                                    @click=${() => this.done()}
                            >
                                Done
                            </button>
                        </div>

                        <div class="flex justify-between">
                            <button
                                    class="text-sm text-slate-300 hover:underline"
                                    @click=${async () => {
                                        await this.stopCamera();
                                        this.stage = 'idle';
                                    }}
                            >
                                ← Back
                            </button>
                        </div>
                    </div>
                ` : null}

                ${this.stage === 'edit' ? html`
                    <div class="space-y-3">
                        <sl-cropper .blob=${this.captured!}></sl-cropper>

                        <div class="flex flex-wrap gap-2 items-center">
                            <label class="text-sm text-slate-300">Filter</label>
                            <select
                                    class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm"
                                    .value=${this.filter}
                                    @change=${(e: Event) => (this.filter = (e.target as HTMLSelectElement).value as FilterMode)}
                            >
                                <option value="original">Original</option>
                                <option value="grayscale">Grayscale</option>
                                <option value="bw">B&W</option>
                            </select>

                            <button
                                    class="ml-auto px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
                                    @click=${() => (this.rotation = ((this.rotation + 90) % 360) as any)}
                            >
                                Rotate 90°
                            </button>
                        </div>

                        <div class="flex gap-2">
                            <button
                                    class="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                    ?disabled=${this.busy}
                                    @click=${() => this.addPage()}
                            >
                                ${this.busy ? 'Processing…' : 'Add page'}
                            </button>

                            <button
                                    class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700"
                                    ?disabled=${this.busy}
                                    @click=${() => {
                                        this.captured = null;
                                        this.stage = this.stream ? 'camera' : 'idle';
                                    }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ` : null}
            </div>
        `;
    }
}
