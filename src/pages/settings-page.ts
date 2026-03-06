import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {haptics} from '../services/haptics';

import JSZip from 'jszip';
import {db} from '../services/db';
import {FilePicker} from '@capawesome/capacitor-file-picker';
import {getPlatformCaps} from '../services/platform';
import {tryPersistStorage} from '../services/persist';
import {getFileStore} from '../services/filestore';
import {shareFile} from '../services/share';
import {jsonFile, type ZipFileEntry, zipFilesToStream} from '../lib/zip';
import {decryptStream, encryptStream} from '../lib/crypto/pbe';
import {OCR_LANG_OPTIONS} from '../lib/ocr';
import {resetAllStorage} from '../services/reset-storage';
import {ConfirmModal} from '../components/confirm-modal';
import pkg from '../../package.json'
import {settings, type ScanMode} from '../services/settings';
import {AuthService} from '../services/auth-service';
import {i18n, t, type LocaleCode} from '../lib/i18n';
import {toUserErrorMessage} from '../lib/user-error';
import {mapRestoreError} from '../lib/restore-error';
import {deleteOrphanStorageFiles, findOrphanStorageFiles} from '../services/storage-audit';

import {repairLibrary} from '../services/repair';
import {CapacitorFileStore} from "../services/filestore/capacitor-store";
import {hasIndexLossRiskFlag, runStorageHealthProbe} from '../services/storage-health';
import {rebuildLibraryIndexFromFiles} from '../services/rebuild-index';
import {createTempBackupWriter} from '../services/backup-temp-store';
import {
    getMirrorFolderLabel,
    hasMirrorBackupFolder,
    isMirrorBackupSupported,
    maybeMirrorBackupAfterExport,
    pickMirrorBackupFolder
} from '../services/mirror-backup';
import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {pickedFileToBlob} from '../services/picked-file';

