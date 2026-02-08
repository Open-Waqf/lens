import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {nanoid} from 'nanoid';

import {db} from '../services/db';
import {getPlatformCaps} from '../services/platform';
import {getFileStore} from '../services/filestore';
import {shareOrDownload} from '../services/share';
import {jsonFile, makeZip} from '../lib/zip';
import {decryptBytesWithPassword, encryptBytesWithPassword, isEncryptedBackup} from '../lib/crypto/pbe';
import {opfsRemoveTree} from '../services/filestore/opfs-store';
import {resetAllStorage} from '../services/reset-storage';
import {ConfirmModal} from '../components/confirm-modal';
import pkg from '../../package.json'

import {strFromU8, unzipSync} from 'fflate';
import type {DocRecord, PageRecord} from '../domain/types';

type RestoreMode = 'merge' | 'erase';

@customElement('settings-page')
export class SettingsPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private caps = getPlatformCaps();
    @state() private busy = false;
    @state() private msg: string | null = null;
    @state() private err: string | null = null;

    @state() private showDangerZone = false;
    @state() private deleteConfirmation = '';

    @state() private storageUsed = 0;
    @state() private storageQuota = 0;

    async connectedCallback() {
        super.connectedCallback();
        void this.loadStorageStats();
    }

    private async loadStorageStats() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const est = await navigator.storage.estimate();
                this.storageUsed = est.usage || 0;
                this.storageQuota = est.quota || 0;
            } catch (e) {
                console.warn('Storage estimate failed', e);
            }
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    private async exportBackup(): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        try {
            const store = getFileStore();
            const docs = await db.docs.toArray();
            const pages = await db.pages.toArray();

            const files: Record<string, Uint8Array> = {
                'metadata.json': jsonFile('metadata.json', {docs, pages, exportedAt: Date.now()})['metadata.json'],
            };

            for (const p of pages) {
                try {
                    files[p.imagePath] = await store.get(p.imagePath);
                    files[p.thumbPath] = await store.get(p.thumbPath);
                } catch {
                }
            }
            for (const d of docs) {
                if (d.pdfPath && (await store.exists(d.pdfPath))) {
                    try {
                        files[d.pdfPath] = await store.get(d.pdfPath);
                    } catch {
                    }
                }
            }

            const zipBytes = makeZip(files);

            const pw = await ConfirmModal.prompt({
                title: 'Encrypt Backup',
                description: 'Enter a password to protect your files (Optional).',
                placeholder: 'Password123',
                confirm: 'Export'
            });
            if (pw === null) return; // Cancelled

            const finalBytes = pw ? await encryptBytesWithPassword(zipBytes, pw) : zipBytes;
            const ext = pw ? 'slbk' : 'zip';

            await shareOrDownload(finalBytes, `sahifah-backup-${Date.now()}.${ext}`, 'application/octet-stream');
            this.msg = 'Backup exported successfully.';
        } catch (e) {
            this.err = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }

    private async importBackup(file: File): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        try {
            const buf = new Uint8Array(await file.arrayBuffer());

            // 1) decrypt if needed
            let zipBytes: Uint8Array = buf;
            if (isEncryptedBackup(buf)) {
                const pw = await ConfirmModal.prompt({
                    title: 'Unlock Backup',
                    description: 'This backup is encrypted. Enter password:',
                    placeholder: 'Password',
                    confirm: 'Unlock'
                });
                if (!pw) throw new Error('Restore cancelled.');
                zipBytes = (await decryptBytesWithPassword(buf, pw)) as Uint8Array;
            }

            // 2) unzip
            const unz = unzipSync(zipBytes);
            if (!unz['metadata.json']) throw new Error('metadata.json missing in backup');

            const meta = JSON.parse(strFromU8(unz['metadata.json']));
            const {docs, pages} = meta as { docs: DocRecord[]; pages: PageRecord[] };

            // Ask Mode
            const mode = await this.askRestoreMode(docs.length);
            if (!mode) return;

            const store = getFileStore();

            if (mode === 'erase') {
                try {
                    await opfsRemoveTree('docs');
                } catch {
                }

                await db.transaction('rw', db.docs, db.pages, async () => {
                    await db.docs.clear();
                    await db.pages.clear();
                });

                for (const [name, bytes] of Object.entries(unz)) {
                    if (name === 'metadata.json') continue;
                    if (!name.startsWith('docs/')) continue;
                    await store.put(name, bytes as Uint8Array, guessMime(name));
                }

                await db.transaction('rw', db.docs, db.pages, async () => {
                    await db.docs.bulkAdd(docs);
                    await db.pages.bulkAdd(pages);
                });

                this.msg = 'Library replaced from backup.';
            } else {
                const docIdMap = new Map<string, string>();
                for (const d of docs) docIdMap.set(d.id, nanoid());

                const pageIdMap = new Map<string, string>();
                for (const p of pages) pageIdMap.set(p.id, nanoid());

                const rewritePath = (path: string): string => {
                    const m = path.match(/^docs\/([^/]+)\/(pages|thumbs)\/([^/.]+)(\.[^/]+)$/);
                    if (m) {
                        const [, oldDocId, kind, oldPageId, ext] = m;
                        const newDocId = docIdMap.get(oldDocId);
                        const newPageId = pageIdMap.get(oldPageId);
                        if (!newDocId || !newPageId) return path;
                        return `docs/${newDocId}/${kind}/${newPageId}${ext}`;
                    }
                    return path; // Fallback
                };

                const newDocs = docs.map((d) => ({
                    ...d,
                    id: docIdMap.get(d.id)!,
                    pageIds: (d.pageIds ?? []).map((pid) => pageIdMap.get(pid)!).filter(Boolean),
                    updatedAt: Date.now(),
                    pdfPath: undefined
                }));

                const newPages = pages.map((p) => ({
                    ...p,
                    id: pageIdMap.get(p.id)!,
                    docId: docIdMap.get(p.docId)!,
                    imagePath: rewritePath(p.imagePath),
                    thumbPath: rewritePath(p.thumbPath),
                }));

                for (const [name, bytes] of Object.entries(unz)) {
                    if (!name.startsWith('docs/')) continue;
                    const m = name.match(/^docs\/([^/]+)\//);
                    if (m && docIdMap.has(m[1])) {
                        const newName = rewritePath(name);
                        await store.put(newName, bytes as Uint8Array, guessMime(newName));
                    }
                }

                await db.transaction('rw', db.docs, db.pages, async () => {
                    await db.docs.bulkAdd(newDocs);
                    await db.pages.bulkAdd(newPages);
                });
                this.msg = `Merged ${newDocs.length} documents from backup.`;
            }
        } catch (e) {
            this.err = (e as Error).message;
        } finally {
            this.busy = false;
            void this.loadStorageStats();
        }
    }

    private async askRestoreMode(count: number): Promise<RestoreMode | null> {
        const raw = prompt(
            `Backup contains ${count} documents.\n\nType MERGE to add them to your library.\nType ERASE to replace your library (destroys current data).`,
            'MERGE',
        );
        if (!raw) return null;
        const v = raw.trim().toUpperCase();
        if (v === 'MERGE') return 'merge';
        if (v === 'ERASE') {
            return 'erase';
        }
        return null;
    }

    private async nukeEverything() {
        if (this.deleteConfirmation !== 'DELETE') {
            this.msg = 'Please type DELETE to confirm.';
            return;
        }

        if (!confirm('Final Warning: This will wipe ALL documents and settings. This cannot be undone.')) {
            return;
        }

        this.busy = true;
        this.msg = 'Wiping data...';
        try {
            await resetAllStorage();
            location.reload();
        } catch (e) {
            this.msg = `Failed to reset: ${e}`;
            this.busy = false;
        }
    }

    render() {
        const pct = this.storageQuota > 0 ? (this.storageUsed / this.storageQuota) * 100 : 0;
        const color = pct > 90 ? 'bg-red-500' : (pct > 70 ? 'bg-amber-500' : 'bg-emerald-500');

        return html`
            <div class="space-y-6 pb-20">
                <div class="flex items-center gap-3">
                    <button class="p-2 rounded-full hover:bg-slate-800" @click=${() => location.hash = '#/library'}>
                        <svg class="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M15 19l-7-7 7-7"></path>
                        </svg>
                    </button>
                    <h1 class="text-xl font-bold text-slate-100">Settings</h1>
                    <div class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">v${pkg.version}
                    </div>
                </div>

                ${this.msg ? html`
                    <div class="p-4 rounded-lg bg-slate-800 text-emerald-400 border border-emerald-900/50">${this.msg}
                    </div>` : null}
                ${this.err ? html`
                    <div class="p-4 rounded-lg bg-red-950/40 text-red-200 border border-red-900">${this.err}
                    </div>` : null}

                <section class="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-2">
                    <div class="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                        Privacy & Security
                    </div>
                    <p class="text-xs text-slate-300 leading-relaxed">
                        This app is <strong>Offline Only</strong>. Your documents are stored locally on this device and
                        are never sent to any cloud server.
                    </p>
                    <p class="text-xs text-slate-400">
                        We cannot see, read, or recover your data. Please use the Backup feature to keep your data safe.
                    </p>
                </section>

                <section class="space-y-2">
                    <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                        <span>Local Storage</span>
                        <span>${this.formatBytes(this.storageUsed)} / ${this.formatBytes(this.storageQuota)}</span>
                    </div>
                    <div class="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div class="h-full ${color} transition-all duration-500"
                             style="width: ${Math.max(2, pct)}%"></div>
                    </div>
                    <div class="text-[10px] text-slate-500">
                        Managed by browser. The OS may clear this if device storage is critically low.
                    </div>
                </section>

                <section class="space-y-3">
                    <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">Data Management</h2>

                    <div class="grid gap-3">
                        <button class="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
                                ?disabled=${this.busy} @click=${() => this.exportBackup()}>
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-lg bg-emerald-900/30 text-emerald-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                                    </svg>
                                </div>
                                <div class="text-left">
                                    <div class="text-slate-200 font-medium">Export Backup</div>
                                    <div class="text-xs text-slate-500">Save library to .slbk file</div>
                                </div>
                            </div>
                        </button>

                        <label class="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors cursor-pointer">
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-lg bg-blue-900/30 text-blue-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m-4 4v12"></path>
                                    </svg>
                                </div>
                                <div class="text-left">
                                    <div class="text-slate-200 font-medium">Restore Backup</div>
                                    <div class="text-xs text-slate-500">Merge or replace library</div>
                                </div>
                            </div>
                            <input class="hidden" type="file" accept=".slbk,.zip" ?disabled=${this.busy}
                                   @change=${(e: Event) => {
                                       const f = (e.target as HTMLInputElement).files?.[0];
                                       if (f) void this.importBackup(f);
                                   }}/>
                        </label>
                    </div>
                </section>

                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-2">
                    <div class="text-xs font-mono text-slate-500">System Capabilities</div>
                    <div class="text-xs text-slate-600">Capacitor: ${this.caps.isCapacitor} • OPFS: ${this.caps.hasOPFS}
                        • Share: ${this.caps.hasWebShare}
                    </div>
                </div>

                <section class="space-y-3 pt-6 border-t border-slate-800">
                    <h2 class="text-sm font-semibold text-red-400 uppercase tracking-wider">Danger Zone</h2>

                    ${!this.showDangerZone ? html`
                        <button class="w-full p-4 rounded-xl bg-slate-900 border border-red-900/30 text-red-400 hover:bg-red-950/20 transition-colors text-sm font-medium"
                                @click=${() => this.showDangerZone = true}>
                            Show Destructive Options
                        </button>
                    ` : html`
                        <div class="p-4 rounded-xl bg-red-950/10 border border-red-900/50 space-y-4">
                            <div class="text-sm text-red-200">
                                <p class="font-bold mb-1">Erase All Data</p>
                                <p class="opacity-80">This will permanently delete all scanned documents and reset the
                                    app to factory settings. This action cannot be undone.</p>
                            </div>

                            <div class="space-y-2">
                                <label class="text-xs text-red-400">Type "DELETE" to confirm</label>
                                <input type="text"
                                       class="w-full bg-slate-950 border border-red-900/50 rounded-lg px-3 py-2 text-red-100 placeholder-red-900/50 focus:outline-none focus:border-red-500"
                                       placeholder="DELETE"
                                       .value=${this.deleteConfirmation}
                                       @input=${(e: Event) => this.deleteConfirmation = (e.target as HTMLInputElement).value}
                                />
                            </div>

                            <button class="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    ?disabled=${this.deleteConfirmation !== 'DELETE' || this.busy}
                                    @click=${() => this.nukeEverything()}>
                                ${this.busy ? 'Erasing...' : 'Erase Everything'}
                            </button>
                        </div>
                    `}
                </section>
            </div>
        `;
    }
}

function guessMime(path: string): string {
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
}
