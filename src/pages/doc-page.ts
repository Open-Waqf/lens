import {html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {buildPdfForDoc, type PdfQuality} from '../lib/pdf';
import {jsonFile, makeZip} from '../lib/zip';
import {bytesToBlob} from '../lib/bytes';
import {ScanRepo} from './scan/scan-repo';

import {ConfirmModal} from '../components/confirm-modal';

import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';
import type {DocRecord, PageRecord} from '../domain/types';
import {haptics} from '../services/haptics';
import {ImpactStyle} from '@capacitor/haptics';
import {shareFile, shareFiles} from "../services/share";

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

    @state() private pdfQuality: PdfQuality = 'original';
    @state() private exportProgress = 0;
    @state() private exportTotal = 0;

    // Viewer States
    @state() private viewerOpen = false;
    @state() private viewerBusy = false;
    @state() private viewerErr: string | null = null;
    @state() private viewerUrl: string | null = null;
    @state() private viewerIndex = 0;
    @state() private showOcrOverlay = false;

    // Zoom & Pan State
    @state() private zoomLevel = 1;
    private touchStartX = 0;
    private touchStartY = 0;

    // Editor States
    @state() private editingPage: PageRecord | null = null;
    @state() private editingBlob: Blob | null = null;

    // Search State
    @state() private searchQuery = '';
    @state() private showExtractedText = false;

    @state() private draggingId: string | null = null;
    @state() private dropTargetId: string | null = null;

    @state() private folderSuggestions: string[] = [];
    @state() private tagSuggestions: string[] = [];

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        await this.load();
    }

    disconnectedCallback(): void {
        this.revokeUrls();
        super.disconnectedCallback();
    }

    private async exportSingleImage(pageId: string): Promise<void> {
        if (!this.doc) return;
        this.busy = true;
        try {
            const store = getFileStore();
            const page = this.pages.find(p => p.id === pageId);
            if (!page) throw new Error("Page not found");

            const bytes = await store.get(page.imagePath);
            const blob = bytesToBlob(bytes, 'image/jpeg');
            const pageNum = this.pages.indexOf(page) + 1;
            const name = `${safeName(this.doc.title)} - Page ${pageNum}.jpg`;
            const file = new File([blob], name, {type: 'image/jpeg'});

            await shareFile(file, name); // Uses the native-safe service
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    // 3. UPDATE: Batch Images (Share Images) with limited fallback
    private async exportImagesJpeg(): Promise<void> {
        if (!this.doc || this.pages.length === 0) return;
        this.busy = true;
        try {
            const store = getFileStore();
            const files: File[] = [];

            for (let i = 0; i < this.pages.length; i++) {
                const p = this.pages[i];
                const bytes = await store.get(p.imagePath);
                const blob = bytesToBlob(bytes, 'image/jpeg');
                const name = `${safeName(this.doc.title)} - Page ${i + 1}.jpg`;
                files.push(new File([blob], name, {type: 'image/jpeg'}));
            }

            // Share multiple files via service
            await shareFiles(files, this.doc.title);
        } catch (e) {
            this.error = (e as Error).message;

        } finally {
            this.busy = false;
        }
    }

    private revokeUrls() {
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        if (this.viewerUrl) URL.revokeObjectURL(this.viewerUrl);
        this.thumbs = {};
        this.viewerUrl = null;
    }

    private onDragStart(id: string) {
        this.draggingId = id;
        // Trigger a tiny haptic tick when pickup starts
        this.triggerHapticTick();
    }

    private onDragOver(e: DragEvent, id: string) {
        e.preventDefault();
        if (this.draggingId === id) return;
        this.dropTargetId = id;
    }

    private async onDrop(e: DragEvent, targetId: string) {
        e.preventDefault();
        if (!this.draggingId || this.draggingId === targetId || !this.doc) {
            this.draggingId = null;
            this.dropTargetId = null;
            return;
        }

        const ids = [...this.doc.pageIds];
        const fromIdx = ids.indexOf(this.draggingId);
        const toIdx = ids.indexOf(targetId);

        if (fromIdx !== -1 && toIdx !== -1) {
            // Remove from old pos, insert at new pos
            const [movedId] = ids.splice(fromIdx, 1);
            ids.splice(toIdx, 0, movedId);

            await this.saveMeta({pageIds: ids});
            await this.load();
            this.triggerHapticTick();
        }

        this.draggingId = null;
        this.dropTargetId = null;
    }

    private async triggerHapticTick() {
        try {
            // No need for dynamic import anymore since it's at the top
            void haptics.impact(ImpactStyle.Light);
        } catch {
        }
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

        const allDocs = await db.docs.toArray();
        const folders = new Set<string>();
        const tags = new Set<string>();

        for (const d of allDocs) {
            if (d.folder) folders.add(d.folder);
            if (d.tags) d.tags.forEach(t => tags.add(t));
        }

        this.folderSuggestions = Array.from(folders).sort();
        this.tagSuggestions = Array.from(tags).sort();

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

    private async openViewerAt(index: number): Promise<void> {
        if (index < 0 || index >= this.pages.length) return;
        this.viewerIndex = index;
        this.viewerOpen = true;
        this.zoomLevel = 1; // Reset zoom on page change
        if (this.searchQuery) this.showOcrOverlay = true;
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

    private onTouchStart(e: TouchEvent) {
        if (e.touches.length === 1) {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }
    }

    private onTouchEnd(e: TouchEvent) {
        if (this.zoomLevel > 1) return; // Disable swipe if zoomed in

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;

        const diffX = this.touchStartX - touchEndX;
        const diffY = this.touchStartY - touchEndY;

        // Check if horizontal swipe is dominant and long enough (> 50px)
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) {
                // Swipe Left -> Next Page
                this.openViewerAt(this.viewerIndex + 1);
            } else {
                // Swipe Right -> Prev Page
                this.openViewerAt(this.viewerIndex - 1);
            }
        }
    }

    private onDoubleTap(_e: MouseEvent) {
        // Toggle Zoom
        this.zoomLevel = this.zoomLevel === 1 ? 2.5 : 1;
    }

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
            const blob = bytesToBlob(pdfBytes, 'application/pdf');
            const pdfFile = new File([blob], filename, {type: 'application/pdf'});

            // UPDATED: Use service
            await shareFile(pdfFile, filename);

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

            // FIX RECURSION: Sanitize objects before stringifying
            const cleanDoc = JSON.parse(JSON.stringify(this.doc));
            const cleanPages = JSON.parse(JSON.stringify(this.pages));

            Object.assign(files, jsonFile('meta.json', {doc: cleanDoc, pages: cleanPages}));

            const zip = makeZip(files);
            const zipBlob = bytesToBlob(zip, 'application/zip');
            const zipFilename = `${safeName(this.doc.title)}-images.zip`;
            const zipFile = new File([zipBlob], zipFilename, {type: 'application/zip'});

            await shareFile(zipFile, zipFilename);
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
            await this.repo.deletePage(pageId);
            await this.load();
            if (this.pages.length === 0 && this.doc) {
                await this.repo.deleteDocCompletely(this.doc.id);
                location.hash = '#/library';
            }
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
            confirm: 'Delete Document',
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

    private get filteredPages() {
        const q = this.searchQuery.trim().toLowerCase();
        if (!q) return this.pages;
        return this.pages.filter(p => {
            if (!p.words) return false;
            return p.words.some(w => w.text.toLowerCase().includes(q));
        });
    }

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
                </div>
            </div>
        `;
    }

    render() {
        if (!this.doc) return html`
            <div class="p-4 text-slate-500">Document not found</div>`;

        if (this.editingPage && this.editingBlob) {
            return html`
                <div class="fixed inset-0 z-50 bg-black overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                    <page-editor
                            class="block w-full min-h-full"
                            .blob=${this.editingBlob}
                            ?disableAutoDetect=${true}
                            @page-editor-save=${this.onEditorSave}
                            @page-editor-cancel=${() => {
                                this.editingPage = null;
                                this.editingBlob = null;
                            }}
                    ></page-editor>
                </div>
            `;
        }

        const visiblePages = this.filteredPages;
        const currentPage = this.pages[this.viewerIndex];
        const q = this.searchQuery.trim().toLowerCase();

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
                                   list="folder-list"
                                   placeholder="e.g. Finance"
                                   .value=${live(this.doc.folder ?? '')}
                                   @change=${(e: Event) => this.saveMeta({folder: (e.target as HTMLInputElement).value || null})}/>

                            <datalist id="folder-list">
                                ${this.folderSuggestions.map(f => html`
                                    <option value=${f}></option>`)}
                            </datalist>
                        </div>
                        <div class="space-y-1">
                            <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Tags</div>
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 min-h-[44px]"
                                   list="tag-list"
                                   placeholder="e.g. 2024, Paid"
                                   .value=${live(this.doc.tags.join(', '))}
                                   @change=${(e: Event) => this.saveMeta({tags: (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)})}/>

                            <datalist id="tag-list">
                                ${this.tagSuggestions.map(t => html`
                                    <option value=${t}></option>`)}
                            </datalist>
                        </div>
                    </div>

                    <div class="space-y-1 pt-2">
                        <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Notes & Context</div>
                        <textarea
                                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors min-h-[80px] resize-none"
                                placeholder="Add details like 'Warranty ends Jan 2027' or 'Sent to Tax Office'..."
                                .value=${live(this.doc.notes ?? '')}
                                @change=${(e: Event) => this.saveMeta({notes: (e.target as HTMLTextAreaElement).value})}
                        ></textarea>
                    </div>

                    <div class="space-y-1">
                        <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Find in document
                        </div>
                        <div class="relative">
                            <input class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                                   placeholder="Search text..."
                                   .value=${live(this.searchQuery)}
                                   @input=${(e: InputEvent) => this.searchQuery = (e.target as HTMLInputElement).value}/>
                            <svg class="w-4 h-4 text-slate-500 absolute left-3 top-2.5" fill="none"
                                 stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                            ${this.searchQuery ? html`
                                <button class="absolute right-2 top-2 text-slate-500 hover:text-white"
                                        @click=${() => this.searchQuery = ''}>
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                </button>
                            ` : null}
                        </div>
                    </div>

                    <div class="h-px bg-slate-800 my-2"></div>

                    <div>
                        <button @click=${() => this.showExtractedText = !this.showExtractedText}
                                class="flex items-center gap-2 text-sm text-emerald-400 font-medium hover:text-emerald-300">
                            <svg class="w-4 h-4 transition-transform ${this.showExtractedText ? 'rotate-90' : ''}"
                                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M9 5l7 7-7 7"></path>
                            </svg>
                            ${this.showExtractedText ? 'Hide Extracted Text' : 'Show Extracted Text'}
                        </button>
                        ${this.showExtractedText ? html`
                            <div class="mt-3 space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                ${this.pages.map((p, i) => {
                                    const text = p.words?.map(w => w.text).join(' ').trim();
                                    if (!text) return null;
                                    return html`
                                        <div class="space-y-1">
                                            <div class="text-xs text-slate-500 font-bold uppercase tracking-wider">Page
                                                ${i + 1}
                                            </div>
                                            <div class="text-sm text-slate-300 whitespace-pre-wrap select-text bg-black/50 p-3 rounded-lg border border-slate-800/50">
                                                ${text}
                                            </div>
                                        </div>
                                    `;
                                })}
                                ${!this.pages.some(p => p.words?.length) ? html`
                                    <div class="text-sm text-slate-500 italic">No text detected in this document yet.
                                    </div>
                                ` : null}
                            </div>
                        ` : null}
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
                                ?disabled=${this.busy || this.pages.length === 0}
                                @click=${() => this.exportImagesJpeg()}>
                            Share Images
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
                    <div class="text-sm font-semibold text-slate-400 uppercase tracking-wider flex justify-between">
                        <span>Pages (${visiblePages.length})</span>
                        ${this.searchQuery && visiblePages.length < this.pages.length ? html`
                            <span class="text-emerald-500 text-xs">Filtered by search</span>
                        ` : null}
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        ${visiblePages.map((p) => {
                            const realIdx = this.pages.indexOf(p);
                            const isDragging = this.draggingId === p.id;
                            const isDropTarget = this.dropTargetId === p.id;

                            return html`
                                <div class="relative bg-slate-900 border-2 rounded-2xl overflow-hidden transition-all duration-200 
                                    ${isDragging ? 'opacity-30 border-emerald-500 scale-95' : 'border-slate-800'} 
                                    ${isDropTarget ? 'border-emerald-400 translate-y-2' : ''}"
                                     draggable="true"
                                     @dragstart=${() => this.onDragStart(p.id)}
                                     @dragover=${(e: DragEvent) => this.onDragOver(e, p.id)}
                                     @drop=${(e: DragEvent) => this.onDrop(e, p.id)}
                                     @dragend=${() => {
                                         this.draggingId = null;
                                         this.dropTargetId = null;
                                     }}>

                                    <div class="aspect-[3/4] bg-black cursor-pointer relative"
                                         @click=${() => this.openViewerAt(realIdx)}>
                                        ${this.thumbs[p.id]
                                                ? html`<img src=${this.thumbs[p.id]}
                                                            class="w-full h-full object-cover">`
                                                : html`
                                                    <div class="w-full h-full flex items-center justify-center text-slate-700">
                                                        ?
                                                    </div>`
                                        }
                                        <div class="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur text-white text-xs font-bold rounded-lg">
                                                #${realIdx + 1}
                                        </div>
                                    </div>

                                    <div class="flex items-center justify-between border-t border-slate-800 h-14 bg-slate-950 px-2">
                                        <button class="flex items-center justify-center text-slate-400 active:text-emerald-500 active:bg-slate-900"
                                                @click=${() => this.editPage(p)}>
                                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                                      stroke-width="2"></path>
                                            </svg>
                                        </button>
                                        <button class="flex items-center justify-center text-slate-400 active:text-red-500 active:bg-slate-900"
                                                @click=${() => this.deletePage(p.id)}>
                                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path d="M6 18L18 6M6 6l12 12" stroke-width="2"></path>
                                            </svg>
                                        </button>
                                        <button class="p-2 text-slate-400 hover:text-emerald-400"
                                                @click=${() => this.exportSingleImage(p.id)}
                                                title="Share this image">
                                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                                            </svg>
                                        </button>
                                        <div class="flex items-center justify-center text-slate-600 cursor-grab active:cursor-grabbing active:text-emerald-400 active:bg-slate-900">
                                            <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M7 7h2v2H7V7zm0 4h2v2H7v-2zm4-4h2v2h-2V7zm0 4h2v2h-2v-2z"></path>
                                            </svg>
                                        </div>
                                    </div>
                                </div>
                            `;
                        })}
                    </div>
                </div>

                ${this.viewerOpen ? html`
                    <div class="fixed inset-0 z-50 bg-black flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
                         @click=${(e: Event) => e.target === e.currentTarget && (this.viewerOpen = false)}>

                        <div class="px-4 py-3 flex items-center justify-between bg-black/50 border-b border-white/10 z-50 shrink-0">
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
                            <div class="bg-red-950/80 text-red-200 p-2 text-center text-sm border-b border-red-900 shrink-0">
                                ${this.viewerErr}
                            </div>
                        ` : null}

                        <div class="flex-1 overflow-hidden relative flex items-center justify-center w-full"
                             @touchstart=${this.onTouchStart}
                             @touchend=${this.onTouchEnd}>

                            ${this.viewerBusy ? html`
                                <div class="text-slate-500">Loading...</div>` : this.viewerUrl ? html`
                                <div class="relative transition-transform duration-200 ease-out"
                                     style="transform: scale(${this.zoomLevel})"
                                     @dblclick=${this.onDoubleTap}>
                                    <img src=${this.viewerUrl}
                                         class="block max-w-full max-h-[85vh] object-contain shadow-2xl border border-white/10">

                                    ${this.showOcrOverlay && currentPage?.words ? currentPage.words.map(w => {
                                        const isMatch = q && w.text.toLowerCase().includes(q);
                                        return html`
                                            <div class="absolute ${isMatch ? 'bg-yellow-500/30 border-yellow-400' : 'bg-red-500/10 border-red-500/50'} border"
                                                 style="left: ${w.box[0] * 100}%; top: ${w.box[1] * 100}%; width: ${w.box[2] * 100}%; height: ${w.box[3] * 100}%;">
                                            </div>`;
                                    }) : null}
                                </div>
                            ` : null}

                            <button class="fixed left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white z-50 transition-colors hidden sm:block"
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
                            <button class="fixed right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white z-50 transition-colors hidden sm:block"
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

                        <div class="px-4 py-3 bg-black/50 text-center text-xs text-slate-500 shrink-0">
                            Swipe to flip • Double tap to zoom
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