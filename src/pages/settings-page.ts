import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {haptics} from '../services/haptics';

import {db} from '../services/db';
import {FilePicker} from '@capawesome/capacitor-file-picker';
import {getPlatformCaps} from '../services/platform';
import {tryPersistStorage} from '../services/persist';
import {getFileStore} from '../services/filestore';
import {shareStream} from '../services/share';
import {jsonFile, type ZipFileEntry, zipFilesToStream} from '../lib/zip';
import {decryptStream, encryptStream} from '../lib/crypto/pbe';
import {OCR_LANG_OPTIONS} from '../lib/ocr';
import {resetAllStorage} from '../services/reset-storage';
import {ConfirmModal} from '../components/confirm-modal';
import pkg from '../../package.json'
import {settings} from '../services/settings';
import {AuthService} from '../services/auth-service';
import {i18n, t, type LocaleCode} from '../lib/i18n';
import {toUserErrorMessage} from '../lib/user-error';
import {mapRestoreError} from '../lib/restore-error';
import {deleteOrphanStorageFiles, findOrphanStorageFiles} from '../services/storage-audit';

import {CapacitorFileStore} from "../services/filestore/capacitor-store";
import {hasIndexLossRiskFlag, runStorageHealthProbe} from '../services/storage-health';
import {rebuildLibraryIndexFromFiles} from '../services/rebuild-index';
import {type BackupMetadata, restoreFromZipStream} from '../services/restore-stream';
import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {pickedFileToBlob} from '../services/picked-file';
import {syncPrivacyScreen} from '../services/privacy-screen';
import type {DocRecord, PageRecord} from '../domain/types';

import type {RestoreMode} from '../services/restore-stream';

const magicLength = 4;

