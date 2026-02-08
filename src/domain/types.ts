export type DocId = string;
// Add 'whiteboard'
export type FilterMode = 'original' | 'grayscale' | 'bw' | 'magic' | 'whiteboard';

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
    words?: OcrWord[];
    ocrStatus?: 'pending' | 'done' | 'error';
}