import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {haptics} from '../services/haptics';

import JSZip from 'jszip';
import {db} from '../services/db';
import {getPlatformCaps} from '../services/platform';
import {tryPersistStorage} from '../services/persist';
import {getFileStore} from '../services/filestore';
import {shareFile} from '../services/share';
import {jsonFile, type ZipFileEntry, zipFilesToStream} from '../lib/zip';
import {decryptStream, encryptStream} from '../lib/crypto/pbe';
import {resetAllStorage} from '../services/reset-storage';
import {ConfirmModal} from '../components/confirm-modal';
import pkg from '../../package.json'
import {settings} from '../services/settings';
import {AuthService} from '../services/auth-service';
import {OPFSStreamWriter} from '../services/filestore/opfs-store';

import {repairLibrary} from '../services/repair';

type RestoreMode = 'merge' | 'replace';

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
    @state() private lastBackupDate: number | null = null;

    // Initialize with defaults, update in connectedCallback
    @state() private requireAuth = false;
    @state() private defaultVault = false;

    private showAdvancedSecurity = false;

    // Progress State
    @state() private backupProgress = 0;
    @state() private backupTotal = 0;

    @state() private showRepairTool = false;
    @state() private repairProgress = '';

    @state() private enableOcr = true;

    async connectedCallback() {
        super.connectedCallback();
        await this._refreshSettings();
        this.lastBackupDate = Number(localStorage.getItem('sahifah.lastBackup')) || null;
        void this.loadStorageStats();
        void tryPersistStorage();
        if (location.hash.includes('repair=1')) {
            this.showRepairTool = true;
        }

        // 3. SECRET COMMAND: Expose a global function for manual trigger
        // Usage: Type 'sahifahRepair()' in DevTools Console
        (window as any).sahifahRepair = () => {
            this.showRepairTool = true;
            this.msg = "Maintenance Mode Enabled 🛠️";
            this.requestUpdate();
        };
    }

    private async runRepair() {
        this.busy = true;
        this.repairProgress = 'Starting scan...';

        try {
            await repairLibrary((_curr, _total, msg) => {
                this.repairProgress = msg;
                this.requestUpdate();
            });
            this.msg = "Library repair complete.";
        } catch (e) {
            this.err = "Repair failed: " + String(e);
        } finally {
            this.busy = false;
        }
    }

    private async _refreshSettings() {
        const s = await settings.get();
        this.requireAuth = s.requireAuth;
        this.defaultVault = s.defaultVault;
        this.enableOcr = s.enableOcr;
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

    private toggleOcr() {
        void haptics.selection();
        this.enableOcr = !this.enableOcr;
        settings.setOcr(this.enableOcr);
    }

    private async toggleAuth() {
        void haptics.selection();

        // Optimistic update: Flip it first
        const nextState = !this.requireAuth;
        this.requireAuth = nextState;

        if (nextState === true) {
            // Trying to ENABLE
            const success = await AuthService.setupAuth();
            if (!success) {
                // Failed! Revert immediately
                this.requireAuth = false;
                this.msg = "Setup cancelled or biometrics not available.";
                this.requestUpdate(); // Force UI re-render to uncheck box
                return;
            }
        }

        // Only save if success (or if disabling)
        await settings.setAuth(nextState);
    }

    private toggleDefaultVault() {
        this.defaultVault = !this.defaultVault;
        settings.setVault(this.defaultVault);
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    private async* fileGenerator(): AsyncGenerator<ZipFileEntry> {
        const store = getFileStore();
        const docs = await db.docs.toArray();
        const pages = await db.pages.toArray();

        this.backupTotal = docs.length + (pages.length * 2);
        this.backupProgress = 0;

        yield jsonFile('metadata.json', {docs, pages, exportedAt: Date.now()});

        for (const p of pages) {
            try {
                const img = await store.get(p.imagePath);
                yield {name: p.imagePath, data: img};
                this.backupProgress++;
                this.requestUpdate();

                const thumb = await store.get(p.thumbPath);
                yield {name: p.thumbPath, data: thumb};
                this.backupProgress++;
                this.requestUpdate();
            } catch (e) {
                console.warn(`Skipping missing file: ${p.id}`, e);
            }
        }
        for (const d of docs) {
            if (d.pdfPath && (await store.exists(d.pdfPath))) {
                try {
                    const pdf = await store.get(d.pdfPath);
                    yield {name: d.pdfPath, data: pdf};
                } catch (e) {
                    console.warn(`Backup: Failed to read PDF for doc ${d.id}`, e);
                }
            }
        }
    }

    private async exportBackup(): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        // Temporary file path in OPFS
        const tempPath = `exports/temp_backup_${Date.now()}.slbk`;
        const writer = new OPFSStreamWriter(tempPath);

        try {
            const pw = await ConfirmModal.prompt({
                title: 'Encrypt Backup',
                description: 'Enter a password to protect your files (Optional).',
                placeholder: 'Password123',
                confirm: 'Export'
            });
            if (pw === null) {
                this.busy = false;
                return;
            }

            this.msg = 'Packaging backup...';
            this.requestUpdate();

            // 1. Open the file stream
            await writer.open();

            // 2. Setup the Zip/Encrypt Pipeline
            const zipStream = zipFilesToStream(this.fileGenerator(), () => {
                // Tracking happens in generator
            });

            const finalStream = pw ? encryptStream(zipStream, pw) : zipStream;

            // 3. Pump chunks directly to disk
            for await (const chunk of finalStream) {
                await writer.write(chunk);
            }

            // 4. Close and get the File handle (points to disk, not RAM)
            const file = await writer.close();

            // 5. Share/Download the File object
            const ext = pw ? 'slbk' : 'zip';
            const finalName = `sahifah-backup-${Date.now()}.${ext}`;

            // We must rename the file for the share API to be happy with the extension
            const namedFile = new File([file], finalName, {
                type: 'application/octet-stream',
                lastModified: Date.now()
            });

            await shareFile(namedFile, finalName);

            const now = Date.now();
            localStorage.setItem('sahifah.lastBackup', String(now));
            this.lastBackupDate = now;
            this.msg = 'Backup exported successfully.';

        } catch (e) {
            this.err = (e as Error).message;
            console.error(e);
        } finally {
            // Clean up: try to close writer if it failed
            try {
                await writer.close();
            } catch {
            }
            // Clean up: delete the temp file
            try {
                // You might need to import opfsRemoveEntry
                const {opfsRemoveEntry} = await import('../services/filestore/opfs-store');
                await opfsRemoveEntry(tempPath);
            } catch {
            }

            this.busy = false;
            this.backupProgress = 0;
            this.backupTotal = 0;
        }
    }

    /**
     * Helper to clear existing data if "Replace" mode is chosen
     */
    private async resetLibraryForRestore(): Promise<void> {
        // Clear DB
        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.docs.clear();
            await db.pages.clear();
        });
    }

    /**
     * Extracts the zip file and restores data to DB and OPFS.
     * This moves the logic out of the main importBackup function.
     */
    private async restoreFromZip(file: File): Promise<void> {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);

        // 1. Read Metadata
        const metaFile = loadedZip.file('metadata.json');
        if (!metaFile) throw new Error('Invalid backup: missing metadata');

        const metaStr = await metaFile.async('string');
        const backupData = JSON.parse(metaStr);

        // 2. Ask User for Mode
        const mode = await this.askRestoreMode(backupData.pages.length);
        if (!mode) return;

        if (mode === 'replace') {
            await this.resetLibraryForRestore();
        }

        const store = getFileStore();

        // 3. Get all file entries first
        const fileEntries: Array<{ path: string, entry: JSZip.JSZipObject }> = [];
        loadedZip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && relativePath !== 'metadata.json') {
                fileEntries.push({path: relativePath, entry: zipEntry});
            }
        });

        // 4. SEQUENTIAL WRITE (Fixes OOM Crash)
        this.backupTotal = fileEntries.length;
        this.backupProgress = 0;

        for (const {path, entry} of fileEntries) {
            try {
                // SECURITY FIX: Sanitize path before writing
                const safePath = sanitizePath(path);

                const data = await entry.async('uint8array');
                await store.put(safePath, data, 'image/jpeg');

                this.backupProgress++;
                this.requestUpdate(); // Update UI progress bar
            } catch (e) {
                console.warn((e as Error).message);
            }
        }

        // 5. Restore Database Records
        await db.transaction('rw', db.docs, db.pages, async () => {
            for (const doc of backupData.docs) await db.docs.put(doc);
            for (const page of backupData.pages) await db.pages.put(page);
        });

        this.msg = `Restore complete. Processed ${this.backupProgress} files.`;
    }

    private async importBackup(file: File): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        // Use a temporary file path in OPFS
        const tempPath = `imports/temp_restore_${Date.now()}.zip`;
        const writer = new OPFSStreamWriter(tempPath);

        try {
            const pw = await ConfirmModal.prompt({
                title: 'Decrypt Backup',
                description: 'Enter password (leave empty if not encrypted)',
                placeholder: 'Password',
                confirm: 'Restore'
            });

            if (pw === null) {
                this.busy = false;
                return;
            }

            this.msg = 'Decrypting stream...';
            this.requestUpdate();

            await writer.open();
            const fileStream = file.stream();

            if (pw) {
                // SECURE PATH: Stream decryption
                for await (const chunk of decryptStream(fileStream, pw)) {
                    await writer.write(chunk);
                }
            } else {
                // PLAIN PATH: Copy file directly
                const reader = fileStream.getReader();
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    await writer.write(value);
                }
                reader.releaseLock();
            }

            // Close to flush to disk
            const decryptedFile = await writer.close();

            this.msg = 'Unpacking library...';
            this.requestUpdate();

            // Pass the disk-backed file to your existing zip handler
            await this.restoreFromZip(decryptedFile);

            this.msg = 'Restore complete! You can return to the Library.';

        } catch (e) {
            console.error(e);
            this.err = 'Restore failed: ' + (e as Error).message;
        } finally {
            try {
                await writer.close();
            } catch {
            }
            this.busy = false;
        }
    }

    private async askRestoreMode(count: number): Promise<RestoreMode | null> {
        const res = await ConfirmModal.prompt({
            title: 'Restore Backup',
            description: `Backup contains ${count} documents.\nType MERGE to add them.\nType ERASE to replace your library.`,
            placeholder: 'MERGE or REPLACE',
            confirm: 'Continue'
        });

        if (!res) return null;
        const v = res.trim().toUpperCase();
        if (v === 'MERGE') return 'merge';
        if (v === 'REPLACE') return 'replace';
        return null;
    }

    private async nukeEverything() {
        if (this.deleteConfirmation !== 'DELETE') {
            this.msg = 'Please type DELETE to confirm.';
            return;
        }

        const ok = await ConfirmModal.ask({
            title: 'Final Warning',
            description: 'This will wipe ALL documents and settings. This cannot be undone.',
            confirm: 'Wipe Everything',
            destructive: true
        });

        if (!ok) return;

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

    private renderProgressOverlay() {
        if (!this.busy || this.backupTotal === 0) return null;
        const pct = Math.round((this.backupProgress / this.backupTotal) * 100);

        return html`
            <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div class="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl">
                    <div class="flex items-center justify-between">
                        <div class="font-bold text-slate-100">Creating Backup</div>
                        <div class="text-sm text-emerald-400 font-mono">${pct}%</div>
                    </div>
                    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 transition-all duration-200" style="width: ${pct}%"></div>
                    </div>
                    <div class="text-xs text-slate-400 text-center">
                        Processing item ${this.backupProgress} of ${this.backupTotal}
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="space-y-6 pb-20">
                ${this.renderProgressOverlay()}
                ${this.renderHeader()}
                ${this.renderAlerts()}
                ${this.renderPrivacySection()}
                ${this.renderProcessingSection()}

                ${this.renderSecuritySection()}

                ${this.renderStorageSection()}
                ${this.renderDataManagement()}
                ${this.renderSystemInfo()}
                ${this.renderDangerZone()}
            </div>
        `;
    }

    private renderHeader() {
        return html`
            <div class="flex items-center gap-3 pb-2">
                <h1 class="text-2xl font-bold text-slate-100">Settings</h1>
                <div class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono mt-1">
                        v${pkg.version}
                </div>
            </div>
        `;
    }

    private renderAlerts() {
        return html`
            ${this.msg ? html`
                <div class="p-4 rounded-lg bg-slate-800 text-emerald-400 border border-emerald-900/50">${this.msg}
                </div>` : null}
            ${this.err ? html`
                <div class="p-4 rounded-lg bg-red-950/40 text-red-200 border border-red-900">${this.err}</div>` : null}
        `;
    }

    private renderPrivacySection() {
        return html`
            <section class="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-2">
                <div class="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                    </svg>
                    Privacy & Security
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">
                    This app is <strong>Offline Only</strong>. Your documents are stored locally and are never sent to
                    any cloud server.
                </p>
            </section>
        `;
    }

    private renderSecuritySection() {
        return html`
            <section class="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-4">
                <div class="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                    </svg>
                    Advanced Protection
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm text-slate-200">App Lock</div>
                        <div class="text-[10px] text-slate-500">Require Biometrics to open app</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors ${this.requireAuth ? 'bg-emerald-600' : 'bg-slate-700'}"
                            @click=${this.toggleAuth}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.requireAuth ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>

                ${this.showAdvancedSecurity ? html`
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="text-sm text-slate-200">Vault Mode (Default)</div>
                            <div class="text-[10px] text-slate-500">Encrypt image files at rest by default</div>
                        </div>
                        <button class="relative h-6 w-11 rounded-full transition-colors ${this.defaultVault ? 'bg-emerald-600' : 'bg-slate-700'}"
                                @click=${this.toggleDefaultVault}>
                            <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.defaultVault ? 'translate-x-5' : ''}"></span>
                        </button>
                    </div>
                ` : null}
            </section>
        `;
    }

    private renderStorageSection() {
        const pct = this.storageQuota > 0 ? (this.storageUsed / this.storageQuota) * 100 : 0;
        const color = pct > 90 ? 'bg-red-500' : (pct > 70 ? 'bg-amber-500' : 'bg-emerald-500');
        return html`
            <section class="space-y-2">
                <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    <span>Local Storage</span>
                    <span>${this.formatBytes(this.storageUsed)} / ${this.formatBytes(this.storageQuota)}</span>
                </div>
                <div class="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                    <div class="h-full ${color} transition-all duration-500" style="width: ${Math.max(2, pct)}%"></div>
                </div>
                <div class="text-[10px] text-slate-500">Managed by browser. The OS may clear this if storage is low.
                </div>
            </section>
        `;
    }

    private renderDataManagement() {
        return html`
            <section class="space-y-3">
                <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">Data Management</h2>
                ${this.renderBackupStatus()}
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

                    ${this.showRepairTool ? html`
                        <button class="flex items-center justify-between p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 hover:bg-indigo-900/40 transition-colors"
                                ?disabled=${this.busy} @click=${() => this.runRepair()}>
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-lg bg-indigo-900/50 text-indigo-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
                                    </svg>
                                </div>
                                <div class="text-left">
                                    <div class="text-indigo-200 font-medium">Repair Thumbnails</div>
                                    <div class="text-xs text-indigo-400">Regenerate missing preview images</div>
                                </div>
                            </div>
                            ${this.repairProgress ? html`<span
                                    class="text-xs font-mono text-indigo-300">${this.repairProgress}</span>` : null}
                        </button>
                    ` : null}

                </div>
            </section>
        `;
    }

    private renderProcessingSection() {
        return html`
            <section class="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-4">
                <div class="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                    </svg>
                    Processing
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm text-slate-200">Text Recognition (OCR)</div>
                        <div class="text-[10px] text-slate-500">Extract text for search.</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors ${this.enableOcr ? 'bg-emerald-600' : 'bg-slate-700'}"
                            @click=${() => this.toggleOcr()}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.enableOcr ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>
            </section>
        `;
    }

    private renderSystemInfo() {
        return html`
            <div class="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-2">
                <div class="text-xs font-mono text-slate-500">System Capabilities</div>
                <div class="text-xs text-slate-600">Capacitor: ${this.caps.isCapacitor} • OPFS: ${this.caps.hasOPFS} •
                    Share: ${this.caps.hasWebShare}
                </div>
            </div>
        `;
    }

    private renderDangerZone() {
        return html`
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
                            <p class="opacity-80">Permanently delete all documents and reset app.</p>
                        </div>
                        <div class="space-y-2">
                            <label class="text-xs text-red-400">Type "DELETE" to confirm</label>
                            <input type="text"
                                   class="w-full bg-slate-950 border border-red-900/50 rounded-lg px-3 py-2 text-red-100 focus:outline-none"
                                   placeholder="DELETE"
                                   .value=${this.deleteConfirmation}
                                   @input=${(e: Event) => this.deleteConfirmation = (e.target as HTMLInputElement).value}
                            />
                        </div>
                        <button class="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50"
                                ?disabled=${this.deleteConfirmation !== 'DELETE' || this.busy}
                                @click=${() => this.nukeEverything()}>
                            ${this.busy ? 'Erasing...' : 'Erase Everything'}
                        </button>
                    </div>
                `}
            </section>
        `;
    }

    private renderBackupStatus() {
        if (!this.lastBackupDate) {
            return html`
                <div class="p-3 rounded-lg bg-amber-950/20 border border-amber-900/50 flex items-center gap-3">
                    <div class="text-amber-500 font-bold text-lg">!</div>
                    <div class="text-xs text-amber-200">Never backed up. Export a backup to prevent data loss.</div>
                </div>
            `;
        }
        const daysSince = Math.floor((Date.now() - this.lastBackupDate) / (1000 * 60 * 60 * 24));
        const isOverdue = daysSince > 30;
        return html`
            <div class="text-[10px] ${isOverdue ? 'text-amber-500 font-bold' : 'text-slate-500'}">
                Last backup: ${new Date(this.lastBackupDate).toLocaleDateString()} (${daysSince} days ago)
                ${isOverdue ? '— Backup Recommended' : ''}
            </div>
        `;
    }
}

function sanitizePath(unsafePath: string): string {
    // 1. Remove directory traversal attempts
    const clean = unsafePath.replace(/(\.\.(\/|\\))+/g, '');

    // 2. Remove leading slashes
    const relative = clean.replace(/^[\/\\]+/, '');

    // 3. Whitelist allowed folders
    if (!relative.startsWith('docs/') && !relative.startsWith('pages/')) {
        throw new Error(`Security Warning: Skipping unauthorized file path: ${unsafePath}`);
    }
    return relative;
}