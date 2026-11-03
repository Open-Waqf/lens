export type DocId = string;
export type FilterMode = 'original' | 'bw' | 'magic';

export type OcrWord = {
    text: string;
    box: [number, number, number, number];
    confidence: number;
};

export interface DocRecord {
    id: DocId;
    title: string;
    folder: string | null;
    tags: string[];
    notes?: string;
    createdAt: number;
    updatedAt: number;
    pageIds: string[];
    pdfPath?: string;
    searchIndex?: string;
    correctedOcrText?: string;
    vaultEnabled?: boolean;
    /** The title was made by the app (date, or the first words read by OCR), not typed. */
    autoTitle?: boolean;
    /** Deleted with Undo still possible: hidden everywhere, removed for good soon after. */
    deletedAt?: number;
}

export interface PageRecord {
    id: string;
    docId: DocId;
    imagePath: string;
    thumbPath: string;
    width: number;
    height: number;
    rotation: 0 | 90 | 180 | 270;
    createdAt: number;
    reviewed?: 0 | 1;
    words?: OcrWord[];
    ocrStatus?: 'pending' | 'done' | 'error';
    /** Deleted with Undo still possible: hidden everywhere, removed for good soon after. */
    deletedAt?: number;
}
