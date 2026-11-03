import {html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {buildPdfForDoc, type PdfQuality} from '../lib/pdf';
import {bytesToBlob} from '../lib/bytes';
import {detectImageMime} from '../lib/image/mime';
import {ScanRepo} from './scan/scan-repo';


import '../components/page-editor';
import type {PageEditorSaveDetail} from '../components/page-editor';
import type {PageEditorShareDetail} from '../components/page-editor';
import type {DocRecord, PageRecord} from '../domain/types';
import {haptics} from '../services/haptics';
import {ImpactStyle} from '@capacitor/haptics';
import {shareFile, shareFiles} from "../services/share";
import {AuthService} from "../services/auth-service";
import {i18n, t} from '../lib/i18n';
import {writeClipboardWithAutoClear} from '../services/clipboard';
import {showToast} from '../components/toast-notification';
import {PDFDocument} from 'pdf-lib';
import {Icons} from '../components/icons';
import {getTextDirection} from '../lib/text-direction';
import {pageText} from '../lib/ocr-text';
import {safeFileName as safeName} from '../lib/file-name';
import {deleteWithUndo, LIBRARY_CHANGED} from '../services/pending-delete';
import {ConfirmModal} from '../components/confirm-modal';
import {ocrQueue} from '../services/ocr-queue';
import {openInSigner, signerAvailable} from '../services/signer-handoff';

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

    @state() private exportProgress = 0;
    @state() private exportTotal = 0;
    private _exportAbort: AbortController | null = null;

    // Viewer States
    @state() private viewerOpen = false;
    @state() private viewerBusy = false;
    @state() private viewerErr: string | null = null;
    @state() private viewerUrl: string | null = null;
    @state() private viewerIndex = 0;

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
    @state() private showMore = false;
    @state() private signerInstalled = false;
    @state() private editingCorrectedText = false;
    @state() private correctedTextDraft = '';

    @state() private draggingId: string | null = null;
    @state() private dropTargetId: string | null = null;
    private pointerDragActive = false;

    @state() private folderSuggestions: string[] = [];

    async connectedCallback(): Promise<void> {
        super.connectedCallback();
        window.addEventListener(LIBRARY_CHANGED, this.onChanged);
        ocrQueue.addEventListener('change', this.onChanged);
        void signerAvailable().then((yes) => this.signerInstalled = yes);
        await this.load();
    }

    // A page deleted or restored (Undo), or OCR finished: show the current state.
    private onChanged = () => void this.load();

    disconnectedCallback(): void {
        window.removeEventListener(LIBRARY_CHANGED, this.onChanged);
        ocrQueue.removeEventListener('change', this.onChanged);
        this.revokeUrls();
        super.disconnectedCallback();
    }

    private async exportSingleImage(pageId: string): Promise<void> {
        if (!this.doc) return;
        
        this.busy = true;
        try {
            const store = getFileStore();
            const page = this.pages.find(p => p.id === pageId);
            if (!page) throw new Error(t('doc.page_not_found'));

            const bytes = await store.get(page.imagePath);
            const blob = bytesToBlob(bytes, 'image/jpeg');
            const pageNum = this.pages.indexOf(page) + 1;
            const name = `${safeName(this.doc.title)} - Page ${pageNum}.jpg`;
            const file = new File([blob], name, {type: 'image/jpeg'});
            AuthService.ignoreNextResumeForExternalAction('share-single', AuthService.SHARE_BYPASS_TTL_MS);
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

            AuthService.ignoreNextResumeForExternalAction('share-multi', 120_000);
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
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (this.draggingId === id) return;
        this.dropTargetId = id;
    }

    private async onDrop(e: DragEvent, targetId: string) {
        e.preventDefault();
        const sourceId = this.draggingId || e.dataTransfer?.getData('text/plain') || null;
        if (!sourceId || sourceId === targetId || !this.doc) {
            this.draggingId = null;
            this.dropTargetId = null;
            return;
        }

        await this.reorderByIds(sourceId, targetId);
    }

    private async reorderByIds(sourceId: string, targetId: string): Promise<void> {
        if (!this.doc || sourceId === targetId) {
            this.draggingId = null;
            this.dropTargetId = null;
            return;
        }

        const ids = [...this.doc.pageIds];
        const fromIdx = ids.indexOf(sourceId);
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

    private onHandlePointerDown(e: PointerEvent, id: string) {
        // Desktop mouse should use native HTML5 DnD (Firefox compatibility).
        // Touch/pen keeps the custom pointer-driven drag path.
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        this.pointerDragActive = true;
        this.draggingId = id;
        this.dropTargetId = id;
        this.triggerHapticTick();
    }

    private onHandlePointerMove(e: PointerEvent) {
        if (!this.pointerDragActive) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const card = hit?.closest('[data-page-card-id]') as HTMLElement | null;
        const targetId = card?.dataset.pageCardId || null;
        if (!targetId) return;
        if (this.draggingId === targetId) return;
        this.dropTargetId = targetId;
    }

    private onHandlePointerUp = async (e: PointerEvent) => {
        if (!this.pointerDragActive) return;
        e.preventDefault();
        e.stopPropagation();
        this.pointerDragActive = false;

        const sourceId = this.draggingId;
        const targetId = this.dropTargetId;
        if (sourceId && targetId && sourceId !== targetId) {
            await this.reorderByIds(sourceId, targetId);
            return;
        }

        this.draggingId = null;
        this.dropTargetId = null;
    };

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
        if (doc.deletedAt) {
            this.doc = null;
            this.pages = [];
            return;
        }
        const pages = (await db.pages.where('docId').equals(this.docId).sortBy('createdAt')).filter(p => !p.deletedAt);
        const map = new Map(pages.map(p => [p.id, p]));
        this.pages = doc.pageIds.map(id => map.get(id)).filter(Boolean) as PageRecord[];

        const allDocs = await db.docs.toArray();
        const folders = new Set<string>();

        for (const d of allDocs) {
            if (d.folder) folders.add(d.folder);
        }

        this.folderSuggestions = Array.from(folders).sort();

        const store = getFileStore();
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        const thumbs: Record<string, string> = {};

        for (const p of this.pages) {
            try {
                const bytes = await store.get(p.thumbPath);
                const blob = bytesToBlob(bytes, detectImageMime(bytes));
                thumbs[p.id] = URL.createObjectURL(blob);
            } catch {
            }
        }
        this.thumbs = thumbs;
    }

    private getRawExtractedTextContent(): string {
        return this.pages
            .map((p) => pageText(p.words))
            .filter(Boolean)
            .join('\n\n');
    }

    private getExtractedTextContent(): string {
        const corrected = this.doc?.correctedOcrText?.trim();
        if (corrected) return corrected;
        return this.getRawExtractedTextContent();
    }

    private async copyExtractedText(): Promise<void> {
        const text = this.getExtractedTextContent();
        if (!text) {
            showToast(t('doc.no_text'), 'info');
            return;
        }
        try {
            await writeClipboardWithAutoClear(text);
            showToast(t('doc.copied_text'), 'success');
        } catch {
            showToast(t('doc.copy_failed'), 'error');
        }
    }

    private async saveCorrectedOcrText(): Promise<void> {
        if (!this.doc) return;
        const next = this.correctedTextDraft.trim();
        const patch: Partial<DocRecord> = {
            correctedOcrText: next || undefined,
            searchIndex: next || this.getRawExtractedTextContent()
        };
        await this.saveMeta(patch);
        this.editingCorrectedText = false;
        showToast(t('doc.ocr_text_saved'), 'success');
    }

    private async resetCorrectedOcrText(): Promise<void> {
        if (!this.doc) return;
        await this.saveMeta({
            correctedOcrText: undefined,
            searchIndex: this.getRawExtractedTextContent()
        });
        this.correctedTextDraft = this.getRawExtractedTextContent();
        this.editingCorrectedText = false;
        showToast(t('doc.ocr_text_reset'), 'info');
    }

    private async editPage(page: PageRecord): Promise<void> {
        this.busy = true;
        try {
            const store = getFileStore();
            const bytes = await store.get(page.imagePath);
            this.editingBlob = bytesToBlob(bytes, 'image/jpeg');
            this.editingPage = page;
        } catch (e) {
            this.error = t('doc.edit_load_failed');
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

    private onEditorShare = async (ev: CustomEvent<PageEditorShareDetail>) => {
        this.busy = true;
        try {
            const {master, format} = ev.detail;
            const pageIndex = this.editingPage ? this.pages.findIndex(p => p.id === this.editingPage!.id) + 1 : 0;
            const own = this.editingPage ? await this.repo.pageTitle(this.editingPage.id) : null;
            const baseName = safeName(own || `${this.doc?.title || t('scan.title')} p${Math.max(pageIndex, 1)}`);
            const filename = format === 'pdf' ? `${baseName}.pdf` : `${baseName}.jpg`;
            const file = format === 'pdf'
                ? new File([bytesToBlob(await this.buildSinglePagePdf(master.bytes), 'application/pdf')], filename, {type: 'application/pdf'})
                : new File([bytesToBlob(master.bytes, 'image/jpeg')], filename, {type: 'image/jpeg'});
            AuthService.ignoreNextResumeForExternalAction('share-doc-editor', 120_000);
            await shareFile(file, filename);
        } catch (e) {
            this.error = (e as Error).message;
        } finally {
            this.busy = false;
        }
    };

    private async buildSinglePagePdf(imageBytes: Uint8Array): Promise<Uint8Array> {
        const pdf = await PDFDocument.create();
        const image = await pdf.embedJpg(imageBytes);
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, {x: 0, y: 0, width: image.width, height: image.height});
        return await pdf.save();
    }

    private async openViewerAt(index: number): Promise<void> {
        if (index < 0 || index >= this.pages.length) return;
        this.viewerIndex = index;
        this.viewerOpen = true;
        this.zoomLevel = 1; // Reset zoom on page change
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
            this.viewerErr = t('doc.viewer_load_failed');
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

    /**
     * Full quality, or a smaller file for email and messaging apps with size limits.
     * target 'signer' hands the PDF straight to Open Waqf Signer instead of the share sheet.
     */
    private async exportPdf(quality: PdfQuality = 'original', target: 'share' | 'signer' = 'share'): Promise<void> {
        if (!this.doc) return;

        this._exportAbort = new AbortController();
        this.busy = true;
        this.exportProgress = 0;
        this.exportTotal = this.pages.length;
        try {
            const store = getFileStore();
            await new Promise(r => setTimeout(r, 50));

            const pdfBytes = await buildPdfForDoc(store, this.pages, {
                quality,
                signal: this._exportAbort.signal,
                onProgress: (curr, total) => {
                    this.exportProgress = curr;
                    this.exportTotal = total;
                    this.requestUpdate();
                }
            });

            const filename = `${safeName(this.doc.title)}.pdf`;
            const blob = bytesToBlob(pdfBytes, 'application/pdf');
            const pdfFile = new File([blob], filename, {type: 'application/pdf'});
            AuthService.ignoreNextResumeForExternalAction('share-pdf', AuthService.SHARE_BYPASS_TTL_MS);
            if (target === 'signer') await openInSigner(pdfFile);
            else await shareFile(pdfFile, filename);
            // The PDF is not stored in the app: it is rebuilt from the pages on every export.
            // (Older versions kept a copy per export in docs/<id>/exports/; deleting a document
            // still removes it through doc.pdfPath.)

        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                this.error = (e as Error).message;
            }
        } finally {
            this._exportAbort = null;
            this.busy = false;
            this.exportProgress = 0;
        }
    }

    /** Pick a folder from the ones in use, a new one, or none. */
    private async chooseFolder(): Promise<void> {
        if (!this.doc) return;
        const NEW = '\u0000new', NONE = '\u0000none';
        const choice = await ConfirmModal.choose({
            title: t('library.move_to_folder'),
            choices: [
                ...this.folderSuggestions.filter(f => f !== this.doc!.folder).map(f => ({value: f, label: f})),
                {value: NEW, label: t('doc.folder_new')},
                ...(this.doc.folder ? [{value: NONE, label: t('library.unsorted')}] : []),
            ],
        });
        if (choice === null) return;
        let folder: string | null = choice;
        if (choice === NONE) folder = null;
        if (choice === NEW) {
            const name = await ConfirmModal.prompt({title: t('doc.folder_new'), placeholder: t('doc.folder_placeholder'), confirm: t('library.move_confirm')});
            if (!name?.trim()) return;
            folder = name.trim();
        }
        await this.saveMeta({folder});
        await this.load();
    }

    /** Delete one page with Undo. The last page takes the document with it. */
    private async deletePage(pageId: string): Promise<void> {
        if (!this.doc) return;
        if (this.pages.length <= 1) {
            await this.deleteDoc();
            return;
        }
        await deleteWithUndo('page', [pageId]);
    }

    /** Delete the document with Undo, and go back to the library. */
    private async deleteDoc(): Promise<void> {
        if (!this.doc) return;
        const id = this.doc.id;
        location.hash = '#/library';
        await deleteWithUndo('doc', [id]);
    }

    private get filteredPages() {
        const q = this.searchQuery.trim().toLowerCase();
        if (!q) return this.pages;
        return this.pages.filter(p => {
            if (!p.words) return false;
            // Search the page's text, not single words, so a phrase like "rue de la" matches.
            return pageText(p.words).replace(/\s+/g, ' ').toLowerCase().includes(q.replace(/\s+/g, ' '));
        });
    }

    private renderProgress() {
        if (!this.busy || this.exportProgress === 0) return null;
        const pct = Math.round((this.exportProgress / this.exportTotal) * 100);

        return html`
            <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div class="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl">
                    <div class="flex items-center justify-between">
                        <div class="font-bold text-slate-100">${t('doc.generating_pdf')}</div>
                        <div class="text-sm text-emerald-400 font-mono">${pct}%</div>
                    </div>
                    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 transition-all duration-200" style="width: ${pct}%"></div>
                    </div>
                    <div class="text-center">
                        <button class="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
                                @click=${() => this._exportAbort?.abort()}>
                            ${t('common.cancel')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        if (!this.doc) return html`
            <div class="p-4 text-slate-400">${t('doc.not_found')}</div>`;

        if (this.editingPage && this.editingBlob) {
            return html`
                <page-editor
                        .blob=${this.editingBlob}
                        ?disableAutoDetect=${true}
                        @page-editor-save=${this.onEditorSave}
                        @page-editor-share=${this.onEditorShare}
                        @page-editor-cancel=${() => {
                            this.editingPage = null;
                            this.editingBlob = null;
                        }}
                ></page-editor>
            `;
        }

        const visiblePages = this.filteredPages;
        const tool = 'flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-xl text-[11px] font-semibold min-h-[52px] active:scale-95 transition-transform disabled:opacity-40';
        return html`
            <div class="space-y-4 pb-24">
                ${this.renderProgress()}

                <!-- One row: back, the title (tap to rename), more -->
                <div class="flex items-center gap-2 pt-2">
                    <a class="p-2 -ml-2 rounded-xl text-slate-200 hover:bg-slate-900 min-w-[44px] min-h-[44px] flex items-center justify-center"
                       aria-label=${t('doc.library_back')} title=${t('doc.library_back')} href="#/library">
                        ${Icons.Back(i18n.getDirection() === 'rtl' ? 'w-6 h-6 rotate-180' : 'w-6 h-6')}
                    </a>
                    <input class="flex-1 min-w-0 bg-transparent border border-transparent focus:border-slate-700 focus:bg-slate-900 rounded-lg px-2 py-2 text-lg font-bold text-slate-100 min-h-[44px]"
                           aria-label=${t('doc.title_label')}
                           .value=${live(this.doc.title)}
                           @change=${(e: Event) => this.saveMeta({title: (e.target as HTMLInputElement).value, autoTitle: false})}/>
                </div>

                ${this.error ? html`
                    <div class="p-3 bg-red-900/30 text-red-200 border border-red-900/50 rounded-xl text-sm flex justify-between items-start">
                        <span>${this.error}</span>
                        <button class="ml-2 text-red-300 hover:text-white" aria-label=${t('common.close')} title=${t('common.close')}
                                @click=${() => this.error = null}>✕</button>
                    </div>` : null}

                ${this.doc.folder ? html`
                    <div class="text-xs text-slate-400 px-1">${t('doc.folder_label')}: <span class="text-emerald-400 font-semibold">${this.doc.folder}</span></div>
                ` : null}

                <!-- The pages -->
                <div class="grid gap-3 ${this.pages.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}">
                    ${visiblePages.map((p) => {
                        const realIdx = this.pages.indexOf(p);
                        const isDragging = this.draggingId === p.id;
                        const isDropTarget = this.dropTargetId === p.id;
                        return html`
                            <div class="relative bg-slate-900 border-2 rounded-2xl overflow-hidden transition-all duration-200 ${isDragging ? 'opacity-30 border-emerald-500 scale-95' : 'border-slate-800'} ${isDropTarget ? 'border-emerald-400 translate-y-2' : ''}"
                                 data-page-card-id=${p.id}
                                 @dragover=${(e: DragEvent) => this.onDragOver(e, p.id)}
                                 @drop=${(e: DragEvent) => this.onDrop(e, p.id)}
                                 @dragend=${() => { this.draggingId = null; this.dropTargetId = null; }}>
                                <div class="aspect-[3/4] bg-black cursor-pointer relative" role="button" tabindex="0"
                                     aria-label=${t('doc.open_page', {count: realIdx + 1})}
                                     @click=${() => this.openViewerAt(realIdx)}
                                     @keydown=${(e: KeyboardEvent) => {
                                         if (e.key === 'Enter' || e.key === ' ') {
                                             e.preventDefault();
                                             void this.openViewerAt(realIdx);
                                         }
                                     }}>
                                    ${this.thumbs[p.id]
                                            ? html`<img src=${this.thumbs[p.id]} alt=${t('doc.open_page', {count: realIdx + 1})} class="w-full h-full object-cover">`
                                            : html`<div class="w-full h-full flex items-center justify-center text-slate-400">?</div>`}
                                    <div class="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur text-white text-xs font-bold rounded-lg">${realIdx + 1}</div>
                                </div>
                                ${this.pages.length > 1 ? html`
                                    <div class="absolute bottom-2 right-2 w-10 h-10 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center text-white cursor-grab active:cursor-grabbing"
                                         role="button" tabindex="0" aria-label=${t('doc.drag_reorder')} title=${t('doc.drag_reorder')}
                                         draggable="true" style="touch-action:none;"
                                         @pointerdown=${(e: PointerEvent) => this.onHandlePointerDown(e, p.id)}
                                         @pointermove=${(e: PointerEvent) => this.onHandlePointerMove(e)}
                                         @pointerup=${this.onHandlePointerUp}
                                         @pointercancel=${this.onHandlePointerUp}
                                         @dragstart=${(e: DragEvent) => {
                                             e.stopPropagation();
                                             if (e.dataTransfer) {
                                                 e.dataTransfer.effectAllowed = 'move';
                                                 e.dataTransfer.setData('text/plain', p.id);
                                             }
                                             this.onDragStart(p.id);
                                         }}
                                         @dragend=${() => { this.draggingId = null; this.dropTargetId = null; }}>
                                        <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M7 7h2v2H7V7zm0 4h2v2H7v-2zm4-4h2v2h-2V7zm0 4h2v2h-2v-2z"></path></svg>
                                    </div>
                                ` : null}
                            </div>
                        `;
                    })}
                </div>
                ${this.searchQuery && visiblePages.length < this.pages.length ? html`
                    <div class="text-xs text-emerald-400 px-1">${t('doc.pages_count', {count: visiblePages.length})} · ${t('doc.filtered_by_search')}</div>
                ` : null}

                ${this.showExtractedText ? this.renderTextPanel() : null}

                <!-- The main actions, on the bottom edge -->
                <div class="fixed left-0 right-0 bottom-0 z-30 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 pb-[env(safe-area-inset-bottom)]">
                    <div class="max-w-7xl mx-auto flex items-stretch gap-1 px-2 py-2">
                        <button class="${tool} bg-emerald-700 hover:bg-emerald-600 text-white" data-testid="btn-share-pdf"
                                ?disabled=${this.busy || this.pages.length === 0} @click=${() => this.exportPdf('original')}>
                            ${Icons.Share('w-6 h-6 block')}<span>${this.busy ? t('common.processing') : t('doc.export_pdf')}</span>
                        </button>
                        <button class="${tool} text-slate-200 hover:bg-slate-900" data-testid="btn-add-pages"
                                @click=${() => {
                                    localStorage.setItem('sahifah.appendToDocId', this.doc!.id);
                                    location.hash = '#/scan?scan=1';
                                }}>
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            <span>${t('doc.add_pages')}</span>
                        </button>
                        <button class="${tool} ${this.showExtractedText ? 'text-emerald-400 bg-slate-900' : 'text-slate-200 hover:bg-slate-900'}" data-testid="btn-text"
                                aria-pressed=${this.showExtractedText}
                                @click=${() => this.showExtractedText = !this.showExtractedText}>
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h10"></path></svg>
                            <span>${t('doc.show_text')}</span>
                        </button>
                        <button class="${tool} text-slate-200 hover:bg-slate-900" data-testid="btn-more" aria-label=${t('doc.more')}
                                @click=${() => this.showMore = true}>
                            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                            <span>${t('doc.more')}</span>
                        </button>
                    </div>
                </div>

                ${this.showMore ? this.renderMoreSheet() : null}
                ${this.viewerOpen ? this.renderViewer() : null}
            </div>
        `;
    }

    /** The text read from the pages: search, copy, correct. */
    private renderTextPanel() {
        return html`
            <div class="p-4 rounded-2xl border border-slate-800 bg-slate-950 space-y-3" data-testid="text-panel">
                <div class="relative">
                    <input class="w-full bg-slate-900 border border-slate-700 rounded-lg ps-9 pe-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 min-h-[44px]"
                           placeholder="${t('doc.find_placeholder')}" aria-label=${t('doc.find_label')}
                           .value=${live(this.searchQuery)}
                           @input=${(e: InputEvent) => this.searchQuery = (e.target as HTMLInputElement).value}/>
                    <svg class="w-4 h-4 text-slate-400 absolute start-3 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    ${this.searchQuery ? html`
                        <button class="absolute end-2 top-2 p-1 text-slate-400 hover:text-white" aria-label=${t('doc.clear_search')} title=${t('doc.clear_search')}
                                @click=${() => this.searchQuery = ''}>
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>` : null}
                </div>
                ${this.pages.some(p => p.ocrStatus === 'pending') ? html`
                    <div class="flex items-center gap-2 text-sm text-slate-300" data-testid="ocr-reading">
                        <div class="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                        ${t('doc.ocr_reading')}
                    </div>` : null}
                <div class="flex flex-wrap gap-2">
                    <button class="flex-1 px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold min-h-[48px]" @click=${() => this.copyExtractedText()}>
                        ${t('doc.copy_text')}
                    </button>
                    <button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs min-h-[48px]"
                            @click=${() => {
                                this.correctedTextDraft = this.getExtractedTextContent();
                                this.editingCorrectedText = !this.editingCorrectedText;
                            }}>
                        ${t('doc.edit_ocr_text')}
                    </button>
                </div>
                ${this.editingCorrectedText ? html`
                    <div class="p-3 rounded-lg border border-slate-800 bg-black/40 space-y-2">
                        <div class="text-[11px] text-slate-400">${t('doc.edit_ocr_help')}</div>
                        <textarea class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:border-emerald-500 min-h-[120px] resize-y"
                                  style="direction: ${getTextDirection(this.correctedTextDraft)}; text-align: start;"
                                  placeholder=${t('doc.ocr_text_placeholder')}
                                  .value=${this.correctedTextDraft}
                                  @input=${(e: Event) => this.correctedTextDraft = (e.target as HTMLTextAreaElement).value}></textarea>
                        <div class="flex gap-2">
                            <button class="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs min-h-[44px]" @click=${() => this.saveCorrectedOcrText()}>${t('doc.save_ocr_text')}</button>
                            <button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs min-h-[44px]" @click=${() => this.resetCorrectedOcrText()}>${t('doc.reset_ocr_text')}</button>
                        </div>
                    </div>
                ` : null}
                <div class="space-y-4 max-h-[50vh] overflow-y-auto pe-2">
                    ${this.doc?.correctedOcrText?.trim() ? html`
                        <div class="text-sm text-slate-300 whitespace-pre-wrap select-text bg-black/50 p-3 rounded-lg border border-slate-800/50"
                             style="direction: ${getTextDirection(this.doc.correctedOcrText)}; text-align: start;">${this.doc.correctedOcrText}</div>
                    ` : this.pages.map((p, i) => {
                        const text = pageText(p.words);
                        if (!text) return null;
                        return html`
                            <div class="space-y-1">
                                <div class="text-xs text-slate-400 font-bold uppercase tracking-wider">${t('doc.page_label', {count: i + 1})}</div>
                                <div class="text-sm text-slate-300 whitespace-pre-wrap select-text bg-black/50 p-3 rounded-lg border border-slate-800/50"
                                     style="direction: ${getTextDirection(text)}; text-align: start;">${text}</div>
                            </div>
                        `;
                    })}
                    ${!this.doc?.correctedOcrText?.trim() && !this.pages.some(p => p.words?.length) && !this.pages.some(p => p.ocrStatus === 'pending') ? html`
                        <div class="text-sm text-slate-400 italic">${t('doc.no_text')}</div>` : null}
                </div>
            </div>
        `;
    }

    /** The rarer actions, behind "More". */
    private renderMoreSheet() {
        const item = 'w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-100 text-sm font-medium min-h-[48px] text-start disabled:opacity-50';
        return html`
            <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end" @click=${() => this.showMore = false}>
                <div class="w-full p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] bg-slate-950 border-t border-slate-800 rounded-t-2xl space-y-2"
                     role="dialog" aria-label=${t('doc.more')} @click=${(e: Event) => e.stopPropagation()}>
                    ${this.signerInstalled ? html`
                        <button class=${item} data-testid="btn-sign" ?disabled=${this.busy || this.pages.length === 0}
                                @click=${() => { this.showMore = false; void this.exportPdf('original', 'signer'); }}>${t('doc.sign_with_signer')}</button>
                    ` : null}
                    <button class=${item} ?disabled=${this.busy || this.pages.length === 0}
                            @click=${() => { this.showMore = false; void this.exportPdf('email'); }}>${t('doc.export_pdf_small')}</button>
                    <button class=${item} ?disabled=${this.busy || this.pages.length === 0}
                            @click=${() => { this.showMore = false; void this.exportImagesJpeg(); }}>${t('doc.share_images')}</button>
                    <button class=${item} data-testid="btn-folder" @click=${() => { this.showMore = false; void this.chooseFolder(); }}>
                        ${t('doc.folder_label')}: <span class="text-emerald-400">${this.doc!.folder || t('library.unsorted')}</span>
                    </button>
                    <button class="w-full px-4 py-3 rounded-xl border border-red-900/40 text-red-300 hover:bg-red-950/30 text-sm font-medium min-h-[48px] text-start"
                            @click=${() => { this.showMore = false; void this.deleteDoc(); }}>${t('doc.delete_doc_action')}</button>
                    <button class="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-300 text-sm min-h-[44px]"
                            @click=${() => this.showMore = false}>${t('common.cancel')}</button>
                </div>
            </div>
        `;
    }

    /** One page, full screen: swipe between pages, and act on this page from the bottom bar. */
    private renderViewer() {
        const currentPage = this.pages[this.viewerIndex];
        const q = this.searchQuery.trim().toLowerCase();
        const tool = 'flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-xl text-[11px] font-semibold text-slate-200 hover:bg-white/10 min-h-[52px]';
        return html`
            <div class="fixed inset-0 z-50 bg-black flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                <div class="px-2 py-1 flex items-center justify-between z-50 shrink-0">
                    <button class="p-3 rounded-xl hover:bg-white/10 min-w-[44px] min-h-[44px]" aria-label=${t('doc.viewer_close')} title=${t('doc.viewer_close')}
                            @click=${() => this.viewerOpen = false}>
                        ${Icons.Back(i18n.getDirection() === 'rtl' ? 'w-6 h-6 rotate-180' : 'w-6 h-6')}
                    </button>
                    <div class="text-sm font-medium text-slate-200">${t('doc.page_label', {count: this.viewerIndex + 1})} / ${this.pages.length}</div>
                    <div class="min-w-[44px]"></div>
                </div>

                ${this.viewerErr ? html`
                    <div class="bg-red-950/80 text-red-200 p-2 text-center text-sm border-b border-red-900 shrink-0">${this.viewerErr}</div>` : null}

                <div class="flex-1 min-h-0 overflow-hidden relative flex items-center justify-center w-full"
                     @touchstart=${this.onTouchStart} @touchend=${this.onTouchEnd}>
                    ${this.viewerBusy ? html`<div class="text-slate-400">${t('common.loading')}</div>` : this.viewerUrl ? html`
                        <div class="relative transition-transform duration-200 ease-out max-h-full" style="transform: scale(${this.zoomLevel})" @dblclick=${this.onDoubleTap}>
                            <img src=${this.viewerUrl} class="block max-w-full max-h-[calc(100dvh-9rem)] object-contain">
                            ${q && currentPage?.words ? currentPage.words.filter(w => w.text.toLowerCase().includes(q)).map(w => {
                                return html`<div class="absolute bg-yellow-500/30 border-yellow-400 border"
                                                 style="left: ${w.box[0] * 100}%; top: ${w.box[1] * 100}%; width: ${w.box[2] * 100}%; height: ${w.box[3] * 100}%;"></div>`;
                            }) : null}
                        </div>
                    ` : null}
                    <button class="fixed left-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white z-50 hidden sm:block"
                            aria-label=${t('doc.viewer_prev')} title=${t('doc.viewer_prev')} ?disabled=${this.viewerIndex === 0}
                            @click=${(e: Event) => { e.stopPropagation(); this.openViewerAt(this.viewerIndex - 1); }}>
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <button class="fixed right-4 top-1/2 -translate-y-1/2 p-4 rounded-full bg-black/50 hover:bg-black/80 text-white z-50 hidden sm:block"
                            aria-label=${t('doc.viewer_next')} title=${t('doc.viewer_next')} ?disabled=${this.viewerIndex === this.pages.length - 1}
                            @click=${(e: Event) => { e.stopPropagation(); this.openViewerAt(this.viewerIndex + 1); }}>
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>

                <div class="flex items-stretch gap-1 px-2 py-2 border-t border-white/10 bg-black shrink-0">
                    <button class=${tool} type="button" aria-label=${t('scan.edit_page')} ?disabled=${!currentPage || this.busy}
                            @click=${() => { if (currentPage) { this.viewerOpen = false; void this.editPage(currentPage); } }}>
                        ${Icons.Edit('w-6 h-6')}<span>${t('doc.page_edit')}</span>
                    </button>
                    <button class=${tool} type="button" aria-label=${t('doc.share_image_title')} ?disabled=${!currentPage || this.busy}
                            @click=${() => currentPage && this.exportSingleImage(currentPage.id)}>
                        ${Icons.Share('w-6 h-6')}<span>${t('doc.page_share')}</span>
                    </button>
                    <button class="${tool} text-red-300" type="button" aria-label=${t('doc.delete_page_title')} ?disabled=${!currentPage || this.busy}
                            @click=${async () => { if (!currentPage) return; this.viewerOpen = false; await this.deletePage(currentPage.id); }}>
                        ${Icons.Close('w-6 h-6')}<span>${t('common.delete')}</span>
                    </button>
                </div>
            </div>
        `;
    }
}

