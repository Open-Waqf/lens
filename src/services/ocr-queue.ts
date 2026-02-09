type OcrJob = {
    pageId: string;
    docTitle: string; // NEW
    status: 'processing' | 'done' | 'error'
};

class OcrQueueService extends EventTarget {
    private jobs: OcrJob[] = [];

    get activeCount() {
        return this.jobs.filter(j => j.status === 'processing').length;
    }

    get activeTitles() {
        const titles = this.jobs
            .filter(j => j.status === 'processing')
            .map(j => j.docTitle);
        return Array.from(new Set(titles));
    }

    addJob(pageId: string, docTitle: string) {
        this.jobs.push({pageId, docTitle, status: 'processing'});
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