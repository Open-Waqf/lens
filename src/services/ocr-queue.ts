// src/services/ocr-queue.ts

type OcrJob = { pageId: string; status: 'processing' | 'done' | 'error' };

class OcrQueueService extends EventTarget {
    private jobs: OcrJob[] = [];

    get activeCount() {
        return this.jobs.filter(j => j.status === 'processing').length;
    }

    addJob(pageId: string) {
        this.jobs.push({pageId, status: 'processing'});
        this.notify();
    }

    completeJob(pageId: string, success: boolean) {
        const job = this.jobs.find(j => j.pageId === pageId);
        if (job) {
            job.status = success ? 'done' : 'error';
            // Remove from list after a short delay (so user sees "Done")
            setTimeout(() => {
                this.jobs = this.jobs.filter(j => j.pageId !== pageId);
                this.notify();
            }, 2000);
        }
        this.notify();
    }

    private notify() {
        this.dispatchEvent(new CustomEvent('change'));
    }
}

export const ocrQueue = new OcrQueueService();