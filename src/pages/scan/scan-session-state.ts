import {t} from '../../lib/i18n';

export type ScanStage = 'idle' | 'camera' | 'edit';

export type ExitDecision =
    | { kind: 'nav-library'; markJustSavedDocId?: string }
    | { kind: 'nav-doc'; docId: string };

export const MAX_PAGES_PER_BATCH = 50;

export class ScanSessionState {
    // mode
    stage: ScanStage = 'idle';
    appendToDocId: string | null = null;
    currentDocId: string | null = null;

    // UI facts
    pageCount = 0;

    constructor(private onChange?: () => void) {
    }

    // ----- derived -----

    get canAddPage(): boolean {
        return this.pageCount < MAX_PAGES_PER_BATCH;
    }

    get isAppend(): boolean {
        return !!this.appendToDocId;
    }

    get docId(): string | null {
        return this.appendToDocId ?? this.currentDocId;
    }

    get hasDoc(): boolean {
        return !!this.docId;
    }

    get hasPages(): boolean {
        return this.pageCount > 0;
    }

    get exitLabel(): string {
        if (this.isAppend) return t('scan.back_to_document');
        if (this.hasPages) return t('scan.back_to_library');
        return t('common.cancel');
    }

    // ----- mutations -----

    setStage(s: ScanStage) {
        this.stage = s;
        this.onChange?.();
    }

    setAppend(docId: string | null) {
        this.appendToDocId = docId;
        this.currentDocId = docId; // matches your current behavior
        this.onChange?.();
    }

    setCurrentDocId(id: string | null) {
        this.currentDocId = id;
        this.onChange?.();
    }

    setPageCount(n: number) {
        this.pageCount = n;
        this.onChange?.();
    }

    resetAll() {
        this.stage = 'idle';
        this.appendToDocId = null;
        this.currentDocId = null;
        this.pageCount = 0;
        this.onChange?.();
    }

    // ----- exit policy (TESTABLE) -----

    // Leaving the scan screen never deletes anything: a saved page is saved (deleting is a
    // separate act, with Undo). Before Nov 2026 the X button could discard a document whose
    // pages were already saved, while the Android back button kept it.
    decideExit(): ExitDecision {
        if (this.appendToDocId) return {kind: 'nav-doc', docId: this.appendToDocId};
        const id = this.currentDocId;
        if (id && this.hasPages) return {kind: 'nav-library', markJustSavedDocId: id};
        return {kind: 'nav-library'};
    }
}
