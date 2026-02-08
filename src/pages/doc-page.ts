import {html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {shareOrDownload} from '../services/share';
import {buildPdfForDoc, type PdfQuality} from '../lib/pdf';
import {jsonFile, makeZip} from '../lib/zip';
import {bytesToBlob} from '../lib/bytes';
import {ScanRepo} from './scan/scan-repo';

import {ConfirmModal} from '../components/confirm-modal';

import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';
import type {DocRecord, PageRecord} from '../domain/types';

@customElement('doc-page')
export class DocPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({attribute: false}) docId!: string;

    private repo = new ScanRepo();

    @state() private doc: DocRecord | null = null;
    @state() private pages: PageRecord[] = [];
    @state() private thumbs: Record<string, string> = {};
    @state() private busy = false;
    @state() private error: string | null = null;

    // #18 PDF Quality State
    @state() private pdfQuality: PdfQuality = 'original';
    // #21 Progress State
    @state() private exportProgress = 0;
    @state() private exportTotal = 0;

    // Viewer States
    @state() private viewerOpen = false;
    @state() private viewerBusy = false;
    @state() private viewerErr: string | null = null;
    @state() private viewerUrl: string | null = null;
    @state() private viewerIndex = 0;
    @state() private showOcrOverlay = false;

    // Editor States
    @state() private editingPage: PageRecord | null = null;
    @state() private editingBlob: Blob | null = null;

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        await this.load();
    }

    disconnectedCallback(): void {
        this.revokeUrls();
        super.disconnectedCallback();
    }

    private revokeUrls() {
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
        this.thumbs = {};
        this.viewerUrl = null;
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
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        const thumbs: Record<string, string> = {};

        for (const p of this.pages) {
            try {
                const bytes = await store.get(p.thumbPath);
                const blob = bytesToBlob(bytes, 'image/jpeg');
                thumbs[p.id] = URL.createObjectURL(blob);
            } catch {
            }
        }
        this.thumbs = thumbs;
    }

    // --- RE-EDITING LOGIC ---

    private async editPage(page: PageRecord): Promise<void> {
        this.busy = true;
        try {
            const store = getFileStore();
            const bytes = await store.get(page.imagePath);
            this.editingBlob = bytesToBlob(bytes, 'image/jpeg');
            this.editingPage = page;
        } catch (e) {
            this.error = "Could not load image for editing";
        } finally {
            this.busy = false;
        }
    }

    private async onEditorSave(ev: CustomEvent<PageEditorSaveDetail>) {
        if (!this.editingPage) return;
        this.busy = true;
        try {
            const {master, thumb} = ev.detail;
            await this.repo.updateExistingPage(this.editingPage.id, master, thumb);

            this.editingPage = null;
            this.editingBlob = null;
            await this.load();
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    // --- VIEWER LOGIC ---

    private async openViewerAt(index: number): Promise<void> {
        if (index < 0 || index >= this.pages.length) return;
        this.viewerIndex = index;
        this.viewerOpen = true;
        this.showOcrOverlay = false;
        await this.loadViewerImage();
    }

    private async loadViewerImage() {
        this.viewerBusy = true;
        this.viewerErr = null;
        if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
        this.viewerUrl = null;

        try {
            const p = this.pages[this.viewerIndex];
            const store = getFileStore();
            const bytes = await store.get(p.imagePath);
            const blob = bytesToBlob(bytes, 'image/jpeg');
            this.viewerUrl = URL.createObjectURL(blob);
        } catch (e) {
            this.viewerErr = "Failed to load image";
        } finally {
            this.viewerBusy = false;
        }
    }

    // --- ACTIONS ---

    private async saveMeta(patch: Partial<DocRecord>): Promise<void> {
        if (!this.doc) return;
        this.doc = {...this.doc, ...patch, updatedAt: Date.now()};
        await db.docs.put(this.doc);
    }

    private async exportPdf(): Promise<void> {
        if (!this.doc) return;
        this.busy = true;
        this.exportProgress = 0;
        this.exportTotal = this.pages.length;

        try {
            const store = getFileStore();

            // Wait a tick to show loading UI
            await new Promise(r => setTimeout(r, 50));

            const pdfBytes = await buildPdfForDoc(store, this.pages, {
                quality: this.pdfQuality,
                onProgress: (curr, total) => {
                    this.exportProgress = curr;
                    this.exportTotal = total;
                    this.requestUpdate();
                }
            });

            const filename = `${safeName(this.doc.title)}.pdf`;
            await shareOrDownload(pdfBytes, filename, 'application/pdf');

            // Only save high-res exports to storage to save space, or if needed
            // For now, we update the path only if it succeeds
            const pdfPath = `docs/${this.doc.id}/exports/${Date.now()}.pdf`;
            await store.put(pdfPath, pdfBytes, 'application/pdf');
            await this.saveMeta({pdfPath});
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
            this.exportProgress = 0;
        }
    }

    private async exportImagesZip(): Promise<void> {
        if (!this.doc) return;
        this.busy = true;
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

    private async deletePage(pageId: string): Promise<void> {
        const ok = await ConfirmModal.ask({
            title: 'Delete Page?',
            description: 'This page will be permanently removed.',
            confirm: 'Delete',
            destructive: true
        });
        if (!ok) return;
        this.busy = true;
        try {
            const page = await db.pages.get(pageId);
            if (page) {
                const store = getFileStore();
                await store.del(page.imagePath);
                await store.del(page.thumbPath);
                await db.pages.delete(pageId);
            }

            if (this.doc) {
                const newIds = this.doc.pageIds.filter(id => id !== pageId);
                await this.saveMeta({pageIds: newIds});
            }

            await this.load();
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async deleteDoc(): Promise<void> {
        if (!this.doc) return;
        const ok = await ConfirmModal.ask({
            title: 'Delete Document?',
            description: `Permanently delete "${this.doc.title}" and all ${this.pages.length} pages?`,
            confirm: 'Delete All',
            destructive: true
        });
        if (!ok) return;
        this.busy = true;
        try {
            await this.repo.deleteDocCompletely(this.doc.id);
            location.hash = '#/library';
        } catch (e) {
            this.error = (e as Error).message;
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

    private retakePage(pageId: string) {
        if (!this.doc) return;
        localStorage.setItem('sahifah.appendToDocId', this.doc.id);
        localStorage.setItem('sahifah.replacePageId', pageId);
        location.hash = '#/scan';
    }

    // --- RENDER HELPERS ---

    // #21 Progress Modal
    private renderProgress() {
        if (!this.busy || this.exportProgress === 0) return null;
        const pct = Math.round((this.exportProgress / this.exportTotal) * 100);

        return html`
            <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div class="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl">
                    <div class="flex items-center justify-between">
                        <div class="font-bold text-slate-100">Generating PDF</div>
                        <div class="text-sm text-emerald-400 font-mono">${pct}%</div>
                    </div>
                    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 transition-all duration-200" style="width: ${pct}%"></div>
                    </div>
                    <div class="text-xs text-slate-500 text-center">
                        Processing page ${this.exportProgress} of ${this.exportTotal}
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        if (!this.doc) return html`
            <div class="p-4 text-slate-500">Document not found</div>`;

        if (this.editingPage && this.editingBlob) {
            return html`
                <div class="fixed inset-0 z-50 bg-black">
                    <page-editor
                            .blob=${this.editingBlob}
                            @page-editor-save=${this.onEditorSave}
                            @page-editor-cancel=${() => {
                                this.editingPage = null;
                                this.editingBlob = null;
                            }}
                    ></page-editor>
                </div>
            `;
        }

        const currentPage = this.pages[this.viewerIndex];

        return html`
            <div class="space-y-4 pb-20">
                ${this.renderProgress()}

                <div class="flex items-center justify-between">
                    <a class="text-sm text-slate-300 hover:underline flex items-center gap-1 min-h-[44px]"
                       href="#/library">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M15 19l-7-7 7-7"></path>
                        </svg>
                        Library
                    </a>
                </div>

                ${this.error ? html`
                    <div class="p-3 bg-red-900/30 text-red-200 border border-red-900/50 rounded-xl text-sm flex justify-between items-start">
                        <span>${this.error}</span>
                        <button class="ml-2 text-red-300 hover:text-white" @click=${() => this.error = null}>✕</button>
                    </div>` : null}

                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="space-y-1">
                        <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Title</div>
                        <input class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 min-h-[44px]"
                               .value=${live(this.doc.title)}
                               @change=${(e: Event) => this.saveMeta({title: (e.target as HTMLInputElement).value})}/>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div class="space-y-1">
                            <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Folder</div>
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 min-h-[44px]"
                                   .value=${live(this.doc.folder ?? '')}
                                   @change=${(e: Event) => this.saveMeta({folder: (e.target as HTMLInputElement).value || null})}/>
                        </div>
                        <div class="space-y-1">
                            <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Tags</div>
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 min-h-[44px]"
                                   .value=${live(this.doc.tags.join(', '))}
                                   @change=${(e: Event) => this.saveMeta({tags: (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)})}/>
                        </div>
                    </div>

                    <div class="space-y-1">
                        <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Search Index</div>
                        <div class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-500 h-16 overflow-y-auto">
                            ${this.doc.searchIndex || 'No text indexed yet.'}
                        </div>
                    </div>

                    <div class="h-px bg-slate-800 my-2"></div>

                    <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-900 cursor-pointer select-none">
                        <input type="checkbox"
                               .checked=${this.pdfQuality === 'email'}
                               @change=${(e: Event) => this.pdfQuality = (e.target as HTMLInputElement).checked ? 'email' : 'original'}
                               class="w-5 h-5 rounded border-slate-600 bg-slate-800 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900">
                        <div class="flex-1">
                            <div class="text-sm font-medium text-slate-200">Compress for Email</div>
                            <div class="text-xs text-slate-500">Smaller file size, lower quality</div>
                        </div>
                    </label>

                    <div class="flex flex-wrap gap-2 pt-2">
                        <button class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 min-h-[44px]"
                                ?disabled=${this.busy || this.pages.length === 0} @click=${this.exportPdf}>
                            ${this.busy ? 'Working...' : 'Export PDF'}
                        </button>
                        <button class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm min-h-[44px]"
                                ?disabled=${this.busy || this.pages.length === 0} @click=${this.exportImagesZip}>
                            Export Zip
                        </button>
                        <button class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm min-h-[44px]"
                                @click=${() => {
                                    localStorage.setItem('sahifah.appendToDocId', this.doc!.id);
                                    location.hash = '#/scan';
                                }}>
                            Add Pages
                        </button>
                        <div class="flex-1"></div>
                        <button class="px-3 py-2 rounded-lg border border-red-900/30 text-red-400 hover:bg-red-950/20 text-sm min-h-[44px]"
                                @click=${this.deleteDoc}>
                            Delete
                        </button>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="text-sm font-semibold text-slate-400 uppercase tracking-wider">Pages
                            (${this.pages.length})
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        ${this.pages.map((p, idx) => html`
                            <div class="group relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-sm hover:border-slate-600 transition-colors">
                                <div class="aspect-[3/4] bg-slate-900 cursor-pointer relative"
                                     @click=${() => this.openViewerAt(idx)}>
                                    ${this.thumbs[p.id]
                                            ? html`<img src=${this.thumbs[p.id]} class="w-full h-full object-cover">`
                                            : html`
                                                <div class="w-full h-full flex items-center justify-center text-slate-700">
                                                    ?
                                                </div>`
                                    }
                                    ${p.words?.length ? html`
                                        <div class="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 backdrop-blur text-emerald-400 text-[10px] font-bold rounded">
                                            TXT
                                        </div>` : null}
                                </div>

                                <div class="p-2 flex items-center justify-between gap-1 bg-slate-950 border-t border-slate-900">
                                    <span class="text-xs text-slate-500 font-mono w-5">#${idx + 1}</span>

                                    <div class="flex items-center gap-1">
                                        <button class="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 min-h-[36px] min-w-[36px]"
                                                title="Edit"
                                                @click=${() => this.editPage(p)}>
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                                            </svg>
                                        </button>

                                        <button class="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 min-h-[36px] min-w-[36px]"
                                                title="Retake"
                                                @click=${() => this.retakePage(p.id)}>
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                            </svg>
                                        </button>

                                        <button class="p-2 rounded hover:bg-slate-800 text-slate-400 min-h-[36px] min-w-[36px]"
                                                @click=${() => this.movePage(p.id, -1)} ?disabled=${idx === 0}>↑
                                        </button>
                                        <button class="p-2 rounded hover:bg-slate-800 text-slate-400 min-h-[36px] min-w-[36px]"
                                                @click=${() => this.movePage(p.id, 1)}
                                                ?disabled=${idx === this.pages.length - 1}>↓
                                        </button>
                                        <button class="p-2 rounded hover:bg-red-900/30 text-slate-400 hover:text-red-400 min-h-[36px] min-w-[36px]"
                                                @click=${() => this.deletePage(p.id)}>
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M6 18L18 6M6 6l12 12"></path>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `)}
                    </div>
                </div>

                ${this.viewerOpen ? html`
                    <div class="fixed inset-0 z-50 bg-black/95 backdrop-blur flex flex-col"
                         @click=${(e: Event) => e.target === e.currentTarget && (this.viewerOpen = false)}>
                        <div class="px-4 py-3 flex items-center justify-between bg-black/50 border-b border-white/10">
                            <div class="text-sm font-medium text-slate-200">Page ${this.viewerIndex + 1}</div>
                            <div class="flex items-center gap-4">
                                <label class="flex items-center gap-2 cursor-pointer select-none">
                                    <input type="checkbox" .checked=${this.showOcrOverlay}
                                           @change=${(e: Event) => this.showOcrOverlay = (e.target as HTMLInputElement).checked}>
                                    <span class="text-xs text-emerald-400 font-medium">Show OCR</span>
                                </label>
                                <button class="p-2 hover:bg-white/10 rounded-full"
                                        @click=${() => this.viewerOpen = false}>
                                    <svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor"
                                         viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        ${this.viewerErr ? html`
                            <div class="bg-red-950/80 text-red-200 p-2 text-center text-sm border-b border-red-900">
                                ${this.viewerErr}
                            </div>
                        ` : null}

                        <div class="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
                            ${this.viewerBusy ? html`
                                <div class="text-slate-500">Loading...</div>` : this.viewerUrl ? html`
                                <div class="relative shadow-2xl max-w-full max-h-full">
                                    <img src=${this.viewerUrl} class="block max-w-full max-h-full object-contain">

                                    ${this.showOcrOverlay && currentPage?.words ? currentPage.words.map(w => html`
                                        <div class="absolute border border-red-500/50 bg-red-500/10 hover:bg-red-500/30"
                                             style="left: ${w.box[0] * 100}%; top: ${w.box[1] * 100}%; width: ${w.box[2] * 100}%; height: ${w.box[3] * 100}%;"
                                             title="${w.text}"></div>
                                    `) : null}
                                </div>
                            ` : null}

                            <button class="absolute left-4 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white"
                                    ?disabled=${this.viewerIndex === 0}
                                    @click=${(e: Event) => {
                                        e.stopPropagation();
                                        this.openViewerAt(this.viewerIndex - 1)
                                    }}>
                                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M15 19l-7-7 7-7"></path>
                                </svg>
                            </button>
                            <button class="absolute right-4 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white"
                                    ?disabled=${this.viewerIndex === this.pages.length - 1}
                                    @click=${(e: Event) => {
                                        e.stopPropagation();
                                        this.openViewerAt(this.viewerIndex + 1)
                                    }}>
                                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M9 5l7 7-7 7"></path>
                                </svg>
                            </button>
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