@customElement('settings-page')
export class SettingsPage extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private caps = getPlatformCaps();
    @state() private busy = false;
    @state() private msg: string | null = null;
    @state() private err: string | null = null;


    @state() private storageUsed = 0;
    @state() private storageQuota = 0;
    @state() private lastBackupDate: number | null = null;

    // Initialize with defaults, update in connectedCallback
    @state() private requireAuth = false;


    // Progress State
    @state() private backupProgress = 0;
    @state() private backupTotal = 0;
    @state() private backupPhase: 'collecting' | 'encrypting' = 'collecting';


    @state() private enableOcr = true;
    @state() private ocrLang = 'ara+eng';
    @state() private clearClipboardAfter60s = false;
    @state() private hasIndexRisk = false;
    @state() private storageAuditBusy = false;
    @state() private storageAuditFound = 0;
    @state() private storageAuditDeleted = 0;
    @state() private persistence: PersistenceStatus | null = null;
    @state() private persistenceBusy = false;
    @state() private persistenceDenied = false;
    private readonly onLocaleChanged = () => this.requestUpdate();

    async connectedCallback() {
        super.connectedCallback();
        window.addEventListener('sahifah-locale-changed', this.onLocaleChanged as EventListener);
        await this._refreshSettings();
        this.lastBackupDate = Number(localStorage.getItem('sahifah.lastBackup')) || null;
        void this.loadStorageStats();
        void tryPersistStorage();
        await this.refreshStorageRisk();
        if (!this.caps.isCapacitor) {
            await this.refreshPersistence(false);
        }
    }

    disconnectedCallback() {
        window.removeEventListener('sahifah-locale-changed', this.onLocaleChanged as EventListener);
        super.disconnectedCallback();
    }

    private async rebuildIndex() {
        const ok = await ConfirmModal.ask({
            title: t('settings.rebuild_index_title'),
            description: t('settings.rebuild_index_desc'),
            confirm: t('settings.rebuild_index_confirm'),
            destructive: true
        });
        if (!ok) return;

        this.busy = true;
        this.msg = t('settings.rebuild_index_running');
        this.err = null;

        try {
            const result = await rebuildLibraryIndexFromFiles();
            await this.refreshStorageRisk();
            this.msg = t('settings.rebuild_index_done', {docs: result.docsRecovered, pages: result.pagesRecovered});

        } catch (e) {
            this.err = t('settings.rebuild_index_failed', {error: String(e)});
        } finally {
            this.busy = false;
        }
    }

    private async _refreshSettings() {
        const s = await settings.get();
        this.requireAuth = s.requireAuth;
        this.enableOcr = s.enableOcr;
        this.ocrLang = s.ocrLang || 'ara+eng';
        this.clearClipboardAfter60s = s.clearClipboardAfter60s;
    }

    private async refreshStorageRisk() {
        this.hasIndexRisk = hasIndexLossRiskFlag();
        try {
            const report = await runStorageHealthProbe();
            this.hasIndexRisk = report.possibleIndexLoss;
        } catch {
        }
    }

    private async loadStorageStats() {
        // 1. Native App Strategy (Real File Usage)
        if (this.caps.isCapacitor) {
            try {
                const store = getFileStore();
                // Check if the store has our new method (it will if it's CapacitorFileStore)
                if (store instanceof CapacitorFileStore) {
                    this.storageUsed = await store.getUsageEstimate();
                    // On Native, quota is the total device free space, but harder to get accurately.
                    // We can leave quota as 0 (hide the bar) or set a fake high number.
                    this.storageQuota = 0;
                }
            } catch (e) {
                console.warn('Native storage check failed', e);
            }
            return;
        }

        // 2. Web/PWA Strategy (Browser Quota)
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

    private async refreshPersistence(requestIfNeeded: boolean) {
        if (this.caps.isCapacitor) return;
        try {
            this.persistence = await getPersistenceStatus({requestIfNeeded});
        } catch {
            this.persistence = {supported: false, persisted: false, grantedThisCall: false};
        }
    }

    private async requestPersistentStorage() {
        if (this.caps.isCapacitor || this.persistenceBusy) return;
        this.persistenceBusy = true;
        this.err = null;
        try {
            const status = await getPersistenceStatus({requestIfNeeded: true});
            this.persistence = status;
            if (status.persisted && status.grantedThisCall) {
                this.msg = t('settings.persistence_granted');
                this.persistenceDenied = false;
            } else if (status.persisted) {
                this.msg = t('settings.persistence_already');
                this.persistenceDenied = false;
            } else {
                this.persistenceDenied = true;
            }
        } catch (e) {
            this.err = t('settings.persistence_failed', {error: toUserErrorMessage(e)});
        } finally {
            this.persistenceBusy = false;
        }
    }

    private setOcrLang(lang: string) {
        if (!lang) return;
        this.ocrLang = lang;
        settings.setOcrLang(lang);
    }

    private setLocale(locale: LocaleCode) {
        if (!i18n.setLocale(locale)) return;
        this.requestUpdate();
    }

    private toggleClipboardAutoClear() {
        this.clearClipboardAfter60s = !this.clearClipboardAfter60s;
        settings.setClipboardAutoClear(this.clearClipboardAfter60s);
    }

    private async toggleAuth() {
        void haptics.selection();

        const nextState = !this.requireAuth;

        if (nextState === true) {
            const success = await AuthService.setupAuth();
            if (!success) {
                this.msg = t('settings.auth_setup_unavailable');
                return;
            }
        }

        this.requireAuth = nextState;
        await settings.setAuth(nextState);
        await syncPrivacyScreen(nextState);
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

        // FIX 1: Math was wrong. docs.length must be part of the progress!
        this.backupTotal = docs.length + (pages.length * 2);
        this.backupProgress = 0;

        yield jsonFile('metadata.json', {docs, pages, exportedAt: Date.now()});

        for (const p of pages) {
            try {
                const img = await store.get(p.imagePath);
                yield {name: p.imagePath, data: img};
                this.backupProgress++; // Increment 1
                this.requestUpdate();

                const thumb = await store.get(p.thumbPath);
                yield {name: p.thumbPath, data: thumb};
                this.backupProgress++; // Increment 2
                this.requestUpdate();
            } catch (e) {
                console.warn(`Skipping missing file: ${p.id}`, e);
            }
        }

        for (const d of docs) {
            // FIX 2: Increment progress for every doc so we reach 100%
            this.backupProgress++;
            this.requestUpdate();

            if (d.pdfPath && (await store.exists(d.pdfPath))) {
                try {
                    const pdf = await store.get(d.pdfPath);
                    yield {name: d.pdfPath, data: pdf};
                } catch (e) {
                    console.warn(`Backup: Failed to read PDF for doc ${d.id}`, e);
                }
            }

            // Let the UI breathe
            if (this.backupProgress % 5 === 0) {
                await new Promise(r => setTimeout(r, 10));
            }
        }
    }

    private async exportBackup(): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        try {
            const pw = await ConfirmModal.prompt({
                title: t('settings.encrypt_backup_title'),
                description: t('settings.encrypt_backup_desc'),
                placeholder: t('settings.backup_password_placeholder'),
                confirm: t('settings.export_confirm')
            });
            if (pw === null) {
                this.busy = false;
                return;
            }
            const password = pw.trim();
            if (!password) {
                this.err = t('settings.backup_password_required');
                this.busy = false;
                return;
            }

            this.msg = t('settings.packaging_backup');
            this.requestUpdate();

            const zipStream = zipFilesToStream(this.fileGenerator(), () => {
            });
            const docCount = await db.docs.count();
            const encrypted = encryptStream(zipStream, password, {
                docCount,
                meta: {
                    app: 'sahifah-lens',
                    version: pkg.version,
                }
            });

            const nowDate = new Date();
            const y = nowDate.getFullYear();
            const m = String(nowDate.getMonth() + 1).padStart(2, '0');
            const d = String(nowDate.getDate()).padStart(2, '0');
            const hh = String(nowDate.getHours()).padStart(2, '0');
            const mm = String(nowDate.getMinutes()).padStart(2, '0');
            const ss = String(nowDate.getSeconds()).padStart(2, '0');
            const finalName = `lens-backup-${y}${m}${d}-${hh}${mm}${ss}.slbk`;

            // The encrypted chunks go straight to the share sheet (no copy of the backup in
            // memory or in the app's files). Progress: collecting, then "encrypting" while the
            // last chunks are written and the share sheet opens.
            let chunkCount = 0;
            const progress = async function* (this: SettingsPage) {
                for await (const chunk of encrypted) {
                    chunkCount++;
                    if (chunkCount % 5 === 0) await new Promise(r => setTimeout(r, 10));
                    yield chunk;
                }
                this.backupPhase = 'encrypting';
                this.requestUpdate();
            }.call(this);

            AuthService.ignoreNextResumeForExternalAction('export-backup-share', AuthService.SHARE_BYPASS_TTL_MS);
            await shareStream(progress, finalName);

            const now = Date.now();
            localStorage.setItem('sahifah.lastBackup', String(now));
            this.lastBackupDate = now;
            this.msg = t('settings.backup_exported');

        } catch (e) {
            this.err = toUserErrorMessage(e);
            console.error(e);
        } finally {
            this.busy = false;
            this.backupProgress = 0;
            this.backupTotal = 0;
            this.backupPhase = 'collecting';
        }
    }

    /**
     * Unpack a backup stream (plain zip, or the decrypted .slbk) into the library.
     * metadata.json comes first; the user picks add or replace before any file is written.
     * The library's database is not touched until the whole backup has arrived intact: a
     * corrupt or truncated file (found only at its end) must never leave the user with
     * less than before. Page files are written as they stream; if the restore fails, the
     * ones written are orphans and the storage check removes them.
     */
    private async restoreFromStream(chunks: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): Promise<void> {
        const store = getFileStore();
        let meta: BackupMetadata | null = null;
        this.backupTotal = 0;
        this.backupProgress = 0;

        const result = await restoreFromZipStream(chunks, {
            onMetadata: async (m) => {
                meta = m;
                const mode = await this.askRestoreMode(m.docs.length);
                if (!mode) return null;
                this.backupTotal = m.pages.length * 2 + m.docs.length;
                this.msg = t('settings.unpacking_library');
                this.requestUpdate();
                return mode;
            },
            onFile: async (path, bytes) => {
                try {
                    await store.put(sanitizePath(path), bytes, 'image/jpeg');
                    this.backupProgress++;
                    this.requestUpdate();
                } catch (e) {
                    console.warn((e as Error).message);
                }
            },
        });
        if (!result.mode || !meta) return; // cancelled: nothing was changed

        const data = meta as BackupMetadata;
        await db.transaction('rw', db.docs, db.pages, async () => {
            if (result.mode === 'replace') {
                await db.docs.clear();
                await db.pages.clear();
            }
            for (const doc of data.docs as DocRecord[]) await db.docs.put(doc);
            for (const page of data.pages as PageRecord[]) await db.pages.put(page);
        });
        if (result.mode === 'replace') {
            // The old library's page files are no longer referenced: remove them now.
            try {
                await deleteOrphanStorageFiles(await findOrphanStorageFiles());
            } catch (e) {
                console.warn('Cleanup after replace failed (the storage check will retry):', e);
            }
        }

        this.msg = t('settings.restore_complete_processed', {count: result.files});
    }

    private async runStorageAudit() {
        this.storageAuditBusy = true;
        this.err = null;
        this.msg = null;
        try {
            const orphans = await findOrphanStorageFiles();
            this.storageAuditFound = orphans.length;
            this.storageAuditDeleted = 0;
            if (orphans.length === 0) {
                this.msg = t('settings.storage_audit_no_orphans');
                return;
            }

            const ok = await ConfirmModal.ask({
                title: t('settings.storage_audit_title'),
                description: t('settings.storage_audit_found_body', {count: orphans.length}),
                confirm: t('settings.storage_audit_delete'),
                destructive: true
            });
            if (!ok) return;

            const deleted = await deleteOrphanStorageFiles(orphans);
            this.storageAuditDeleted = deleted;
            this.msg = t('settings.storage_audit_deleted', {count: deleted});
            await this.loadStorageStats();
        } catch (e) {
            this.err = t('settings.storage_audit_failed', {error: toUserErrorMessage(e)});
        } finally {
            this.storageAuditBusy = false;
        }
    }

    private async pickRestoreFile() {
        if (this.caps.isCapacitor) {
            try {
                AuthService.ignoreNextResumeForExternalAction('restore-file-picker-native', 120_000);
                const result = await FilePicker.pickFiles({
                    limit: 1,
                    types: ['application/zip', 'application/octet-stream', '.slbk', '.zip'],
                    readData: true
                });

                if (result.files.length > 0) {
                    const f = result.files[0];
                    const blob = await pickedFileToBlob(f);
                    if (!blob) {
                        this.err = t('settings.restore_select_valid_file');
                        return;
                    }
                    await this.importBackup(blob);
                }
            } catch (e: any) {
                if (e?.message?.toLowerCase().includes('cancel') || e?.code === 'USER_CANCELLED') {
                    console.log('User cancelled restore picker');
                } else {
                    this.err = t('settings.restore_picker_error', {error: toUserErrorMessage(e)});
                }
            }
            return;
        }

        const input = this.renderRoot.querySelector('#restore-input') as HTMLInputElement | null;
        if (!input) {
            this.err = t('settings.restore_picker_error', {error: t('scan.import_unavailable')});
            return;
        }
        input.value = '';
        AuthService.ignoreNextResumeForExternalAction('restore-file-picker-web', 120_000);
        input.click();
    }

    private async importBackup(file: Blob): Promise<void> {
        this.busy = true;
        this.msg = null;
        this.err = null;

        try {
            const pw = await ConfirmModal.prompt({
                title: t('settings.decrypt_backup_title'),
                description: t('settings.decrypt_backup_desc'),
                placeholder: t('settings.restore_password_placeholder'),
                confirm: t('settings.restore_confirm')
            });

            if (pw === null) {
                this.busy = false;
                return;
            }
            const password = pw.trim();

            this.msg = t('settings.decrypting_stream');
            this.requestUpdate();

            if (!password) {
                const head = new Uint8Array(await file.slice(0, magicLength).arrayBuffer());
                if (new TextDecoder().decode(head) === 'SLBK') {
                    throw new Error(t('settings.restore_password_required'));
                }
            }
            // Encrypted: decrypt chunk by chunk. Plain zip: read as it is. Either way the
            // backup is unpacked as it streams, never held whole (see restore-stream.ts).
            await this.restoreFromStream(password ? decryptStream(file.stream(), password) : file.stream());

            this.msg = t('settings.restore_complete');

        } catch (e) {
            console.error(e);
            const mapped = mapRestoreError(e);
            this.err = mapped.direct
                ? mapped.message
                : t('settings.restore_failed', {error: mapped.message});
        } finally {
            this.busy = false;
            this.backupProgress = 0;
            this.backupTotal = 0;
        }
    }

    private async askRestoreMode(count: number): Promise<RestoreMode | null> {
        const res = await ConfirmModal.choose({
            title: t('settings.restore_mode_title'),
            description: t('settings.restore_mode_desc', {count}),
            choices: [
                {value: 'merge', label: t('settings.restore_mode_merge')},
                {value: 'replace', label: t('settings.restore_mode_replace'), destructive: true},
            ],
        });
        return res === 'merge' || res === 'replace' ? res : null;
    }

    private async nukeEverything() {
        const ok = await ConfirmModal.ask({
            title: t('settings.nuke_final_title'),
            description: t('settings.nuke_final_desc'),
            confirm: t('settings.nuke_final_confirm'),
            destructive: true
        });

        if (!ok) return;

        this.busy = true;
        this.msg = t('settings.nuke_running');
        await this.updateComplete;
        try {
            await resetAllStorage();
            location.reload();
        } catch (e) {
            this.msg = t('settings.nuke_failed', {error: String(e)});
            this.busy = false;
        }
    }

    private renderProgressOverlay() {
        if (!this.busy || this.backupTotal === 0) return null;
        const encrypting = this.backupPhase === 'encrypting';
        const pct = encrypting ? 100 : Math.round((this.backupProgress / this.backupTotal) * 100);

        return html`
            <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div class="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl">
                    <div class="flex items-center justify-between">
                        <div class="font-bold text-slate-100">${t('settings.backup_creating')}</div>
                        ${encrypting
                            ? html`<div class="text-sm text-emerald-400 animate-pulse">${t('settings.backup_encrypting')}</div>`
                            : html`<div class="text-sm text-emerald-400 font-mono">${pct}%</div>`}
                    </div>
                    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                        ${encrypting
                            ? html`<div class="h-full bg-emerald-500 animate-pulse w-full"></div>`
                            : html`<div class="h-full bg-emerald-500 transition-all duration-200" style="width: ${pct}%"></div>`}
                    </div>
                    <div class="text-xs text-slate-400 text-center">
                        ${encrypting
                            ? t('settings.backup_encrypting_desc')
                            : t('settings.backup_processing_item', {current: this.backupProgress, total: this.backupTotal})}
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="space-y-5 pb-24">
                ${this.renderProgressOverlay()}
                <h1 class="text-2xl font-bold text-slate-100 pt-2">${t('settings.title')}</h1>
                ${this.renderAlerts()}
                ${this.renderSwitches()}
                ${this.renderBackup()}
                ${this.renderStorage()}
                ${this.renderErase()}
                <p class="text-xs text-slate-400 px-1">${t('settings.privacy_body')} · v${pkg.version}</p>
            </div>
        `;
    }

    private renderAlerts() {
        return html`
            ${(this.msg || this.err) ? html`
                <div class="fixed left-1/2 -translate-x-1/2 z-40 w-[min(92vw,44rem)] pointer-events-none"
                     style="top: calc(env(safe-area-inset-top, 0px) + 0.75rem);">
                    ${this.msg ? html`
                        <div class="pointer-events-auto p-4 rounded-lg bg-slate-800 text-emerald-300 border border-emerald-900/50 flex items-start justify-between gap-3 shadow-lg">
                            <div class="font-medium">${this.msg}</div>
                            <button class="text-slate-400 hover:text-slate-200 text-sm" aria-label=${t('common.cancel')} @click=${() => this.msg = null}>✕</button>
                        </div>
                    ` : null}
                    ${this.err ? html`
                        <div class="pointer-events-auto mt-2 p-4 rounded-lg bg-red-950/50 text-red-100 border border-red-900 flex items-start justify-between gap-3 shadow-lg">
                            <div class="flex-1 font-medium">${this.err}</div>
                            <button class="text-red-300 hover:text-red-100 text-sm shrink-0" aria-label=${t('common.cancel')} @click=${() => { this.err = null; }}>✕</button>
                        </div>
                    ` : null}
                </div>
            ` : null}
        `;
    }

    /** One switch per line; what it does in small text under it. */
    private renderToggle(label: string, desc: string, on: boolean, onClick: () => void) {
        return html`
            <div class="flex items-center justify-between gap-3 py-3 border-b border-slate-800 last:border-0">
                <div class="min-w-0">
                    <div class="text-sm text-slate-100">${label}</div>
                    <div class="text-xs text-slate-400">${desc}</div>
                </div>
                <button class="relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-700' : 'bg-slate-700'}"
                        role="switch" aria-checked=${on} aria-label=${label} @click=${onClick}>
                    <span class="absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform ${on ? 'translate-x-5' : ''}"></span>
                </button>
            </div>
        `;
    }

    private renderSwitches() {
        const select = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 min-h-[44px]';
        return html`
            <section class="rounded-2xl border border-slate-800 bg-slate-900/40 px-4">
                ${this.renderToggle(t('settings.app_lock'), t('settings.app_lock_desc'), this.requireAuth, () => this.toggleAuth())}
                ${this.renderToggle(t('settings.ocr_label'), t('settings.ocr_desc'), this.enableOcr, () => this.toggleOcr())}
                ${this.enableOcr ? html`
                    <label class="block py-3 border-b border-slate-800 space-y-1">
                        <span class="text-xs text-slate-400 uppercase tracking-wider">${t('settings.ocr_language')}</span>
                        <select class=${select} .value=${this.ocrLang} @change=${(e: Event) => this.setOcrLang((e.target as HTMLSelectElement).value)}>
                            ${OCR_LANG_OPTIONS.map(opt => html`<option value=${opt.code}>${t(opt.labelKey)}</option>`)}
                        </select>
                    </label>
                ` : null}
                <label class="block py-3 border-b border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 uppercase tracking-wider">${t('settings.language')}</span>
                    <select class=${select} @change=${(e: Event) => this.setLocale((e.target as HTMLSelectElement).value as LocaleCode)}>
                        ${i18n.getAvailableLocales().map(opt => html`
                            <option value=${opt.code} ?selected=${opt.code === i18n.getLocale()}>${opt.code === 'ar' ? t('settings.language_ar') : t('settings.language_en')}</option>`)}
                    </select>
                </label>
                ${this.renderToggle(t('settings.clipboard_auto_clear'), t('settings.clipboard_auto_clear_desc'), this.clearClipboardAfter60s, () => this.toggleClipboardAutoClear())}
            </section>
        `;
    }

    private renderBackup() {
        const row = 'w-full flex items-center gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors text-start min-h-[56px] disabled:opacity-50';
        const daysSince = this.lastBackupDate ? Math.floor((Date.now() - this.lastBackupDate) / 86_400_000) : null;
        const overdue = daysSince !== null && daysSince > 30;
        return html`
            <section class="space-y-2">
                <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">${t('settings.data_management')}</h2>
                <button class=${row} ?disabled=${this.busy} @click=${() => this.exportBackup()}>
                    <div class="p-2 rounded-lg bg-emerald-900/30 text-emerald-400">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    </div>
                    <div>
                        <div class="text-slate-100 font-medium">${t('settings.export_backup')}</div>
                        <div class="text-xs text-slate-400">${t('settings.export_backup_desc')}</div>
                    </div>
                </button>
                <button class=${row} ?disabled=${this.busy} @click=${() => this.pickRestoreFile()}>
                    <div class="p-2 rounded-lg bg-blue-900/30 text-blue-300">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m-4 4v12"></path></svg>
                    </div>
                    <div>
                        <div class="text-slate-100 font-medium">${t('settings.restore_backup')}</div>
                        <div class="text-xs text-slate-400">${t('settings.restore_backup_desc')}</div>
                    </div>
                    ${!this.caps.isCapacitor ? html`
                        <input id="restore-input" class="hidden" type="file" accept=".slbk,.zip,application/zip" ?disabled=${this.busy}
                               @click=${(e: Event) => e.stopPropagation()}
                               @change=${(e: Event) => {
                                   const input = e.target as HTMLInputElement;
                                   const f = input.files?.[0];
                                   if (f) void this.importBackup(f);
                                   input.value = '';
                               }}/>
                    ` : null}
                </button>
                <p class="text-xs px-1 ${!this.lastBackupDate || overdue ? 'text-amber-300' : 'text-slate-400'}">
                    ${this.lastBackupDate
                            ? t('settings.last_backup_line', {date: new Date(this.lastBackupDate).toLocaleDateString(i18n.getLocale()), days: daysSince!}) + (overdue ? t('settings.backup_recommended_suffix') : '')
                            : t('settings.never_backed_up')}
                </p>
            </section>
        `;
    }

    private renderStorage() {
        const pct = this.storageQuota > 0 ? (this.storageUsed / this.storageQuota) * 100 : 0;
        const persistence = this.persistence;
        return html`
            <section class="space-y-2">
                <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold px-1">
                    <span>${t('settings.local_storage')}</span>
                    <span>${this.formatBytes(this.storageUsed)}${this.storageQuota > 0 ? ' / ' + this.formatBytes(this.storageQuota) : ''}</span>
                </div>
                ${this.storageQuota > 0 ? html`
                    <div class="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div class="h-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-600'}" style="width: ${Math.max(2, pct)}%"></div>
                    </div>` : null}
                <div class="text-xs text-slate-400 px-1">${this.caps.isCapacitor ? t('settings.storage_native_info') : t('settings.storage_web_info')}</div>
                ${!this.caps.isCapacitor && persistence?.supported && !persistence.persisted ? html`
                    ${this.persistenceDenied
                            ? html`<p class="text-xs text-amber-300 px-1">${t('settings.persistence_denied_hint')}</p>`
                            : html`<button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-100 min-h-[44px]" ?disabled=${this.persistenceBusy}
                                           @click=${() => this.requestPersistentStorage()}>${this.persistenceBusy ? t('settings.persistence_requesting') : t('settings.persistence_request')}</button>`}
                ` : null}
                ${this.hasIndexRisk ? html`
                    <button class="w-full flex items-center gap-3 p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 hover:bg-amber-900/40 text-start min-h-[56px]"
                            ?disabled=${this.busy} @click=${() => this.rebuildIndex()}>
                        <div>
                            <div class="text-amber-200 font-medium">${t('settings.repair_library')}</div>
                            <div class="text-xs text-amber-300/90">${t('settings.repair_library_desc')}</div>
                        </div>
                    </button>
                ` : null}
                <button class="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 hover:bg-slate-900 text-start min-h-[48px]"
                        data-testid="run-storage-audit-btn" ?disabled=${this.busy || this.storageAuditBusy} @click=${() => this.runStorageAudit()}>
                    <div>
                        <div class="text-sm text-slate-100">${t('settings.storage_audit_title')}</div>
                        <div class="text-xs text-slate-400">${t('settings.storage_audit_desc')}</div>
                    </div>
                    <div class="text-xs text-slate-400 shrink-0" data-testid="storage-audit-summary">
                        ${this.storageAuditBusy ? t('settings.storage_audit_running')
                                : this.storageAuditDeleted > 0 ? t('settings.storage_audit_deleted_short', {count: this.storageAuditDeleted})
                                        : this.storageAuditFound > 0 ? t('settings.storage_audit_found_short', {count: this.storageAuditFound})
                                                : t('settings.storage_audit_idle')}
                    </div>
                </button>
            </section>
        `;
    }

    private renderErase() {
        return html`
            <section id="DangerZone" class="pt-2">
                <button class="w-full py-3 rounded-xl border border-red-900/50 text-red-300 hover:bg-red-950/30 font-semibold min-h-[48px] disabled:opacity-50"
                        ?disabled=${this.busy} @click=${() => this.nukeEverything()}>
                    ${this.busy ? t('settings.erasing') : t('settings.erase_everything')}
                </button>
                <p class="text-xs text-slate-400 px-1 pt-2">${t('settings.erase_all_body')}</p>
            </section>
        `;
    }
}

function sanitizePath(unsafePath: string): string {
    // 1. Remove directory traversal attempts
    const clean = unsafePath.replace(/(\.\.(\/|\\))+/g, '');
    // 2. Remove leading slashes
    const relative = clean.replace(/^[\/\\]+/, '');
    // 3. Only the app's own folders
    if (!relative.startsWith('docs/') && !relative.startsWith('pages/')) {
        throw new Error(`Security Warning: Skipping unauthorized file path: ${unsafePath}`);
    }
    return relative;
}
