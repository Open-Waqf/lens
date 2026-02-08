import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import {db} from '../services/db';
import {getPlatformCaps} from '../services/platform';
import {getFileStore} from '../services/filestore';
import {shareOrDownload} from '../services/share';
import {jsonFile, makeZip} from '../lib/zip';
import {decryptBytesWithPassword, encryptBytesWithPassword, isEncryptedBackup} from '../lib/crypto/pbe';

import {strFromU8, unzipSync} from 'fflate';

@customElement('settings-page')
export class SettingsPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private caps = getPlatformCaps();
    @state() private busy = false;
    @state() private msg: string | null = null;
    @state() private err: string | null = null;

    private async exportBackup(): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        try {
            const store = getFileStore();
            const docs = await db.docs.toArray();
            const pages = await db.pages.toArray();

            const files: Record<string, Uint8Array> = {
                ...jsonFile('metadata.json', {docs, pages, exportedAt: Date.now()})
            };

            // include binaries
            for (const p of pages) {
                files[p.imagePath] = await store.get(p.imagePath);
                files[p.thumbPath] = await store.get(p.thumbPath);
            }
            for (const d of docs) {
                if (d.pdfPath && (await store.exists(d.pdfPath))) {
                    files[d.pdfPath] = await store.get(d.pdfPath);
                }
            }

            const zipBytes = makeZip(files);

            // Ask user for password (simple version)
            const pw = prompt('Set a password to encrypt your backup.\n\nIf you lose it, you cannot restore the backup.');
            if (!pw) return;

            const encrypted = await encryptBytesWithPassword(zipBytes, pw);

            await shareOrDownload(encrypted, `sahifah-backup-${Date.now()}.slbk`, 'application/octet-stream');
            this.msg = 'Backup exported.';
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
            const zipBytes = isEncryptedBackup(buf)
                ? await (async () => {
                    const pw = prompt('Enter backup password');
                    if (!pw) throw new Error('Restore cancelled.');
                    return await decryptBytesWithPassword(buf, pw);
                })()
                : buf;

            // 2) now unzip
            const unz = unzipSync(zipBytes);

            if (!unz['metadata.json']) throw new Error('metadata.json missing in backup');

            const meta = JSON.parse(strFromU8(unz['metadata.json']));
            const {docs, pages} = meta as { docs: any[]; pages: any[] };

            const store = getFileStore();

            for (const [name, bytes] of Object.entries(unz)) {
                if (name === 'metadata.json') continue;
                if (!name.startsWith('docs/')) continue;
                await store.put(name, bytes, guessMime(name));
            }

            await db.transaction('rw', db.docs, db.pages, async () => {
                await db.docs.clear();
                await db.pages.clear();
                await db.docs.bulkAdd(docs);
                await db.pages.bulkAdd(pages);
            });

            this.msg = 'Backup restored.';
        } catch (e) {
            this.err = (e as Error).message;
        } finally {
            this.busy = false;
        }
    }


    render() {
        return html`
            <div class="space-y-4">
                <div class="text-lg font-semibold">Settings</div>

                ${this.msg ? html`
                    <div class="p-3 rounded-lg bg-emerald-950/40 border border-emerald-900 text-emerald-200">
                        ${this.msg}
                    </div>` : null}
                ${this.err ? html`
                    <div class="p-3 rounded-lg bg-red-950/40 border border-red-900 text-red-200">${this.err}
                    </div>` : null}

                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-2">
                    <div class="text-sm text-slate-300 font-medium">Capabilities</div>
                    <div class="text-sm text-slate-400">Capacitor: ${String(this.caps.isCapacitor)}</div>
                    <div class="text-sm text-slate-400">OPFS: ${String(this.caps.hasOPFS)}</div>
                    <div class="text-sm text-slate-400">Web Share: ${String(this.caps.hasWebShare)}</div>
                    <div class="text-sm text-slate-400">Camera stream: ${String(this.caps.hasCameraStream)}</div>
                </div>

                <div class="p-4 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
                    <div class="text-sm text-slate-300 font-medium">Backup (mandatory trust feature)</div>
                    <div class="flex flex-wrap gap-2">
                        <button
                                class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                                ?disabled=${this.busy}
                                @click=${this.exportBackup}
                        >
                            Export backup (.slbk)
                        </button>

                        <label class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 cursor-pointer disabled:opacity-60">
                            Restore backup
                            <input
                                    class="hidden"
                                    type="file"
                                    accept=".slbk,.zip,application/octet-stream,application/zip"
                                    ?disabled=${this.busy}
                                    @change=${(e: Event) => {
                                        const f = (e.target as HTMLInputElement).files?.[0];
                                        if (f) void this.importBackup(f);
                                    }}
                            />
                        </label>
                    </div>

                    <div class="text-xs text-slate-500">
                        Everything stays local unless you export/share. No account required.
                    </div>
                </div>
            </div>
        `;
    }
}

function guessMime(path: string): string {
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
}
