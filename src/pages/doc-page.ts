import {html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {shareOrDownload} from '../services/share';
import {buildPdfForDoc} from '../lib/pdf';
import {jsonFile, makeZip} from '../lib/zip';
import {bytesToBlob, toArrayBuffer} from '../lib/bytes';

import type {DocRecord, PageRecord} from '../domain/types';

@customElement('doc-page')
export class DocPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({attribute: false}) docId!: string;

    @state() private doc: DocRecord | null = null;
    @state() private pages: PageRecord[] = [];
    @state() private thumbs: Record<string, string> = {};
    @state() private busy = false;
    @state() private error: string | null = null;
    @state() private justImported = false;

    // Viewer States
    @state() private viewerOpen = false;
    @state() private viewerBusy = false;
    @state() private viewerErr: string | null = null;
    @state() private viewerUrl: string | null = null;
    @state() private viewerIndex = 0;
    @state() private showOcrOverlay = false;

    private revokeViewerUrl() {
        if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
        this.viewerUrl = null;
    }

    private closeViewer = () => {
        this.viewerOpen = false;
        this.viewerBusy = false;
        this.viewerErr = null;
        this.showOcrOverlay = false;
        this.revokeViewerUrl();
    };

    private async openViewerAt(index: number): Promise<void> {
        if (!this.doc) return;
        if (index < 0 || index >= this.pages.length) return;

        this.viewerErr = null;
        this.viewerBusy = true;
        this.viewerOpen = true;
        this.viewerIndex = index;
        this.showOcrOverlay = false;

        try {
            this.revokeViewerUrl();

            const p = this.pages[index];
            const store = getFileStore();
            const bytes = await store.get(p.imagePath);
            const blob = bytesToBlob(bytes, 'image/jpeg');
            this.viewerUrl = URL.createObjectURL(blob);
        } catch (e) {
            this.viewerErr = (e as Error).message ?? String(e);
        } finally {
            this.viewerBusy = false;
        }
    }

    private async viewerPrev(): Promise<void> {
        await this.openViewerAt(this.viewerIndex - 1);
    }

    private async viewerNext(): Promise<void> {
        await this.openViewerAt(this.viewerIndex + 1);
    }

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        await this.load();
        try {
            this.justImported = sessionStorage.getItem('sahifah.justImported') === '1';
            if (this.justImported) sessionStorage.removeItem('sahifah.justImported');
        } catch {
            this.justImported = false;
        }
    }

    disconnectedCallback(): void {
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        this.revokeViewerUrl();
        super.disconnectedCallback();
    }

    private async load(): Promise<void> {
        this.error = null;
        const doc = await db.docs.get(this.docId);
        if (!doc) {
            this.doc = null;
            this.pages = [];
            return;
        }
        this.doc = doc;
        const pages = await db.pages.where('docId').equals(this.docId).sortBy('createdAt');
        const map = new Map(pages.map(p => [p.id, p]));
        this.pages = doc.pageIds.map(id => map.get(id)).filter(Boolean) as PageRecord[];

        const store = getFileStore();
        const thumbs: Record<string, string> = {};
        for (const p of this.pages) {
            try {
                const bytes = await store.get(p.thumbPath);
                const blob = new Blob([toArrayBuffer(bytes)], {type: 'image/jpeg'});
                thumbs[p.id] = URL.createObjectURL(blob);
            } catch {
                // ignore
            }
        }

        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        this.thumbs = thumbs;
    }

    private async saveMeta(patch: Partial<DocRecord>): Promise<void> {
        if (!this.doc) return;
        this.doc = {...this.doc, ...patch, updatedAt: Date.now()};
        await db.docs.put(this.doc);
    }

    private async exportPdf(): Promise<void> {
        if (!this.doc) return;
        this.busy = true;
        this.error = null;
        try {
            const store = getFileStore();
            const pdfBytes = await buildPdfForDoc(store, this.pages);
            const filename = `${safeName(this.doc.title)}.pdf`;
            await shareOrDownload(pdfBytes, filename, 'application/pdf');

            const pdfPath = `docs/${this.doc.id}/exports/${Date.now()}.pdf`;
            await store.put(pdfPath, pdfBytes, 'application/pdf');
            await this.saveMeta({pdfPath});
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async exportImagesZip(): Promise<void> {
        if (!this.doc) return;
        this.busy = true;
        this.error = null;
        try {
            const store = getFileStore();
            const files: Record<string, Uint8Array> = {};
            for (let i = 0; i < this.pages.length; i++) {
                const p = this.pages[i];
                const bytes = await store.get(p.imagePath);
                files[`pages/${String(i + 1).padStart(3, '0')}.jpg`] = bytes;
            }
            Object.assign(files, jsonFile('meta.json', {doc: this.doc, pages: this.pages}));
            const zip = makeZip(files);
            await shareOrDownload(zip, `${safeName(this.doc.title)}-images.zip`, 'application/zip');
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async movePage(id: string, dir: -1 | 1): Promise<void> {
        if (!this.doc) return;
        const ids = [...this.doc.pageIds];
        const idx = ids.indexOf(id);
        if (idx < 0) return;
        const j = idx + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        await this.saveMeta({pageIds: ids});
        await this.load();
    }

    private async deletePage(pageId: string): Promise<void> {
        if (!this.doc) return;
        const ok = confirm('Delete this page? This cannot be undone.');
        if (!ok) return;

        this.busy = true;
        this.error = null;

        try {
            const page = await db.pages.get(pageId);
            if (!page) return;

            const store = getFileStore();
            await store.del(page.imagePath);
            await store.del(page.thumbPath);
            await db.pages.delete(pageId);

            const doc = await db.docs.get(this.doc.id);
            if (!doc) throw new Error('Doc missing');
            doc.pageIds = doc.pageIds.filter(id => id !== pageId);
            doc.updatedAt = Date.now();
            await db.docs.put(doc);

            await this.load();
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async deleteDoc(): Promise<void> {
        if (!this.doc) return;
        const ok = confirm('Delete this document and all pages? This cannot be undone.');
        if (!ok) return;

        this.busy = true;
        this.error = null;

        try {
            const store = getFileStore();
            const pages = await db.pages.where('docId').equals(this.doc.id).toArray();
            for (const p of pages) {
                await store.del(p.imagePath);
                await store.del(p.thumbPath);
            }
            if (this.doc.pdfPath) {
                try {
                    await store.del(this.doc.pdfPath);
                } catch {
                }
            }
            try {
                const key = 'sahifah.activeDocId';
                if (localStorage.getItem(key) === this.doc.id) localStorage.removeItem(key);
            } catch {
            }
            try {
                const k = 'sahifah.appendToDocId';
                if (localStorage.getItem(k) === this.doc.id) localStorage.removeItem(k);
            } catch {
            }

            await db.pages.where('docId').equals(this.doc.id).delete();
            await db.docs.delete(this.doc.id);
            location.hash = '#/library';
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    render() {
        if (!this.doc) {
            return html`
                <div class="space-y-2">
                    <div class="text-lg font-semibold">Document</div>
                    <div class="text-slate-500">Not found.</div>
                </div>
            `;
        }

        const currentPage = this.pages[this.viewerIndex];

        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <a class="text-sm text-slate-300 hover:underline" href="#/library">← Back</a>
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}
                    </div>` : null}

                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="text-sm text-slate-400">Title</div>
                    <input class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                           .value=${live(this.doc.title)}
                           @change=${(e: Event) => this.saveMeta({title: (e.target as HTMLInputElement).value})}/>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <div class="text-sm text-slate-400">Folder</div>
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                                   placeholder="e.g., Receipts"
                                   .value=${live(this.doc.folder ?? '')}
                                   @change=${(e: Event) => {
                                       const v = (e.target as HTMLInputElement).value.trim();
                                       void this.saveMeta({folder: v ? v : null});
                                   }}/>
                        </div>
                        <div>
                            <div class="text-sm text-slate-400">Tags</div>
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                                   placeholder="e.g., taxi, 2026"
                                   .value=${live(this.doc.tags.join(', '))}
                                   @change=${(e: Event) => {
                                       const v = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean);
                                       void this.saveMeta({tags: v});
                                   }}/>
                        </div>
                    </div>

                    <div>
                        <div class="text-sm text-slate-400">Search Index (OCR Memory)</div>
                        <div class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-xs text-slate-500 break-words h-20 overflow-y-auto">
                            ${this.doc.searchIndex || 'No text indexed yet. OCR runs in background after scanning.'}
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <button class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                ?disabled=${this.busy || this.pages.length === 0} @click=${this.exportPdf}>
                            ${this.busy ? 'Working…' : 'Export PDF'}
                        </button>
                        <button class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                ?disabled=${this.busy || this.pages.length === 0} @click=${this.exportImagesZip}>
                            Export images (zip)
                        </button>
                        <button class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                ?disabled=${this.busy} @click=${() => {
                            if (!this.doc) return;
                            localStorage.setItem('sahifah.appendToDocId', this.doc.id);
                            location.hash = '#/scan';
                        }}>
                            Add pages
                        </button>
                        <button class="px-4 py-2 rounded-xl bg-red-900/40 border border-red-900 hover:bg-red-900/60 text-red-200 disabled:opacity-60"
                                ?disabled=${this.busy} @click=${this.deleteDoc}>
                            Delete
                        </button>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="text-lg font-semibold">Pages (${this.pages.length})</div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        ${this.pages.map((p, idx) => html`
                            <div class="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden relative">
                                <div class="aspect-[3/4] bg-black">
                                    <button class="w-full h-full block" title="View full page"
                                            @click=${() => void this.openViewerAt(idx)}>
                                        <img class="w-full h-full object-cover" src=${this.thumbs[p.id]} alt="thumb"/>
                                    </button>
                                </div>

                                ${p.words && p.words.length > 0 ? html`
                                    <div class="absolute top-2 right-2 px-1.5 py-0.5 bg-emerald-500/90 text-slate-900 text-[10px] font-bold rounded">
                                        TXT
                                    </div>
                                ` : null}

                                <div class="p-2 flex items-center justify-between gap-2">
                                    <div class="text-xs text-slate-400">#${idx + 1}</div>
                                    <div class="flex gap-1">
                                        <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                                                @click=${() => this.movePage(p.id, -1)}>↑
                                        </button>
                                        <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                                                @click=${() => this.movePage(p.id, 1)}>↓
                                        </button>
                                        <button class="px-2 py-1 rounded bg-red-900/40 border border-red-900 hover:bg-red-900/60 text-red-200 text-xs"
                                                @click=${() => this.deletePage(p.id)}>X
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `)}
                    </div>
                </div>

                ${this.viewerOpen ? html`
                    <div class="fixed inset-0 z-50 bg-black/90 flex flex-col" @click=${(e: Event) => {
                        if (e.target === e.currentTarget) this.closeViewer();
                    }}>
                        <div class="px-4 py-3 flex items-center justify-between border-b border-slate-800 bg-slate-950">
                            <div class="text-sm text-slate-200">Page ${this.viewerIndex + 1}</div>

                            <div class="flex items-center gap-3">
                                <label class="flex items-center gap-2 cursor-pointer select-none">
                                    <input type="checkbox" .checked=${this.showOcrOverlay}
                                           @change=${(e: Event) => this.showOcrOverlay = (e.target as HTMLInputElement).checked}>
                                    <span class="text-xs text-emerald-400 font-medium">Show OCR</span>
                                </label>

                                <div class="h-4 w-px bg-slate-700 mx-1"></div>

                                <button class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                                        ?disabled=${this.viewerIndex === 0} @click=${() => void this.viewerPrev()}>←
                                </button>
                                <button class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                                        ?disabled=${this.viewerIndex === this.pages.length - 1}
                                        @click=${() => void this.viewerNext()}>→
                                </button>
                                <button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
                                        @click=${this.closeViewer}>Close
                                </button>
                            </div>
                        </div>

                        ${this.viewerErr ? html`
                            <div class="p-3 text-sm text-red-200 bg-red-950/40 border-b border-red-900 text-center">
                                ${this.viewerErr}
                            </div>
                        ` : null}

                        <div class="flex-1 overflow-hidden flex items-center justify-center relative bg-black p-4">
                            ${this.viewerBusy ? html`
                                <div class="text-slate-400">Loading image...</div>` : this.viewerUrl ? html`

                                <div class="relative shadow-2xl"
                                     style="aspect-ratio: ${currentPage.width}/${currentPage.height}; max-height: 100%; max-width: 100%;">
                                    <img src=${this.viewerUrl} class="w-full h-full object-contain block">

                                    ${this.showOcrOverlay && currentPage.words ? currentPage.words.map(w => html`
                                        <div class="absolute border border-red-500/60 bg-red-500/10 hover:bg-red-500/30 group"
                                             style="left: ${w.box[0] * 100}%; top: ${w.box[1] * 100}%; width: ${w.box[2] * 100}%; height: ${w.box[3] * 100}%;">
                                            <div class="absolute bottom-full left-0 mb-1 px-2 py-1 bg-black text-white text-[10px] rounded whitespace-nowrap hidden group-hover:block z-10 pointer-events-none">
                                                ${w.text} (${Math.round(w.confidence)}%)
                                            </div>
                                        </div>
                                    `) : null}

                                    ${this.showOcrOverlay && (!currentPage.words || currentPage.words.length === 0) ? html`
                                        <div class="absolute inset-0 flex items-center justify-center">
                                            <div class="bg-black/70 px-4 py-2 rounded text-red-400 text-sm">No text
                                                detected on
                                                this page
                                            </div>
                                        </div>
                                    ` : null}
                                </div>

                            ` : null}
                        </div>
                    </div>
                ` : null}
            </div>
        `;
    }
}

function safeName(s: string): string {
    return s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 120).trim() || 'document';
}