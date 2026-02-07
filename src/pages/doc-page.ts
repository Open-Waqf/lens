import {html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {shareOrDownload} from '../services/share';
import {buildPdfForDoc} from '../lib/pdf';
import {jsonFile, makeZip} from '../lib/zip';

import type {DocRecord, PageRecord} from '../domain/types';
import {toArrayBuffer} from "../lib/bytes";

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
        // enforce doc.pageIds ordering
        const map = new Map(pages.map(p => [p.id, p]));
        this.pages = doc.pageIds.map(id => map.get(id)).filter(Boolean) as PageRecord[];

        // load thumbs
        const store = getFileStore();
        const thumbs: Record<string, string> = {};
        for (const p of this.pages) {
            const bytes = await store.get(p.thumbPath);
            const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], {type: 'image/jpeg'}));
            thumbs[p.id] = url;
        }
        // revoke old
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

            // optionally store pointer
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

            // delete binaries
            await store.del(page.imagePath);
            await store.del(page.thumbPath);

            // delete page record
            await db.pages.delete(pageId);

            // update doc ordering
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
                } catch { /* ignore */
                }
            }

            // clear possible active draft pointer
            try {
                const key = 'sahifah.activeDocId';
                if (localStorage.getItem(key) === this.doc.id) localStorage.removeItem(key);
            } catch {
                // ignore
            }

            try {
                const k = 'sahifah.appendToDocId';
                if (localStorage.getItem(k) === this.doc.id) localStorage.removeItem(k);
            } catch {
            }

            await db.pages.where('docId').equals(this.doc.id).delete();
            await db.docs.delete(this.doc.id);

            // go back
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

        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <a class="text-sm text-slate-300 hover:underline" href="#/library">← Back</a>
                </div>

                ${this.error ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.error}
                    </div>` : null}

                ${this.justImported ? html`
                    <div class="p-3 rounded-xl border border-emerald-900 bg-emerald-950/30 text-emerald-100">
                        Imported pages. You can <span class="font-semibold">reorder</span> or <span
                            class="font-semibold">delete</span> pages below.
                        Use <span class="font-semibold">Add pages</span> to scan more.
                    </div>
                ` : null}


                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="text-sm text-slate-400">Title</div>
                    <input
                            class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                            .value=${live(this.doc.title)}
                            @change=${(e: Event) => this.saveMeta({title: (e.target as HTMLInputElement).value})}
                    />

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <div class="text-sm text-slate-400">Folder (name)</div>
                            <input
                                    class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                                    placeholder="e.g., Receipts"
                                    .value=${live(this.doc.folder ?? '')}
                                    @change=${(e: Event) => {
                                        const v = (e.target as HTMLInputElement).value.trim();
                                        void this.saveMeta({folder: v ? v : null});
                                    }}
                            />
                        </div>
                        <div>
                            <div class="text-sm text-slate-400">Tags (comma-separated)</div>
                            <input
                                    class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                                    placeholder="e.g., taxi, 2026, client"
                                    .value=${live(this.doc.tags.join(', '))}
                                    @change=${(e: Event) => {
                                        const v = (e.target as HTMLInputElement).value
                                                .split(',')
                                                .map(s => s.trim())
                                                .filter(Boolean);
                                        void this.saveMeta({tags: v});
                                    }}
                            />
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <button
                                class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                ?disabled=${this.busy || this.pages.length === 0}
                                @click=${this.exportPdf}
                        >
                            ${this.busy ? 'Working…' : 'Export PDF'}
                        </button>
                        <button
                                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                ?disabled=${this.busy || this.pages.length === 0}
                                @click=${this.exportImagesZip}
                        >
                            Export images (zip)
                        </button>
                        <button
                                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${() => {
                                    if (!this.doc) return;
                                    try {
                                        localStorage.removeItem('sahifah.activeDocId');
                                    } catch {
                                    }
                                    localStorage.setItem('sahifah.appendToDocId', this.doc.id);
                                    location.hash = '#/scan';
                                }}
                        >
                            Add pages
                        </button>
                        <button
                                class="px-4 py-2 rounded-xl bg-red-900/40 border border-red-900 hover:bg-red-900/60 text-red-200 disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${this.deleteDoc}
                        >
                            Delete document
                        </button>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <div class="text-lg font-semibold">Pages (${this.pages.length})</div>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        ${this.pages.map((p, idx) => html`
                            <div class="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                                <div class="aspect-[3/4] bg-black">
                                    <img class="w-full h-full object-cover" src=${this.thumbs[p.id]} alt="thumb"/>
                                </div>
                                <div class="p-2 flex items-center justify-between gap-2">
                                    <div class="text-xs text-slate-400">#${idx + 1}</div>
                                    <div class="flex gap-1">
                                        <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                                                @click=${() => this.movePage(p.id, -1)}>↑
                                        </button>
                                        <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                                                @click=${() => this.movePage(p.id, 1)}>↓
                                        </button>
                                        <button
                                                class="px-2 py-1 rounded bg-red-900/40 border border-red-900 hover:bg-red-900/60 text-red-200 text-xs disabled:opacity-60"
                                                ?disabled=${this.busy}
                                                @click=${() => this.deletePage(p.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `)}
                    </div>
                </div>
            </div>
        `;
    }
}

function safeName(s: string): string {
    return s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 120).trim() || 'document';
}