type RestoreMode = 'merge' | 'replace';

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
    @state() private ocrLang = 'ara+eng';
    @state() private scanMode: ScanMode = 'manual';
    @state() private clearClipboardAfter60s = false;
    @state() private hasIndexRisk = false;
    @state() private storageAuditBusy = false;
    @state() private storageAuditFound = 0;
    @state() private storageAuditDeleted = 0;
    @state() private mirrorBackupEnabled = false;
    @state() private mirrorBackupMode: 'manual' | 'after_export' = 'manual';
    @state() private mirrorBackupReady = false;
    @state() private mirrorFolderLabel: string | null = null;
    @state() private showMirrorAdvanced = false;
    @state() private showPrivacyDetails = false;
    @state() private showAdvancedDataTools = false;
    @state() private persistence: PersistenceStatus | null = null;
    @state() private persistenceBusy = false;
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
        if (location.hash.includes('repair=1')) {
            this.showRepairTool = true;
        }

        // 3. SECRET COMMAND: Expose a global function for manual trigger
        // Usage: Type 'sahifahRepair()' in DevTools Console
        (window as any).sahifahRepair = () => {
            this.showRepairTool = true;
            this.msg = t('settings.maintenance_enabled');
            this.requestUpdate();
        };
    }

    disconnectedCallback() {
        window.removeEventListener('sahifah-locale-changed', this.onLocaleChanged as EventListener);
        super.disconnectedCallback();
    }

    private async runRepair() {
        this.busy = true;
        try {
            await this.runThumbnailRepairFlow();
            this.msg = t('settings.repair_complete');
        } catch (e) {
            this.err = t('settings.repair_failed', {error: String(e)});
        } finally {
            this.busy = false;
        }
    }

    private async runThumbnailRepairFlow() {
        this.repairProgress = t('settings.repair_starting');
        await repairLibrary((_curr, _total, msg) => {
            this.repairProgress = msg;
            this.requestUpdate();
        });
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

            const runRepairNow = await ConfirmModal.ask({
                title: t('settings.repair_prompt_title'),
                description: t('settings.repair_prompt_desc'),
                confirm: t('settings.repair_prompt_confirm'),
            });
            if (runRepairNow) {
                this.msg = t('settings.repair_running');
                await this.runThumbnailRepairFlow();
                this.msg = t('settings.repair_recovery_done');
            }
        } catch (e) {
            this.err = t('settings.rebuild_index_failed', {error: String(e)});
        } finally {
            this.busy = false;
        }
    }

    private async _refreshSettings() {
        const s = await settings.get();
        this.requireAuth = s.requireAuth;
        this.defaultVault = s.defaultVault;
        this.enableOcr = s.enableOcr;
        this.ocrLang = s.ocrLang || 'ara+eng';
        this.scanMode = s.scanMode || 'manual';
        this.clearClipboardAfter60s = s.clearClipboardAfter60s;
        this.mirrorBackupEnabled = s.mirrorBackupEnabled;
        this.mirrorBackupMode = s.mirrorBackupMode || 'manual';
        this.mirrorBackupReady = await hasMirrorBackupFolder();
        this.mirrorFolderLabel = getMirrorFolderLabel();
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
            } else if (status.persisted) {
                this.msg = t('settings.persistence_already');
            } else {
                this.msg = t('settings.persistence_denied');
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

    private setScanMode(mode: ScanMode) {
        if (mode !== 'quick' && mode !== 'manual') return;
        this.scanMode = mode;
        settings.setScanMode(mode);
    }

    private setLocale(locale: LocaleCode) {
        if (!i18n.setLocale(locale)) return;
        this.requestUpdate();
    }

    private toggleClipboardAutoClear() {
        this.clearClipboardAfter60s = !this.clearClipboardAfter60s;
        settings.setClipboardAutoClear(this.clearClipboardAfter60s);
    }

    private async toggleMirrorBackupEnabled() {
        const next = !this.mirrorBackupEnabled;
        if (next && !isMirrorBackupSupported()) {
            this.mirrorBackupEnabled = false;
            settings.setMirrorBackupEnabled(false);
            this.msg = t('settings.mirror_unsupported');
            return;
        }
        this.mirrorBackupEnabled = next;
        settings.setMirrorBackupEnabled(next);
        if (next && !this.mirrorBackupReady) {
            if (this.mirrorBackupMode !== 'after_export') {
                this.mirrorBackupMode = 'after_export';
                settings.setMirrorBackupMode('after_export');
            }
            this.msg = t('settings.mirror_pick_required');
        }
    }

    private async pickMirrorBackupFolder() {
        try {
            const res = await pickMirrorBackupFolder();
            this.mirrorBackupReady = res.ok;
            if (!res.ok) {
                if (res.reason === 'permission_denied') {
                    this.err = t('settings.mirror_permission_denied');
                } else if (res.reason === 'cancelled') {
                    this.msg = t('settings.mirror_pick_cancelled');
                } else if (res.reason === 'unsupported') {
                    this.err = t('settings.mirror_unsupported');
                } else {
                    this.err = t('settings.mirror_pick_failed');
                }
                return false;
            }
            this.mirrorFolderLabel = getMirrorFolderLabel();
            this.msg = t('settings.mirror_pick_success');
            return true;
        } catch (e) {
            this.err = t('settings.mirror_pick_error', {error: toUserErrorMessage(e)});
            return false;
        }
    }

    private setMirrorBackupMode(mode: 'manual' | 'after_export') {
        this.mirrorBackupMode = mode;
        settings.setMirrorBackupMode(mode);
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
                this.msg = t('settings.auth_setup_unavailable');
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

        const tempPath = `exports/backup_${Date.now()}.slbk`;
        const writer = createTempBackupWriter(tempPath);

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

            await writer.open();

            const zipStream = zipFilesToStream(this.fileGenerator(), () => {
            });
            const docCount = await db.docs.count();
            const finalStream = encryptStream(zipStream, password, {
                docCount,
                meta: {
                    app: 'sahifah-lens',
                    version: pkg.version,
                }
            });

            let chunkCount = 0;
            for await (const chunk of finalStream) {
                await writer.write(chunk);
                chunkCount++;

                // FIX THE 76% FREEZE:
                // Give the UI more time to breathe every few chunks.
                // This prevents the Capacitor bridge from choking.
                if (chunkCount % 5 === 0) {
                    await new Promise(r => setTimeout(r, 25));
                }
            }

            const file = await writer.close();
            const nowDate = new Date();
            const y = nowDate.getFullYear();
            const m = String(nowDate.getMonth() + 1).padStart(2, '0');
            const d = String(nowDate.getDate()).padStart(2, '0');
            const hh = String(nowDate.getHours()).padStart(2, '0');
            const mm = String(nowDate.getMinutes()).padStart(2, '0');
            const ss = String(nowDate.getSeconds()).padStart(2, '0');
            const finalName = `lens-backup-${y}${m}${d}-${hh}${mm}${ss}.slbk`;

            const namedFile = new File([file], finalName, {
                type: 'application/octet-stream',
                lastModified: Date.now()
            });

            const mirror = await maybeMirrorBackupAfterExport(namedFile);
            if (mirror.status === 'mirrored') {
                this.msg = t('settings.mirror_auto_saved', {file: mirror.filename || finalName});
            } else if (mirror.status === 'needs_setup') {
                this.msg = t('settings.mirror_needs_setup_after_export');
            }

            AuthService.ignoreNextResumeForExternalAction('export-backup-share', 120_000);
            await shareFile(namedFile, finalName);

            const now = Date.now();
            localStorage.setItem('sahifah.lastBackup', String(now));
            this.lastBackupDate = now;
            this.msg = t('settings.backup_exported');

        } catch (e) {
            this.err = toUserErrorMessage(e);
            console.error(e);
        } finally {
            await writer.cleanup();

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
        if (!metaFile) throw new Error(t('settings.restore_invalid_backup'));

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

        this.msg = t('settings.restore_complete_processed', {count: this.backupProgress});
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

        const tempPath = `imports/temp_restore_${Date.now()}.zip`;
        const writer = createTempBackupWriter(tempPath);

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

            await writer.open();
            const fileStream = file.stream();

            if (password) {
                // SECURE PATH: Stream decryption
                for await (const chunk of decryptStream(fileStream, password)) {
                    await writer.write(chunk);
                }
            } else {
                const head = new Uint8Array(await file.slice(0, magicLength).arrayBuffer());
                const magic = new TextDecoder().decode(head);
                if (magic === 'SLBK') {
                    throw new Error(t('settings.restore_password_required'));
                }
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

            this.msg = t('settings.unpacking_library');
            this.requestUpdate();

            // Pass the disk-backed file to your existing zip handler
            await this.restoreFromZip(decryptedFile as File);

            this.msg = t('settings.restore_complete');

        } catch (e) {
            console.error(e);
            const mapped = mapRestoreError(e);
            this.err = mapped.direct
                ? mapped.message
                : t('settings.restore_failed', {error: mapped.message});
        } finally {
            try {
                await writer.cleanup();
            } catch (cleanupError) {
                console.warn('Restore temp cleanup failed:', cleanupError);
            }
            this.busy = false;
        }
    }

    private async askRestoreMode(count: number): Promise<RestoreMode | null> {
        const res = await ConfirmModal.prompt({
            title: t('settings.restore_mode_title'),
            description: t('settings.restore_mode_desc', {count}),
            placeholder: t('settings.restore_mode_placeholder'),
            confirm: t('settings.restore_mode_confirm')
        });

        if (!res) return null;
        const v = res.trim().toUpperCase();
        if (v === 'MERGE') return 'merge';
        if (v === 'REPLACE') return 'replace';
        return null;
    }

    private async nukeEverything() {
        if (this.deleteConfirmation !== 'DELETE') {
            this.msg = t('settings.delete_confirm_required');
            return;
        }

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
        const pct = Math.round((this.backupProgress / this.backupTotal) * 100);

        return html`
            <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div class="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-sm space-y-4 shadow-2xl">
                    <div class="flex items-center justify-between">
                        <div class="font-bold text-slate-100">${t('settings.backup_creating')}</div>
                        <div class="text-sm text-emerald-400 font-mono">${pct}%</div>
                    </div>
                    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-500 transition-all duration-200" style="width: ${pct}%"></div>
                    </div>
                    <div class="text-xs text-slate-400 text-center">
                        ${t('settings.backup_processing_item', {current: this.backupProgress, total: this.backupTotal})}
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
                ${this.renderDangerZone()}
            </div>
        `;
    }

    private renderHeader() {
        return html`
            <div class="flex items-center pb-2">
                <div class="flex items-center gap-3">
                    <h1 class="text-2xl font-bold text-slate-100">${t('settings.title')}</h1>
                    <div class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono mt-1">
                        v${pkg.version}
                    </div>
                </div>
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
                            <button class="text-slate-400 hover:text-slate-200 text-sm"
                                    aria-label=${t('common.cancel')}
                                    @click=${() => this.msg = null}>✕</button>
                        </div>
                    ` : null}
                    ${this.err ? html`
                        <div class="pointer-events-auto mt-2 p-4 rounded-lg bg-red-950/50 text-red-100 border border-red-900 flex items-start justify-between gap-3 shadow-lg">
                            <div class="font-medium">${this.err}</div>
                            <button class="text-red-300 hover:text-red-100 text-sm"
                                    aria-label=${t('common.cancel')}
                                    @click=${() => this.err = null}>✕</button>
                        </div>
                    ` : null}
                </div>
            ` : null}
        `;
    }

    private renderPrivacySection() {
        return html`
            <section class="p-4 rounded-xl border border-slate-700 bg-slate-800/50 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                    </svg>
                    ${t('settings.privacy_title')}
                    </div>
                    <button class="text-xs text-slate-400 hover:text-slate-200"
                            @click=${() => this.showPrivacyDetails = !this.showPrivacyDetails}>
                        ${this.showPrivacyDetails ? t('settings.hide_details') : t('settings.show_details')}
                    </button>
                </div>
                ${this.showPrivacyDetails ? html`
                    <p class="text-xs text-slate-300 leading-relaxed">
                        ${t('settings.privacy_body')}
                    </p>
                ` : null}
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
                    ${t('settings.advanced_protection')}
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm text-slate-200">${t('settings.app_lock')}</div>
                        <div class="text-[10px] text-slate-500">${t('settings.app_lock_desc')}</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors ${this.requireAuth ? 'bg-emerald-600' : 'bg-slate-700'}"
                            aria-label=${t('settings.app_lock')}
                            @click=${this.toggleAuth}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.requireAuth ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>

                ${this.showAdvancedSecurity ? html`
                    <div class="flex items-center justify-between">
                        <div>
                            <div class="text-sm text-slate-200">${t('settings.vault_mode_label')}</div>
                            <div class="text-[10px] text-slate-500">${t('settings.vault_mode_desc')}</div>
                        </div>
                        <button class="relative h-6 w-11 rounded-full transition-colors ${this.defaultVault ? 'bg-emerald-600' : 'bg-slate-700'}"
                                aria-label=${t('settings.vault_mode')}
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

        // Dynamic text based on platform
        const infoText = this.caps.isCapacitor
            ? t('settings.storage_native_info')
            : t('settings.storage_web_info');

        const persistence = this.persistence;
        return html`
            <section class="space-y-2">
                <div class="flex items-center justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    <span>${t('settings.local_storage')}</span>
                    <span>${this.formatBytes(this.storageUsed)} ${this.storageQuota > 0 ? '/ ' + this.formatBytes(this.storageQuota) : ''}</span>
                </div>

                ${this.storageQuota > 0 ? html`
                    <div class="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div class="h-full ${color} transition-all duration-500"
                             style="width: ${Math.max(2, pct)}%"></div>
                    </div>
                ` : null}

                <div class="text-[10px] text-slate-500">${infoText}</div>
                ${this.caps.isCapacitor ? null : html`
                    <div class="p-3 rounded-lg border border-slate-800 bg-slate-900/50 space-y-2">
                        <div class="text-xs text-slate-300">${t('settings.persistence_title')}</div>
                        <div class="text-[11px] ${persistence?.persisted ? 'text-emerald-300' : 'text-amber-300'}">
                            ${!persistence || !persistence.supported
                                    ? t('settings.persistence_unsupported')
                                    : persistence.persisted
                                            ? t('settings.persistence_active')
                                            : t('settings.persistence_inactive')}
                        </div>
                        ${persistence?.supported && !persistence.persisted ? html`
                            <button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 min-h-[44px]"
                                    ?disabled=${this.persistenceBusy}
                                    @click=${() => this.requestPersistentStorage()}>
                                ${this.persistenceBusy ? t('settings.persistence_requesting') : t('settings.persistence_request')}
                            </button>
                        ` : null}
                    </div>
                `}
            </section>
        `;
    }

    private renderDataManagement() {
        return html`
            <section class="space-y-3">
                <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">${t('settings.data_management')}</h2>
                ${this.renderBackupStatus()}
                ${this.renderMirrorBackupSection()}
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
                            <div class="text-start">
                                <div class="text-slate-200 font-medium">${t('settings.export_backup')}</div>
                                <div class="text-xs text-slate-500">${t('settings.export_backup_desc')}</div>
                            </div>
                        </div>
                    </button>

                    <button class="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
                            ?disabled=${this.busy}
                            @click=${() => this.pickRestoreFile()}>
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-lg bg-blue-900/30 text-blue-400">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m-4 4v12"></path>
                                </svg>
                            </div>
                            <div class="text-start">
                                <div class="text-slate-200 font-medium">${t('settings.restore_backup')}</div>
                                <div class="text-xs text-slate-500">${t('settings.restore_backup_desc')}</div>
                            </div>
                        </div>
                        ${!this.caps.isCapacitor ? html`
                            <input id="restore-input" class="hidden" type="file"
                                   accept=".slbk,.zip,application/zip"
                                   ?disabled=${this.busy}
                                   @click=${(e: Event) => e.stopPropagation()}
                                   @change=${(e: Event) => {
                                       const input = e.target as HTMLInputElement;
                                       const f = input.files?.[0];
                                       if (f) void this.importBackup(f);
                                       input.value = '';
                                   }}/>
                        ` : null}
                    </button>

                    <button class="text-xs text-slate-400 hover:text-slate-200 text-start"
                            @click=${() => this.showAdvancedDataTools = !this.showAdvancedDataTools}>
                        ${this.showAdvancedDataTools ? t('settings.hide_advanced_tools') : t('settings.show_advanced_tools')}
                    </button>

                    ${this.showAdvancedDataTools && this.showRepairTool ? html`
                        <button class="flex items-center justify-between p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 hover:bg-indigo-900/40 transition-colors"
                                ?disabled=${this.busy} @click=${() => this.runRepair()}>
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-lg bg-indigo-900/50 text-indigo-400">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
                                    </svg>
                                </div>
                                <div class="text-start">
                                    <div class="text-indigo-200 font-medium">${t('settings.repair_thumbnails')}</div>
                                    <div class="text-xs text-indigo-400">${t('settings.repair_thumbnails_desc')}</div>
                                </div>
                            </div>
                            ${this.repairProgress ? html`<span
                                    class="text-xs font-mono text-indigo-300">${this.repairProgress}</span>` : null}
                        </button>
                    ` : null}

                    ${this.showAdvancedDataTools && (this.hasIndexRisk || this.showRepairTool) ? html`
                        <button class="flex items-center justify-between p-4 rounded-xl bg-red-950/20 border border-red-500/30 hover:bg-red-900/30 transition-colors"
                                ?disabled=${this.busy} @click=${() => this.rebuildIndex()}>
                            <div class="flex items-center gap-3">
                                <div class="p-2 rounded-lg bg-red-900/40 text-red-300">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M4 4v6h6M20 20v-6h-6M5.636 18.364A9 9 0 1020 12"></path>
                                    </svg>
                                </div>
                                <div class="text-start">
                                    <div class="text-red-100 font-medium">${t('settings.rebuild_index_cta')}</div>
                                    <div class="text-xs text-red-300/80">${t('settings.rebuild_index_cta_desc')}</div>
                                </div>
                            </div>
                        </button>
                    ` : null}

                    ${this.showAdvancedDataTools ? html`
                    <button class="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
                            data-testid="run-storage-audit-btn"
                            ?disabled=${this.busy || this.storageAuditBusy}
                            @click=${() => this.runStorageAudit()}>
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-lg bg-amber-900/30 text-amber-300">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                                </svg>
                            </div>
                            <div class="text-start">
                                <div class="text-slate-200 font-medium">${t('settings.storage_audit_title')}</div>
                                <div class="text-xs text-slate-500">${t('settings.storage_audit_desc')}</div>
                            </div>
                        </div>
                        <div class="text-xs text-slate-400" data-testid="storage-audit-summary">
                            ${this.storageAuditBusy
                                    ? t('settings.storage_audit_running')
                                    : this.storageAuditDeleted > 0
                                            ? t('settings.storage_audit_deleted_short', {count: this.storageAuditDeleted})
                                            : this.storageAuditFound > 0
                                                    ? t('settings.storage_audit_found_short', {count: this.storageAuditFound})
                                                    : t('settings.storage_audit_idle')}
                        </div>
                    </button>
                    ` : null}

                </div>
            </section>
        `;
    }

    private renderMirrorBackupSection() {
        const unsupported = !isMirrorBackupSupported();
        return html`
            <div class="p-3 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
                <div class="flex items-center justify-between gap-3">
                    <div class="text-start flex-1 min-w-0">
                        <div class="text-sm text-slate-200 font-medium">${t('settings.mirror_title')}</div>
                        <div class="text-xs text-slate-500">${t('settings.mirror_desc')}</div>
                        <div class="text-[11px] text-slate-500 mt-1">${t('settings.mirror_trigger_note')}</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors shrink-0 ${this.mirrorBackupEnabled ? 'bg-emerald-600' : 'bg-slate-700'}"
                            aria-label=${t('settings.mirror_title')}
                            ?disabled=${this.busy}
                            @click=${() => this.toggleMirrorBackupEnabled()}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.mirrorBackupEnabled ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>

                ${unsupported ? html`
                    <div class="text-[11px] text-slate-500">${t('settings.mirror_unsupported')}</div>
                ` : html`
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs ${this.mirrorBackupReady ? 'text-emerald-300' : 'text-amber-300'}">
                            ${this.mirrorBackupReady ? t('settings.mirror_folder_ready') : t('settings.mirror_folder_missing')}
                            ${this.mirrorBackupReady && this.mirrorFolderLabel ? html`
                                <div class="mt-1 text-[10px] text-slate-400 break-all">${this.mirrorFolderLabel}</div>
                            ` : null}
                        </div>
                        <button class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 min-h-[44px]"
                                ?disabled=${this.busy}
                                @click=${() => this.pickMirrorBackupFolder()}>
                            ${t('settings.mirror_choose_folder')}
                        </button>
                    </div>
                    <div class="text-[11px] text-slate-500">${t('settings.mirror_picker_hint')}</div>

                    <button class="text-xs text-slate-400 hover:text-slate-200"
                            @click=${() => this.showMirrorAdvanced = !this.showMirrorAdvanced}>
                        ${this.showMirrorAdvanced ? t('settings.mirror_hide_advanced') : t('settings.mirror_show_advanced')}
                    </button>

                    ${this.showMirrorAdvanced ? html`
                        <div class="space-y-2 p-2 rounded-lg border border-slate-800 bg-black/30">
                            <label class="text-[10px] text-slate-500 uppercase tracking-wider">${t('settings.mirror_when')}</label>
                            <select
                                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                                    .value=${this.mirrorBackupMode}
                                    @change=${(e: Event) => this.setMirrorBackupMode((e.target as HTMLSelectElement).value as 'manual' | 'after_export')}>
                                <option value="manual">${t('settings.mirror_mode_manual')}</option>
                                <option value="after_export">${t('settings.mirror_mode_after_export')}</option>
                            </select>
                            <div class="text-[11px] text-amber-200/90">${t('settings.mirror_advanced_warning')}</div>
                        </div>
                    ` : null}
                `}
            </div>
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
                    ${t('settings.processing')}
                </div>

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm text-slate-200">${t('settings.ocr_label')}</div>
                        <div class="text-[10px] text-slate-500">${t('settings.ocr_desc')}</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors ${this.enableOcr ? 'bg-emerald-600' : 'bg-slate-700'}"
                            aria-label=${t('settings.ocr_toggle')}
                            @click=${() => this.toggleOcr()}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.enableOcr ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] text-slate-500 uppercase tracking-wider">${t('settings.language')}</label>
                    <select
                            class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                            @change=${(e: Event) => this.setLocale((e.target as HTMLSelectElement).value as LocaleCode)}>
                        ${i18n.getAvailableLocales().map(opt => html`
                            <option value=${opt.code} ?selected=${opt.code === i18n.getLocale()}>
                                ${opt.code === 'ar' ? t('settings.language_ar') : t('settings.language_en')}
                            </option>
                        `)}
                    </select>
                    <div class="text-[11px] text-slate-500">${t('settings.language_help')}</div>
                </div>

                <div class="space-y-2">
                    <label class="text-[10px] text-slate-500 uppercase tracking-wider">${t('settings.ocr_language')}</label>
                    <select
                            class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                            .value=${this.ocrLang}
                            @change=${(e: Event) => this.setOcrLang((e.target as HTMLSelectElement).value)}>
                        ${OCR_LANG_OPTIONS.map(opt => html`
                            <option value=${opt.code}>${t(opt.labelKey)}</option>
                        `)}
                    </select>
                </div>

                ${this.caps.isCapacitor ? html`
                    <div class="space-y-2">
                        <label class="text-[10px] text-slate-500 uppercase tracking-wider">${t('settings.scan_mode')}</label>
                        <select
                                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                                .value=${this.scanMode}
                                @change=${(e: Event) => this.setScanMode((e.target as HTMLSelectElement).value as ScanMode)}>
                            <option value="quick">${t('settings.scan_mode_quick')}</option>
                            <option value="manual">${t('settings.scan_mode_manual')}</option>
                        </select>
                        <div class="text-[11px] text-slate-500">${t('settings.scan_mode_desc')}</div>
                    </div>
                ` : null}

                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm text-slate-200">${t('settings.clipboard_auto_clear')}</div>
                        <div class="text-[10px] text-slate-500">${t('settings.clipboard_auto_clear_desc')}</div>
                    </div>
                    <button class="relative h-6 w-11 rounded-full transition-colors ${this.clearClipboardAfter60s ? 'bg-emerald-600' : 'bg-slate-700'}"
                            aria-label=${t('settings.clipboard_auto_clear')}
                            @click=${() => this.toggleClipboardAutoClear()}>
                        <span class="absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${this.clearClipboardAfter60s ? 'translate-x-5' : ''}"></span>
                    </button>
                </div>
            </section>
        `;
    }

    private renderDangerZone() {
        return html`
            <section id="DangerZone" class="space-y-3 pt-6 border-t border-slate-800">
                <h2 class="text-sm font-semibold text-red-400 uppercase tracking-wider">${t('settings.danger_zone')}</h2>

                ${!this.showDangerZone ? html`
                    <button class="w-full p-4 rounded-xl bg-slate-900 border border-red-900/30 text-red-400 hover:bg-red-950/20 transition-colors text-sm font-medium"
                            @click=${() => this.showDangerZone = true}>
                        ${t('settings.show_destructive_options')}
                    </button>
                ` : html`
                    <div class="p-4 rounded-xl bg-red-950/10 border border-red-900/50 space-y-4">
                        <div class="text-sm text-red-200">
                            <p class="font-bold mb-1">${t('settings.erase_all_title')}</p>
                            <p class="opacity-80">${t('settings.erase_all_body')}</p>
                        </div>
                        <div class="space-y-2">
                            <label class="text-xs text-red-400">${t('settings.erase_all_confirm_label')}</label>
                            <input type="text"
                                   class="w-full bg-slate-950 border border-red-900/50 rounded-lg px-3 py-2 text-red-100 focus:outline-none"
                                   placeholder=${t('settings.delete_keyword')}
                                   .value=${this.deleteConfirmation}
                                   @input=${(e: Event) => this.deleteConfirmation = (e.target as HTMLInputElement).value}
                            />
                        </div>
                        <button class="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold disabled:opacity-50"
                                ?disabled=${this.deleteConfirmation !== 'DELETE' || this.busy}
                                @click=${() => this.nukeEverything()}>
                            ${this.busy ? t('settings.erasing') : t('settings.erase_everything')}
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
                    <div class="text-xs text-amber-200">${t('settings.never_backed_up')}</div>
                </div>
            `;
        }
        const daysSince = Math.floor((Date.now() - this.lastBackupDate) / (1000 * 60 * 60 * 24));
        const isOverdue = daysSince > 30;
        return html`
            <div class="text-[10px] ${isOverdue ? 'text-amber-500 font-bold' : 'text-slate-500'}">
                ${t('settings.last_backup_line', {
                    date: new Date(this.lastBackupDate).toLocaleDateString(),
                    days: daysSince
                })}
                ${isOverdue ? t('settings.backup_recommended_suffix') : ''}
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
