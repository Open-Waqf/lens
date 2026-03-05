export type ScanStage = 'idle' | 'camera' | 'edit';

export type ExitDecision =
    | { kind: 'nav-library'; markJustSavedDocId?: string }
    | { kind: 'nav-doc'; docId: string }
    | { kind: 'confirm-discard'; docId: string; message: string };

export const MAX_PAGES_PER_BATCH = 50;

export class ScanSessionState {
    // mode
    stage: ScanStage = 'idle';
    appendToDocId: string | null = null;
    currentDocId: string | null = null;

    // “keep/discard” semantics
    committed = false;

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
        if (this.isAppend) return 'Back to document';
        if (!this.hasDoc && !this.hasPages) return 'Cancel';
        if (!this.committed && this.hasPages) return 'Discard';
        if (this.committed) return 'Back to library';
        return 'Cancel';
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

    markCommitted() {
        this.committed = true;
        this.onChange?.();
    }

    resetAll() {
        this.stage = 'idle';
        this.appendToDocId = null;
        this.currentDocId = null;
        this.pageCount = 0;
        this.committed = false;
        this.onChange?.();
    }

    // ----- exit policy (TESTABLE) -----

    decideExit(): ExitDecision {
        // append mode: always go back to the document
        if (this.appendToDocId) {
            return {kind: 'nav-doc', docId: this.appendToDocId};
        }

        const id = this.currentDocId;

        // nothing created yet
        if (!id || (!this.hasDoc && !this.hasPages)) {
            return {kind: 'nav-library'};
        }

        // pages exist but user never committed => discard entire doc
        if (this.hasPages && !this.committed) {
            return {
                kind: 'confirm-discard',
                docId: id,
                message: 'Discard this document? Imported pages will be lost.'
            };
        }

        // committed => keep doc, go back library and highlight
        if (this.committed && this.hasPages) {
            return {kind: 'nav-library', markJustSavedDocId: id};
        }

        return {kind: 'nav-library'};
    }
}
