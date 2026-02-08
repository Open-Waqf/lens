export type DocId = string;
export type FilterMode = 'original' | 'grayscale' | 'bw' | 'magic';

export type OcrWord = {
    text: string;
    // Normalized coordinates (0.0 to 1.0) relative to the image
    // [x, y, width, height]
    box: [number, number, number, number];
    confidence: number;
};

export interface DocRecord {
    id: DocId;
    title: string;
    folder: string | null;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    pageIds: string[];
    pdfPath?: string;
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

    // New: OCR Data
    words?: OcrWord[];
    ocrStatus?: 'pending' | 'done' | 'error';
}
