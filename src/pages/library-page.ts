import {html, LitElement} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {live} from 'lit/directives/live.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

import {db} from '../services/db';
import type {DocRecord} from '../domain/types';
import {ScanRepo} from './scan/scan-repo';
import {bytesToBlob} from '../lib/bytes';
import {ConfirmModal} from '../components/confirm-modal';
import {ocrQueue} from '../services/ocr-queue';
import {haptics} from "../services/haptics";
import {ImpactStyle} from "@capacitor/haptics";
import {showToast} from "../components/toast-notification";

type ViewMode = 'list' | 'gallery';

@customElement('library-page')
export class LibraryPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private ocrActiveCount = 0;
    private repo = new ScanRepo();

    // Data State
    private allDocsSource: DocRecord[] = []; // Full database dump
    @state() private visibleDocs: DocRecord[] = []; // Currently rendered subset
    @state() private visibleLimit = 20; // Pagination limit

    @state() private query = '';
    @state() private thumbnails = new Map<string, string>();

    @state() private viewMode: ViewMode = 'list';
    @state() private selectionMode = false;
    @state() private selectedIds = new Set<string>();

    @state() private selectedTag: string | null = null;
    @state() private groupByFolder = false;
    @state() private allTags: string[] = [];

    @state() private loading = true;

    // Highlight logic
    @state() private highlightDocId: string | null = null;

    // Infinite Scroll
    private loadMoreObserver: IntersectionObserver | null = null;
    @query('#load-more-sentinel') private sentinel!: HTMLElement;

    private _onOcrChange = () => {
        this.ocrActiveCount = ocrQueue.activeCount;
    };

    async connectedCallback() {
        super.connectedCallback();
        ocrQueue.addEventListener('change', this._onOcrChange);
        this.ocrActiveCount = ocrQueue.activeCount;

        const savedView = localStorage.getItem('sahifah.libraryView');
        if (savedView === 'gallery') this.viewMode = 'gallery';

        // Check for new doc highlight
        const justSaved = sessionStorage.getItem('sahifah.justSavedDocId');
        if (justSaved) {
            this.highlightDocId = justSaved;
            sessionStorage.removeItem('sahifah.justSavedDocId');
            setTimeout(() => {
                this.highlightDocId = null;
            }, 3000);
        }

        await this.loadDocs();
        this.setupIntersectionObserver();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        for (const url of this.thumbnails.values()) URL.revokeObjectURL(url);
        ocrQueue.removeEventListener('change', this._onOcrChange);
        this.loadMoreObserver?.disconnect();
    }

    private setupIntersectionObserver() {
        this.loadMoreObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.loadMore();
            }
        }, {rootMargin: '200px'});
    }

    protected updated(_changedProperties: Map<string, any>) {
        if (this.sentinel && this.loadMoreObserver) {
            this.loadMoreObserver.observe(this.sentinel);
        }
    }

    private async loadDocs() {
        this.loading = true; // Start loading
        try {

            this.allDocsSource = await db.docs.orderBy('updatedAt').reverse().toArray();
            this.allTags = await this.repo.getAllTags();
            this.applyFilters();
        } finally {
            this.loading = false; // Stop loading
        }
    }

    private applyFilters() {
        let list = this.allDocsSource;

        // 1. Tag Filter
        if (this.selectedTag) {
            list = list.filter(d => d.tags.includes(this.selectedTag!));
        }

        // 2. Search Query
        const q = this.query.trim().toLowerCase();
        if (q) {
            list = list.filter(d => {
                if (d.title.toLowerCase().includes(q)) return true;
                if (d.tags.some(t => t.toLowerCase().includes(q))) return true;
                if (d.searchIndex && d.searchIndex.toLowerCase().includes(q)) return true;
                if (d.notes && d.notes.toLowerCase().includes(q)) return true;
                if (d.folder && d.folder.toLowerCase().includes(q)) return true;
                return false;
            });
        }

        // 3. Paginate
        this.visibleDocs = list.slice(0, this.visibleLimit);

        // 4. Load Thumbnails for visible only
        this.loadThumbnails(this.visibleDocs);
    }

    private loadMore() {
        const currentLen = this.visibleDocs.length;
        // Re-run filter logic to get full filtered list length
        // (Optimisation: In a real app we'd cache the filtered list, but for <1000 docs this is fine)
        let filteredTotal = this.allDocsSource;
        if (this.selectedTag) filteredTotal = filteredTotal.filter(d => d.tags.includes(this.selectedTag!));
        if (this.query.trim()) {
            const q = this.query.trim().toLowerCase();
            filteredTotal = filteredTotal.filter(d =>
                d.title.toLowerCase().includes(q) ||
                d.searchIndex?.toLowerCase().includes(q) ||
                d.tags.some(t => t.toLowerCase().includes(q))
            );
        }

        if (currentLen >= filteredTotal.length) return;

        this.visibleLimit += 20;
        this.applyFilters();
    }

    private async loadThumbnails(docs: DocRecord[]) {
        for (const doc of docs) {
            if (this.thumbnails.has(doc.id)) continue;

            // Only load if not already loaded
            const strip = await this.repo.getDocStrip(doc.id, 1);
            if (strip?.items[0]) {
                const blob = bytesToBlob(strip.items[0].thumbBytes, 'image/jpeg');
                const url = URL.createObjectURL(blob);
                this.thumbnails.set(doc.id, url);
                this.requestUpdate(); // Update UI as thumbs arrive
            }
        }
    }

    private onSearchInput(e: InputEvent) {
        this.query = (e.target as HTMLInputElement).value;
        this.visibleLimit = 20; // Reset pagination on search
        this.applyFilters();
    }

    private toggleView() {
        this.viewMode = this.viewMode === 'list' ? 'gallery' : 'list';
        localStorage.setItem('sahifah.libraryView', this.viewMode);
    }

    private toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        this.selectedIds = new Set();
    }

    private toggleSelection(id: string) {
        const next = new Set(this.selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this.selectedIds = next;
    }

    private async deleteSelected() {
        const count = this.selectedIds.size;
        if (count === 0) return;

        const ok = await ConfirmModal.ask({
            title: `Delete ${count} Document${count > 1 ? 's' : ''}?`,
            description: 'This action cannot be undone.',
            confirm: 'Delete',
            destructive: true
        });

        if (!ok) return;

        for (const id of this.selectedIds) {
            await this.repo.deleteDocCompletely(id);
        }
        showToast(`Deleted ${count} documents`, 'info');
        this.selectedIds = new Set();
        this.selectionMode = false;
        await this.loadDocs();
    }

    private get groupedDocs() {
        const flatList = this.visibleDocs;
        if (!this.groupByFolder) return {'All Documents': flatList};

        const groups: Record<string, DocRecord[]> = {};
        for (const doc of flatList) {
            const folder = doc.folder || 'Unsorted';
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push(doc);
        }
        return groups;
    }

    // --- RENDER HELPERS ---

    private getSearchSnippet(fullText: string | undefined, query: string): string | null {
        if (!fullText || !query) return null;

        const lowerText = fullText.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const idx = lowerText.indexOf(lowerQuery);

        if (idx === -1) return null;

        const start = Math.max(0, idx - 20);
        const end = Math.min(fullText.length, idx + query.length + 20);

        let snippet = fullText.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < fullText.length) snippet = snippet + '...';

        // Highlight match case-insensitively
        const regex = new RegExp(`(${query})`, 'gi');
        return snippet.replace(regex, '<b class="text-emerald-400 bg-emerald-950/50 px-0.5 rounded">$1</b>');
    }

    private async mergeSelected() {
        const ids = Array.from(this.selectedIds);
        const ok = await ConfirmModal.ask({
            title: `Merge ${ids.length} Documents?`,
            description: 'All pages will be combined into the oldest document. This cannot be undone.',
            confirm: 'Merge'
        });

        if (!ok) return;

        try {
            const masterId = await this.repo.mergeDocuments(ids);
            this.selectedIds = new Set();
            this.selectionMode = false;
            this.highlightDocId = masterId;
            await this.loadDocs();
            void haptics.impact(ImpactStyle.Medium);
            showToast(`Merged ${ids.length} documents successfully`, 'success');
        } catch (e) {
            showToast('Merge failed: ' + String(e), 'error')
        } finally {
        }
    }

    private async moveSelectedToFolder() {
        // FIX: Instead of 'suggestions', we list folders in the description
        const folders = Array.from(new Set(this.allDocsSource.map(d => d.folder).filter(Boolean))) as string[];
        const folderList = folders.length > 0 ? `\n\nExisting: ${folders.join(', ')}` : '';

        const folderName = await ConfirmModal.prompt({
            title: 'Move to Folder',
            description: 'Enter a folder name or leave blank to unsort.' + folderList,
            placeholder: 'e.g. Taxes, Work...',
            confirm: 'Move'
        });

        if (folderName === null) return;

        const finalFolder = folderName.trim() || null;

        for (const id of this.selectedIds) {
            await db.docs.update(id, {folder: finalFolder, updatedAt: Date.now()});
        }

        this.selectionMode = false;
        this.selectedIds = new Set();
        await this.loadDocs();
        void haptics.impact(ImpactStyle.Light);
        showToast(`Moved to "${finalFolder || 'Unsorted'}"`, 'success');
    }

    private renderSafetyPrompt() {
        const lastBackup = localStorage.getItem('sahifah.lastBackup');
        if (lastBackup || this.allDocsSource.length < 5) return null;

        return html`
            <div class="mx-1 p-4 rounded-xl bg-gradient-to-br from-amber-900/40 to-slate-900 border border-amber-900/50 space-y-2 mb-4">
                <div class="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                    Protect Your Data
                </div>
                <p class="text-xs text-slate-300">
                    You have ${this.allDocsSource.length} documents stored locally. If you lose your device or clear
                    browser
                    data, these will be lost forever.
                </p>
                <button @click=${() => location.hash = '#/settings'}
                        class="text-xs font-bold text-amber-400 hover:underline">
                    Create an Encrypted Backup now →
                </button>
            </div>
        `;
    }

    private renderTagBar() {
        return html`
            <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button
                        class="px-3 py-1 rounded-full text-xs font-medium transition-colors ${!this.selectedTag ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}"
                        @click=${() => {
                            this.selectedTag = null;
                            this.visibleLimit = 20;
                            this.applyFilters();
                        }}>
                    All
                </button>
                ${this.allTags.map(tag => html`
                    <button
                            class="px-3 py-1 rounded-full text-xs font-medium transition-colors ${this.selectedTag === tag ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}"
                            @click=${() => {
                                this.selectedTag = tag;
                                this.visibleLimit = 20;
                                this.applyFilters();
                            }}>
                        ${tag}
                    </button>
                `)}
            </div>
        `;
    }

    private renderSkeleton() {
        return html`
            <div class="flex flex-col gap-2 p-2 rounded-xl bg-slate-900/50 border border-slate-800/50">
                <div class="aspect-[3/4] bg-slate-800 rounded-lg w-full animate-pulse"></div>

                <div class="space-y-2 mt-1">
                    <div class="h-3 bg-slate-800 rounded w-3/4 animate-pulse"></div>
                    <div class="h-2 bg-slate-800/60 rounded w-1/2 animate-pulse"></div>
                </div>
            </div>
        `;
    }

    render() {
        const groups = this.groupedDocs;
        const isGallery = this.viewMode === 'gallery';
        const hasDocs = this.visibleDocs.length > 0;

        return html`
            <div class="space-y-4 pb-4">
                ${this.renderHeader(isGallery)}
                ${this.renderSafetyPrompt()}

                ${!hasDocs && !this.query && this.allDocsSource.length === 0 && !this.loading
                        ? this.renderEmptyState()
                        : html`
                            <div class="space-y-8 min-h-[50vh]">
                                ${this.loading
                                        ? html`
                                            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                                ${[...Array(10)].map(() => this.renderSkeleton())}
                                            </div>`
                                        : Object.entries(groups).map(([folderName, docs]) =>
                                                this.renderFolderGroup(folderName, docs, isGallery)
                                        )
                                }
                                <div id="load-more-sentinel" class="h-10 w-full"></div>
                            </div>
                        `
                }
            </div>
        `;
    }

    private renderHeader(isGallery: boolean) {
        const activeTitles = ocrQueue.activeTitles;
        const currentTask = activeTitles.length > 0 ? activeTitles[0] : null;

        return html`
            <div class="sticky top-0 bg-slate-950/90 backdrop-blur-md pt-4 pb-2 z-10 space-y-3">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <h1 class="text-2xl font-bold text-slate-100">Library</h1>
                        ${this.ocrActiveCount > 0 ? html`
                            <div class="flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-950/40 border border-emerald-900/30 max-w-[180px]">
                                <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></div>
                                <div class="flex flex-col min-w-0">
                                    <span class="text-[9px] font-bold text-emerald-500 uppercase leading-none">Analyzing</span>
                                    <span class="text-[10px] text-emerald-200 truncate font-medium">
                                        ${currentTask || 'Documents...'}
                                    </span>
                                </div>
                            </div>
                        ` : null}
                    </div>
                    <div class="flex items-center gap-1">
                        ${this.renderActionButtons(isGallery)}
                    </div>
                </div>

                <div class="relative">
                    <input
                            type="text"
                            class="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-600 transition-colors"
                            placeholder="Search docs & content..."
                            .value=${live(this.query)}
                            @input=${this.onSearchInput}
                    >
                    <svg class="w-5 h-5 text-slate-500 absolute left-3 top-3.5" fill="none" stroke="currentColor"
                         viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>

                ${this.allTags.length > 0 ? this.renderTagBar() : null}
            </div>
        `;
    }

    private renderActionButtons(isGallery: boolean) {
        return html`
            ${this.selectionMode ? html`
                <button class="p-2 rounded-full hover:bg-slate-800 text-slate-400"
                        @click=${this.moveSelectedToFolder}
                        ?disabled=${this.selectedIds.size === 0}>
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                </button>
                <button class="px-3 py-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/30 rounded-lg border border-emerald-900/50"
                        @click=${this.mergeSelected}
                        ?disabled=${this.selectedIds.size < 2}>
                    Merge
                </button>
                <button class="px-3 py-1.5 text-xs font-bold text-red-400 bg-red-950/30 rounded-lg border border-red-900/50"
                        @click=${this.deleteSelected}
                        ?disabled=${this.selectedIds.size === 0}>
                    Delete (${this.selectedIds.size})
                </button>
                <button class="p-2 rounded-full hover:bg-slate-800 text-slate-400" @click=${this.toggleSelectionMode}>
                    Cancel
                </button>
            ` : html`
                <button class="p-2 rounded-full ${this.groupByFolder ? 'text-emerald-400 bg-emerald-950/30' : 'text-slate-400'}"
                        @click=${() => this.groupByFolder = !this.groupByFolder}
                        title="Group by Folder">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                </button>
                <button class="p-2 rounded-full hover:bg-slate-800 text-slate-400" @click=${this.toggleSelectionMode}
                        title="Select">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </button>
            `}

            <button class="p-2 rounded-full hover:bg-slate-800 text-slate-400" @click=${this.toggleView}
                    title=${isGallery ? 'List View' : 'Gallery View'}>
                ${isGallery
                        ? html`
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M4 6h16M4 12h16M4 18h16"></path>
                            </svg>`
                        : html`
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path>
                            </svg>`}
            </button>
        `;
    }

    private renderFolderGroup(folderName: string, docs: DocRecord[], isGallery: boolean) {
        if (docs.length === 0) return null;

        const listGrid = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3";
        const galleryGrid = "grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3";
        const gridClass = isGallery ? galleryGrid : listGrid;

        return html`
            <div class="space-y-3">
                ${this.groupByFolder ? html`
                    <h2 class="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex items-center gap-2">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                        </svg>
                        ${folderName} (${docs.length})
                    </h2>
                ` : null}

                <div class="grid ${gridClass}">
                    ${repeat(docs, (d) => d.id, (d) => this.renderDocItem(d, isGallery))}
                </div>
            </div>
        `;
    }

    private renderEmptyState() {
        return html`
            <div class="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-6 relative">

                <div class="w-32 h-32 bg-slate-900/50 rounded-full flex items-center justify-center border border-slate-800">
                    <svg class="w-12 h-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                </div>

                <div>
                    <h2 class="text-xl font-bold text-slate-200">Your Library is Empty</h2>
                    <p class="text-sm text-slate-500 max-w-xs mx-auto mt-2">
                        Tap the camera button below to digitize your first document securely.
                    </p>
                </div>

                <div class="absolute bottom-20 left-1/2 -translate-x-1/2 animate-bounce text-emerald-500">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                    </svg>
                </div>
            </div>
        `;
    }

    private renderDocItem(doc: DocRecord, isGallery: boolean) {
        const thumb = this.thumbnails.get(doc.id);
        const date = new Date(doc.updatedAt).toLocaleDateString();
        const selected = this.selectedIds.has(doc.id);

        const isHighlight = this.highlightDocId === doc.id;
        const highlightClass = isHighlight ? 'ring-2 ring-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] z-10' : '';

        const baseClasses = "group relative bg-slate-900 border rounded-xl overflow-hidden transition-all cursor-pointer";
        const stateClasses = selected
            ? "border-emerald-500 ring-1 ring-emerald-500/50 bg-emerald-900/10"
            : "border-slate-800 hover:border-slate-700 active:bg-slate-800";

        const layoutClasses = isGallery ? "flex-col" : "flex";

        const qTrim = this.query.trim();
        // Check OCR text first, then check user notes for the snippet
        let snippet = this.getSearchSnippet(doc.searchIndex, qTrim);
        if (!snippet && doc.notes) {
            snippet = this.getSearchSnippet(doc.notes, qTrim);
        }

        return html`
            <div class="${baseClasses} ${stateClasses} ${layoutClasses} ${highlightClass}"
                 @click=${() => {
                     if (this.selectionMode) this.toggleSelection(doc.id);
                     else location.hash = `#/doc/${doc.id}`;
                 }}>

                ${this.selectionMode ? html`
                    <div class="absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 ${selected ? 'bg-emerald-500 border-emerald-500' : 'bg-black/50 border-slate-400'} flex items-center justify-center transition-colors">
                        ${selected ? html`
                            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                      d="M5 13l4 4L19 7"></path>
                            </svg>` : null}
                    </div>
                ` : null}

                <div class="${isGallery ? 'aspect-[3/4] w-full' : 'w-24 h-32 shrink-0'} bg-slate-950 relative border-r border-slate-800/50">
                    ${thumb
                            ? html`<img src=${thumb}
                                        class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity">`
                            : html`
                                <div class="w-full h-full bg-slate-800 animate-pulse flex items-center justify-center">
                                    <svg class="w-8 h-8 text-slate-700" fill="none" stroke="currentColor"
                                         viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                    </svg>
                                </div>`
                    }
                    ${isGallery && snippet ? html`
                        <div class="absolute bottom-2 right-2 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow">
                            Match
                        </div>
                    ` : null}
                </div>

                <div class="p-4 flex-1 min-w-0 flex flex-col justify-center gap-1">
                    <h3 class="text-slate-200 font-medium truncate leading-tight text-sm">${doc.title}</h3>

                    <div class="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        <span>${doc.pageIds.length} page${doc.pageIds.length === 1 ? '' : 's'}</span>
                        ${!isGallery ? html`<span>•</span><span>${date}</span>` : null}
                    </div>

                    ${doc.folder ? html`
                        <button @click=${(e: Event) => {
                            e.stopPropagation();
                            this.selectedTag = null;
                            this.query = doc.folder!;
                            this.applyFilters();
                        }}
                                class="mt-1 text-[10px] text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded w-fit hover:bg-emerald-500/20">
                            ${doc.folder}
                        </button>
                    ` : null}

                    ${!isGallery && snippet ? html`
                        <div class="mt-2 text-xs text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/50 line-clamp-2 leading-relaxed">
                            ${unsafeHTML(snippet)}
                        </div>
                    ` : null}

                    ${!isGallery && doc.tags.length > 0 && !snippet ? html`
                        <div class="flex gap-1 mt-1 overflow-hidden">
                            ${doc.tags.slice(0, 3).map(t => html`<span
                                    class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">${t}</span>`)}
                        </div>
                    ` : null}
                </div>
            </div>
        `;
    }
}