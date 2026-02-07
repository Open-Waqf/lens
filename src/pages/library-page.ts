import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import {getFileStore} from '../services/filestore';
import {bytesToBlob} from '../lib/bytes';
import type {DocRecord} from '../domain/types';

const JUST_SAVED_DOC_KEY = 'sahifah.justSavedDocId';

@customElement('library-page')
export class LibraryPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private docs: DocRecord[] = [];
    @state() private q = '';

    @state() private thumbs: Record<string, string> = {};
    @state() private justSavedDocId: string | null = null;

    private _timer: number | null = null;
    private _sig = '';

    connectedCallback(): void {
        super.connectedCallback();
        this.loadJustSaved();
        void this.refresh();
        this._timer = window.setInterval(() => void this.refresh(), 2000);
    }

    disconnectedCallback(): void {
        if (this._timer) window.clearInterval(this._timer);
        this._timer = null;
        this.revokeThumbs();
        super.disconnectedCallback();
    }

    private loadJustSaved() {
        try {
            this.justSavedDocId = sessionStorage.getItem(JUST_SAVED_DOC_KEY);
        } catch {
            this.justSavedDocId = null;
        }
    }

    private clearJustSaved() {
        try {
            sessionStorage.removeItem(JUST_SAVED_DOC_KEY);
        } catch {
        }
        this.justSavedDocId = null;
    }

    private clearJustSavedIfMatch(docId: string) {
        if (this.justSavedDocId === docId) this.clearJustSaved();
    }

    private revokeThumbs() {
        for (const u of Object.values(this.thumbs)) URL.revokeObjectURL(u);
        this.thumbs = {};
    }

    private async refresh(): Promise<void> {
        const all = await db.docs.orderBy('updatedAt').reverse().toArray();
        const q = this.q.trim().toLowerCase();

        const filtered = q
            ? all.filter(d =>
                d.title.toLowerCase().includes(q) ||
                d.tags.some(t => t.toLowerCase().includes(q)) ||
                (d.folder ?? '').toLowerCase().includes(q)
            )
            : all;

        this.docs = filtered;

        // If the "just saved" doc no longer exists, clear the marker
        if (this.justSavedDocId && !filtered.some(d => d.id === this.justSavedDocId)) {
            this.clearJustSaved();
        }

        // signature to avoid reloading thumbs every poll
        const sig = filtered.map(d => `${d.id}:${d.updatedAt}:${d.pageIds[0] ?? ''}`).join('|');
        if (sig === this._sig) return;
        this._sig = sig;

        await this.refreshThumbs(filtered);
    }

    private async refreshThumbs(docs: DocRecord[]): Promise<void> {
        // rebuild only for visible docs (cap to keep it fast)
        const cap = 30;
        const list = docs.slice(0, cap);

        const store = getFileStore();
        const next: Record<string, string> = {};

        // revoke previous (simple + safe)
        this.revokeThumbs();

        for (const d of list) {
            const firstId = d.pageIds[0];
            if (!firstId) continue;

            const page = await db.pages.get(firstId);
            if (!page) continue;

            try {
                const bytes = await store.get(page.thumbPath);
                const blob = bytesToBlob(bytes, 'image/jpeg');
                next[d.id] = URL.createObjectURL(blob);
            } catch {
                // ignore missing thumb
            }
        }

        this.thumbs = next;
    }

    private async deleteDoc(docId: string): Promise<void> {
        const ok = confirm('Delete this document and all pages? This cannot be undone.');
        if (!ok) return;

        const doc = await db.docs.get(docId);
        if (!doc) return;

        const store = getFileStore();
        const pages = await db.pages.where('docId').equals(docId).toArray();

        for (const p of pages) {
            try {
                await store.del(p.imagePath);
            } catch {
            }
            try {
                await store.del(p.thumbPath);
            } catch {
            }
        }

        if (doc.pdfPath) {
            try {
                await store.del(doc.pdfPath);
            } catch {
            }
        }

        await db.pages.where('docId').equals(docId).delete();
        await db.docs.delete(docId);

        if (this.justSavedDocId === docId) this.clearJustSaved();
        void this.refresh();
    }

    render() {
        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div class="text-lg font-semibold">Library</div>
                    <a class="text-sm text-emerald-400 hover:underline" href="#/scan?new=1">Scan +</a>
                </div>

                <input
                        class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-sm"
                        placeholder="Search title, tags, folder…"
                        .value=${live(this.q)}
                        @input=${(e: Event) => {
            this.q = (e.target as HTMLInputElement).value;
            void this.refresh();
        }}
                />

                <div class="space-y-2">
                    ${this.docs.length === 0
            ? html`<div class="text-slate-500 text-sm">No documents yet.</div>`
            : this.docs.map(d => {
                const isNew = this.justSavedDocId === d.id;

                return html`
                                    <a
                                            class=${[
                    'block p-3 rounded-xl border bg-slate-950 hover:bg-slate-900',
                    isNew ? 'border-emerald-600/70 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]' : 'border-slate-800'
                ].join(' ')}
                                            href=${`#/doc/${d.id}`}
                                            @click=${() => this.clearJustSavedIfMatch(d.id)}
                                    >
                                        <div class="flex items-center gap-3">
                                            <div class="w-14 h-18 rounded-lg overflow-hidden border border-slate-800 bg-black shrink-0">
                                                ${this.thumbs[d.id]
                    ? html`<img src=${this.thumbs[d.id]} class="w-full h-full object-cover" alt="thumb"/>`
                    : html`<div class="w-full h-full"></div>`
                }
                                            </div>

                                            <div class="flex-1 min-w-0">
                                                <div class="flex items-start justify-between gap-2">
                                                    <div class="min-w-0">
                                                        <div class="flex items-center gap-2 min-w-0">
                                                            <div class="font-medium truncate">${d.title}</div>
                                                            ${isNew ? html`
                                                                <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-semibold shrink-0">
                                                                    NEW
                                                                </span>
                                                            ` : null}
                                                        </div>

                                                        <div class="text-xs text-slate-500 mt-1">
                                                            ${new Date(d.updatedAt).toLocaleString()} • ${d.pageIds.length} page(s)
                                                            ${d.folder ? html` • <span class="text-slate-300">${d.folder}</span>` : null}
                                                        </div>
                                                    </div>

                                                    <button
                                                            class="px-2 py-1 rounded-lg bg-red-900/40 border border-red-900 hover:bg-red-900/60 text-red-200 text-xs"
                                                            title="Delete"
                                                            @click=${(ev: Event) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    void this.deleteDoc(d.id);
                }}
                                                    >Delete</button>
                                                </div>

                                                ${d.tags.length ? html`
                                                    <div class="mt-2 flex flex-wrap gap-1">
                                                        ${d.tags.map(t => html`
                                                            <span class="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-200">${t}</span>
                                                        `)}
                                                    </div>
                                                ` : null}
                                            </div>
                                        </div>
                                    </a>
                                `;
            })
        }
                </div>
            </div>
        `;
    }
}
