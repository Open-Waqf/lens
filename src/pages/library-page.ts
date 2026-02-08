import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import type {DocRecord} from '../domain/types';
import {ScanRepo} from './scan/scan-repo';
// Fix: Ensure bytesToBlob is imported
import {bytesToBlob} from '../lib/bytes';

@customElement('library-page')
export class LibraryPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    private repo = new ScanRepo();

    @state() private docs: DocRecord[] = [];
    @state() private query = '';
    @state() private thumbnails = new Map<string, string>();

    async connectedCallback() {
        super.connectedCallback();
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
    }

    private async loadThumbnails(docs: DocRecord[]) {
        for (const doc of docs.slice(0, 15)) {
            if (this.thumbnails.has(doc.id)) continue;

            const strip = await this.repo.getDocStrip(doc.id, 1);
            if (strip?.items[0]) {
                // FIX: Use helper to satisfy TS strict ArrayBuffer checks
                const blob = bytesToBlob(strip.items[0].thumbBytes, 'image/jpeg');
                const url = URL.createObjectURL(blob);
                this.thumbnails.set(doc.id, url);
            }
        }
        this.requestUpdate();
    }

    private get filteredDocs() {
        const q = this.query.trim().toLowerCase();
        if (!q) return this.docs;

        return this.docs.filter(d => {
            if (d.title.toLowerCase().includes(q)) return true;
            if (d.tags.some(t => t.toLowerCase().includes(q))) return true;
            if (d.searchIndex && d.searchIndex.toLowerCase().includes(q)) return true;
            return false;
        });
    }

    render() {
        const list = this.filteredDocs;

        return html`
            <div class="space-y-4 pb-20">
                <div class="sticky top-0 bg-black/80 backdrop-blur-md pt-4 pb-2 z-10 space-y-3">
                    <div class="flex items-center justify-between">
                        <h1 class="text-2xl font-bold text-slate-100">Library</h1>
                        <button class="p-2 rounded-full hover:bg-slate-800"
                                @click=${() => location.hash = '#/settings'}>
                            <svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            </svg>
                        </button>
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
                </div>

                ${list.length === 0
                        ? html`
                            <div class="flex flex-col items-center justify-center py-20 text-slate-500">
                                <svg class="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor"
                                     viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                </svg>
                                <p>${this.query ? 'No matching documents' : 'Your library is empty'}</p>
                            </div>
                        `
                        : html`
                            <div class="grid grid-cols-1 gap-3">
                                ${repeat(list, (d) => d.id, (d) => this.renderDocItem(d))}
                            </div>
                        `
                }

                <button
                        class="fixed bottom-6 right-6 w-14 h-14 bg-emerald-500 hover:bg-emerald-400 rounded-full shadow-lg shadow-emerald-900/40 flex items-center justify-center text-slate-900 transition-transform active:scale-95"
                        @click=${() => location.hash = '#/scan?new=1'}
                >
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                </button>
            </div>
        `;
    }

    private renderDocItem(doc: DocRecord) {
        const thumb = this.thumbnails.get(doc.id);
        const date = new Date(doc.updatedAt).toLocaleDateString();

        return html`
            <div class="flex bg-slate-900 border border-slate-800 rounded-xl overflow-hidden active:bg-slate-800 transition-colors cursor-pointer"
                 @click=${() => location.hash = `#/doc/${doc.id}`}>

                <div class="w-20 h-24 bg-slate-950 shrink-0 relative">
                    ${thumb
                            ? html`<img src=${thumb} class="w-full h-full object-cover opacity-90">`
                            : html`
                                <div class="w-full h-full flex items-center justify-center text-slate-700">
                                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                    </svg>
                                </div>`
                    }
                </div>

                <div class="p-3 flex-1 min-w-0 flex flex-col justify-center">
                    <h3 class="text-slate-200 font-medium truncate leading-tight mb-1">${doc.title}</h3>
                    <div class="flex items-center gap-2 text-xs text-slate-500">
                        <span>${doc.pageIds.length} page${doc.pageIds.length === 1 ? '' : 's'}</span>
                        <span>•</span>
                        <span>${date}</span>
                    </div>
                    ${doc.searchIndex && this.query ? html`
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