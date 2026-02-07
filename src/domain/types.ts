export type DocId = string;
export type FilterMode = 'original' | 'grayscale' | 'bw';

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
}
