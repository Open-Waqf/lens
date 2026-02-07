import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {live} from 'lit/directives/live.js';

import {db} from '../services/db';
import type {DocRecord} from '../domain/types';

const APPEND_DOC_KEY = 'sahifah.appendToDocId';

@customElement('library-page')
export class LibraryPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private docs: DocRecord[] = [];
    @state() private q = '';

    private _timer: number | null = null;

    connectedCallback(): void {
        super.connectedCallback();
        void this.refresh();

        // MVP: poll lightly so the list updates after scans without needing hooks/events
        this._timer = window.setInterval(() => void this.refresh(), 1200);
    }

    disconnectedCallback(): void {
        if (this._timer) window.clearInterval(this._timer);
        this._timer = null;
        super.disconnectedCallback();
    }

    private async refresh(): Promise<void> {
        const all = await db.docs.orderBy('updatedAt').reverse().toArray();
        const q = this.q.trim().toLowerCase();

        this.docs = q
            ? all.filter(d =>
                d.title.toLowerCase().includes(q) ||
                d.tags.some(t => t.toLowerCase().includes(q)) ||
                (d.folder ?? '').toLowerCase().includes(q)
            )
            : all;
    }

    private goScanNew(): void {
        // Ensure we're not in append mode
        try {
            localStorage.removeItem(APPEND_DOC_KEY);
        } catch {
        }
        location.hash = '#/scan';
    }

    private goImportNew(): void {
        // Ensure we're not in append mode
        try {
            localStorage.removeItem(APPEND_DOC_KEY);
        } catch {
        }
        location.hash = '#/scan?import=1';
    }

    render() {
        return html`
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-lg font-semibold">Library</div>

                    <div class="flex gap-2">
                        <button
                                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700"
                                @click=${() => this.goImportNew()}
                                title="Create a new document from photos"
                        >
                            Import
                        </button>
                        <button
                                class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                @click=${() => this.goScanNew()}
                                title="Scan a new document"
                        >
                            Scan
                        </button>
                    </div>
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
                            ? html`
                                <div class="text-slate-500 text-sm">No documents yet. Tap <span
                                        class="text-slate-300 font-medium">Scan</span> to create one.
                                </div>`
                            : this.docs.map(d => html`
                                <a
                                        class="block p-4 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900"
                                        href=${`#/doc/${d.id}`}
                                >
                                    <div class="flex items-start justify-between gap-3">
                                        <div>
                                            <div class="font-medium">${d.title}</div>
                                            <div class="text-xs text-slate-500 mt-1">
                                                ${new Date(d.updatedAt).toLocaleString()} • ${d.pageIds.length} page(s)
                                                ${d.folder ? html` • <span
                                                        class="text-slate-300">${d.folder}</span>` : null}
                                            </div>

                                            ${d.tags.length ? html`
                                                <div class="mt-2 flex flex-wrap gap-1">
                                                    ${d.tags.map(t => html`
                                                        <span class="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-200">${t}</span>
                                                    `)}
                                                </div>
                                            ` : null}
                                        </div>

                                        <div class="text-slate-400">›</div>
                                    </div>
                                </a>
                            `)}
                </div>
            </div>
        `;
    }
}