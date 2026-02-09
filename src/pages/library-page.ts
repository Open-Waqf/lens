import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import type {DocRecord} from '../domain/types';
import {ScanRepo} from './scan/scan-repo';
import {bytesToBlob} from '../lib/bytes';
import {ConfirmModal} from '../components/confirm-modal';

type ViewMode = 'list' | 'gallery';

@customElement('library-page')
export class LibraryPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    private repo = new ScanRepo();

    @state() private docs: DocRecord[] = [];
    @state() private query = '';
    @state() private thumbnails = new Map<string, string>();

    @state() private viewMode: ViewMode = 'list';
    @state() private selectionMode = false;
    @state() private selectedIds = new Set<string>();

    @state() private selectedTag: string | null = null;
    @state() private groupByFolder = false;
    @state() private allTags: string[] = [];

    // Highlight logic
    @state() private highlightDocId: string | null = null;

    async connectedCallback() {
        super.connectedCallback();
        const savedView = localStorage.getItem('sahifah.libraryView');
        if (savedView === 'gallery') this.viewMode = 'gallery';

        // Check for new doc highlight
        const justSaved = sessionStorage.getItem('sahifah.justSavedDocId');
        if (justSaved) {
            this.highlightDocId = justSaved;
            sessionStorage.removeItem('sahifah.justSavedDocId');
            // Remove highlight after 3s
            setTimeout(() => {
                this.highlightDocId = null;
            }, 3000);
        }

        await this.loadDocs();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        for (const url of this.thumbnails.values()) URL.revokeObjectURL(url);
    }

    private async loadDocs() {
        const all = await db.docs.orderBy('updatedAt').reverse().toArray();
        this.docs = all;
        this.loadThumbnails(all);
        this.allTags = await this.repo.getAllTags();
    }

    private async loadThumbnails(docs: DocRecord[]) {
        for (const doc of docs.slice(0, 15)) {
            if (this.thumbnails.has(doc.id)) continue;

            const strip = await this.repo.getDocStrip(doc.id, 1);
            if (strip?.items[0]) {
                const blob = bytesToBlob(strip.items[0].thumbBytes, 'image/jpeg');
                const url = URL.createObjectURL(blob);
                this.thumbnails.set(doc.id, url);
            }
        }
        this.requestUpdate();
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
        this.selectedIds = new Set();
        this.selectionMode = false;
        await this.loadDocs();
    }

    private get filteredDocs() {
        let list = this.docs;

        // 1. Apply Tag Filter first
        if (this.selectedTag) {
            list = list.filter(d => d.tags.includes(this.selectedTag!));
        }

        // 2. Apply Search Query
        const q = this.query.trim().toLowerCase();
        if (q) {
            list = list.filter(d => {
                if (d.title.toLowerCase().includes(q)) return true;
                if (d.tags.some(t => t.toLowerCase().includes(q))) return true;
                if (d.searchIndex && d.searchIndex.toLowerCase().includes(q)) return true;
                if (d.folder && d.folder.toLowerCase().includes(q)) return true; // Include folder in search
                return false;
            });
        }

        return list;
    }

    private get groupedDocs() {
        const flatList = this.filteredDocs;
        if (!this.groupByFolder) return {'All Documents': flatList};

        const groups: Record<string, DocRecord[]> = {};
        for (const doc of flatList) {
            const folder = doc.folder || 'Unsorted';
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push(doc);
        }
        return groups;
    }

    private renderTagBar() {
        return html`
            <div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button
                        class="px-3 py-1 rounded-full text-xs font-medium transition-colors ${!this.selectedTag ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}"
                        @click=${() => this.selectedTag = null}>
                    All
                </button>
                ${this.allTags.map(tag => html`
                    <button
                            class="px-3 py-1 rounded-full text-xs font-medium transition-colors ${this.selectedTag === tag ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}"
                            @click=${() => this.selectedTag = tag}>
                        ${tag}
                    </button>
                `)}
            </div>
        `;
    }

    /**
     * Main render entry point
     */
    render() {
        const groups = this.groupedDocs;
        const isGallery = this.viewMode === 'gallery';
        const hasDocs = Object.values(groups).some(g => g.length > 0);

        return html`
            <div class="space-y-4 pb-20">
                ${this.renderHeader(isGallery)}

                ${!hasDocs
                        ? this.renderEmptyState()
                        : html`
                            <div class="space-y-8">
                                ${Object.entries(groups).map(([folderName, docs]) =>
                                        this.renderFolderGroup(folderName, docs, isGallery)
                                )}
                            </div>
                        `
                }

                ${this.renderFab()}
            </div>
        `;
    }

    /**
     * Renders the sticky header with title, controls, search, and tags
     */
    private renderHeader(isGallery: boolean) {
        return html`
            <div class="sticky top-0 bg-black/80 backdrop-blur-md pt-4 pb-2 z-10 space-y-3">
                <div class="flex items-center justify-between gap-3">
                    <h1 class="text-2xl font-bold text-slate-100">Library</h1>

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
                            @input=${(e: InputEvent) => this.query = (e.target as HTMLInputElement).value}
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

    /**
     * Renders header action buttons (Selection, Grouping, View Mode, Settings)
     */
    private renderActionButtons(isGallery: boolean) {
        return html`
            ${this.selectionMode ? html`
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

            <button class="p-2 rounded-full hover:bg-slate-800 text-slate-400"
                    @click=${() => location.hash = '#/settings'}>
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
            </button>
        `;
    }

    /**
     * Renders a single folder section with its documents
     */
    private renderFolderGroup(folderName: string, docs: DocRecord[], isGallery: boolean) {
        if (docs.length === 0) return null;
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

                <div class="grid ${isGallery ? 'grid-cols-2 gap-3' : 'grid-cols-1 gap-3'}">
                    ${repeat(docs, (d) => d.id, (d) => this.renderDocItem(d, isGallery))}
                </div>
            </div>
        `;
    }

    /**
     * Renders the Floating Action Button
     */
    private renderFab() {
        return html`
            <button
                    class="fixed bottom-6 right-6 w-14 h-14 bg-emerald-500 hover:bg-emerald-400 rounded-full shadow-lg shadow-emerald-900/40 flex items-center justify-center text-slate-900 transition-transform active:scale-95 z-20"
                    @click=${() => location.hash = '#/scan?new=1'}
            >
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
            </button>
        `;
    }

    /**
     * Renders the empty state when no documents match
     */
    private renderEmptyState() {
        return html`
            <div class="flex flex-col items-center justify-center py-20 text-slate-500 text-center space-y-4">
                <div class="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-2">
                    <svg class="w-10 h-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                </div>
                <div>
                    <h3 class="text-lg font-medium text-slate-300">
                        ${this.query || this.selectedTag ? 'No matching documents' : 'No scans yet'}
                    </h3>
                    <p class="text-sm text-slate-500 max-w-xs mx-auto mt-1">
                        ${this.query || this.selectedTag
                                ? 'Try a different keyword or tag.'
                                : 'Tap the + button to capture your first document.'}
                    </p>
                </div>
            </div>
        `;
    }

    private renderDocItem(doc: DocRecord, isGallery: boolean) {
        const thumb = this.thumbnails.get(doc.id);
        const date = new Date(doc.updatedAt).toLocaleDateString();
        const selected = this.selectedIds.has(doc.id);

        // Highlight logic
        const isHighlight = this.highlightDocId === doc.id;
        const highlightClass = isHighlight ? 'ring-2 ring-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] z-10' : '';

        const baseClasses = "group relative bg-slate-900 border rounded-xl overflow-hidden transition-all cursor-pointer";
        const stateClasses = selected
            ? "border-emerald-500 ring-1 ring-emerald-500/50 bg-emerald-900/10"
            : "border-slate-800 hover:border-slate-700 active:bg-slate-800";
        const layoutClasses = isGallery ? "flex-col" : "flex";

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

                <div class="${isGallery ? 'aspect-[3/4] w-full' : 'w-20 h-24 shrink-0'} bg-slate-950 relative">
                    ${thumb
                            ? html`<img src=${thumb}
                                        class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity">`
                            : html`
                                <div class="w-full h-full flex items-center justify-center text-slate-700">
                                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                    </svg>
                                </div>`
                    }
                    ${isGallery && doc.searchIndex && this.query ? html`
                        <div class="absolute bottom-2 right-2 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow">
                            Match
                        </div>
                    ` : null}
                </div>

                <div class="p-3 flex-1 min-w-0 flex flex-col justify-center">
                    <h3 class="text-slate-200 font-medium truncate leading-tight mb-1">${doc.title}</h3>
                    <div class="flex items-center gap-2 text-xs text-slate-500">
                        <span>${doc.pageIds.length} page${doc.pageIds.length === 1 ? '' : 's'}</span>
                        ${!isGallery ? html`<span>•</span><span>${date}</span>` : null}
                    </div>
                    ${!isGallery && doc.searchIndex && this.query ? html`
                        <div class="mt-2 text-[10px] text-emerald-400 bg-emerald-950/30 px-2 py-1 rounded w-fit flex items-center gap-1">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                            </svg>
                            Text match found
                        </div>
                    ` : null}
                </div>
            </div>
        `;
    }
}