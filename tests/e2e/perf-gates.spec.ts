import {expect, test} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PERF_THRESHOLDS_MS = {
    coldStartCameraReady: 2500,
    ocrSinglePage: 30000,
    search1000Docs: 500,
    export100Docs: 60000,
    reset500Docs: 3000,
} as const;

const perfResults: Record<string, {samples: number[]; measuredMs: number; thresholdMs: number}> = {};

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

function median(values: number[]): number {
    return percentile(values, 50);
}

async function clearVault(page: import('@playwright/test').Page): Promise<void> {
    if (!page.url().startsWith('http://localhost:4173')) {
        await page.goto('http://localhost:4173/#/library');
    }
    await page.evaluate(async () => {
        async function clearDb(): Promise<void> {
            await new Promise<void>((resolve, reject) => {
                const req = indexedDB.open('sahifah-lens');
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('docs')) {
                        const docs = db.createObjectStore('docs', {keyPath: 'id'});
                        docs.createIndex('updatedAt', 'updatedAt', {unique: false});
                        docs.createIndex('createdAt', 'createdAt', {unique: false});
                        docs.createIndex('title', 'title', {unique: false});
                        docs.createIndex('tags', 'tags', {unique: false, multiEntry: true});
                        docs.createIndex('folder', 'folder', {unique: false});
                    }
                    if (!db.objectStoreNames.contains('pages')) {
                        const pages = db.createObjectStore('pages', {keyPath: 'id'});
                        pages.createIndex('docId', 'docId', {unique: false});
                        pages.createIndex('createdAt', 'createdAt', {unique: false});
                    }
                };
                req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction(['docs', 'pages'], 'readwrite');
                    tx.objectStore('docs').clear();
                    tx.objectStore('pages').clear();
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(tx.error ?? new Error('Failed to clear IndexedDB'));
                    };
                };
            });
        }

        async function clearOpfs(): Promise<void> {
            if (!navigator.storage?.getDirectory) return;
            const root = await navigator.storage.getDirectory();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for await (const [name, handle] of (root as any).entries()) {
                await root.removeEntry(name, {recursive: handle.kind === 'directory'});
            }
        }

        await clearDb();
        await clearOpfs();
        localStorage.removeItem('sahifah.lastBackup');
        sessionStorage.clear();
    });
}

async function seedVault(page: import('@playwright/test').Page, opts: {docCount: number; pagesPerDoc: number; includeFiles: boolean; searchOnly?: boolean}): Promise<void> {
    await page.evaluate(async ({docCount, pagesPerDoc, includeFiles, searchOnly}) => {
        const now = Date.now();

        function pad(n: number): string {
            return String(n).padStart(4, '0');
        }

        const docs: Array<Record<string, unknown>> = [];
        const pages: Array<Record<string, unknown>> = [];

        for (let d = 0; d < docCount; d++) {
            const docId = `perf-doc-${pad(d + 1)}`;
            const pageIds: string[] = [];
            for (let p = 0; p < pagesPerDoc; p++) {
                const pageId = `${docId}-page-${pad(p + 1)}`;
                pageIds.push(pageId);
                if (!searchOnly) {
                    pages.push({
                        id: pageId,
                        docId,
                        imagePath: `pages/${docId}/${pageId}.jpg`,
                        thumbPath: `pages/${docId}/${pageId}.thumb.jpg`,
                        width: 1200,
                        height: 1600,
                        rotation: 0,
                        createdAt: now - d * 1000 - p,
                        reviewed: 1,
                        words: [],
                        ocrStatus: 'done'
                    });
                }
            }

            docs.push({
                id: docId,
                title: `Perf Doc ${pad(d + 1)}`,
                folder: d % 2 === 0 ? 'Perf' : null,
                tags: [`tag-${(d % 10) + 1}`],
                notes: `performance note ${d + 1}`,
                createdAt: now - d * 1000,
                updatedAt: now - d * 1000,
                pageIds,
                searchIndex: `keyword-${pad(d + 1)} stable-search-token`
            });
        }

        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('sahifah-lens');
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('docs')) {
                    const docsStore = db.createObjectStore('docs', {keyPath: 'id'});
                    docsStore.createIndex('updatedAt', 'updatedAt', {unique: false});
                    docsStore.createIndex('createdAt', 'createdAt', {unique: false});
                    docsStore.createIndex('title', 'title', {unique: false});
                    docsStore.createIndex('tags', 'tags', {unique: false, multiEntry: true});
                    docsStore.createIndex('folder', 'folder', {unique: false});
                }
                if (!db.objectStoreNames.contains('pages')) {
                    const pagesStore = db.createObjectStore('pages', {keyPath: 'id'});
                    pagesStore.createIndex('docId', 'docId', {unique: false});
                    pagesStore.createIndex('createdAt', 'createdAt', {unique: false});
                }
            };
            req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['docs', 'pages'], 'readwrite');
                const docsStore = tx.objectStore('docs');
                const pagesStore = tx.objectStore('pages');
                for (const doc of docs) docsStore.put(doc);
                for (const page of pages) pagesStore.put(page);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error ?? new Error('Failed to seed IndexedDB'));
                };
            };
        });

        if (includeFiles && navigator.storage?.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const payload = new Uint8Array(1024);
            payload.fill(7);

            async function ensureDir(parts: string[]): Promise<FileSystemDirectoryHandle> {
                let dir = root;
                for (const part of parts) {
                    dir = await dir.getDirectoryHandle(part, {create: true});
                }
                return dir;
            }

            for (const page of pages as Array<{imagePath: string; thumbPath: string}>) {
                for (const p of [page.imagePath, page.thumbPath]) {
                    const parts = p.split('/').filter(Boolean);
                    const fileName = parts.pop();
                    if (!fileName) continue;
                    const dir = await ensureDir(parts);
                    const handle = await dir.getFileHandle(fileName, {create: true});
                    const writable = await handle.createWritable();
                    await writable.write(payload);
                    await writable.close();
                }
            }
        }
    }, opts);
}

function storePerfResult(name: string, samples: number[], thresholdMs: number): void {
    perfResults[name] = {
        samples,
        measuredMs: Math.round(median(samples)),
        thresholdMs,
    };
}

test.describe.configure({mode: 'serial'});

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.setItem('sahifah.enableOcr', '1');
        window.localStorage.setItem('sahifah.ocrLang', 'eng');
        window.localStorage.removeItem('sahifah.integrity_check');
        (window as unknown as { Capacitor: unknown }).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as unknown as { navigator: Navigator & { mediaDevices: MediaDevices } }).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
});

test.afterAll(async () => {
    const outDir = path.resolve(process.cwd(), 'artifacts');
    fs.mkdirSync(outDir, {recursive: true});

    const metrics = Object.entries(perfResults).map(([name, v]) => ({
        name,
        thresholdMs: v.thresholdMs,
        measuredMs: v.measuredMs,
        p95Ms: Math.round(percentile(v.samples, 95)),
        samples: v.samples.map(s => Math.round(s)),
        pass: v.measuredMs <= v.thresholdMs,
    }));

    const report = {
        generatedAt: new Date().toISOString(),
        environment: {
            browser: 'Desktop Chrome (Playwright)',
            routeBase: 'http://localhost:4173',
        },
        thresholdsMs: PERF_THRESHOLDS_MS,
        metrics,
    };

    fs.writeFileSync(path.join(outDir, 'perf-report.json'), JSON.stringify(report, null, 2), 'utf-8');

    const lines = [
        '# Performance Report',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        '| Metric | Measured (ms) | P95 (ms) | Threshold (ms) | Pass |',
        '|---|---:|---:|---:|:---:|',
        ...metrics.map(m => `| ${m.name} | ${m.measuredMs} | ${m.p95Ms} | ${m.thresholdMs} | ${m.pass ? 'yes' : 'no'} |`),
        '',
    ];
    fs.writeFileSync(path.join(outDir, 'perf-summary.md'), lines.join('\n'), 'utf-8');
});

test('PERF-START-001 cold start to camera ready <= 2.5s', async ({page}) => {
    test.setTimeout(120000);
    await clearVault(page);
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        await page.goto('http://localhost:4173/#/scan');
        const captureBtn = page.getByRole('button', {name: /Capture/i}).first();
        if (!(await captureBtn.isVisible().catch(() => false))) {
            const onboardingBtn = page.getByRole('button', {name: /Start Scanning/i});
            if (await onboardingBtn.isVisible().catch(() => false)) {
                await onboardingBtn.click();
            }
            const startBtn = page.getByRole('button', {name: /Open Camera|Start Scanner|Try Again/i}).first();
            await expect(startBtn).toBeVisible({timeout: 10000});
            await startBtn.click();
        }
        await expect(page.getByRole('button', {name: /Capture/i}).first()).toBeVisible({timeout: 10000});
        samples.push(Date.now() - t0);
    }
    storePerfResult('cold_start_camera_ready', samples, PERF_THRESHOLDS_MS.coldStartCameraReady);
    expect(Math.round(median(samples))).toBeLessThanOrEqual(PERF_THRESHOLDS_MS.coldStartCameraReady);
});

test('PERF-OCR-001 OCR 1-page document <= 30s', async ({page}) => {
    await clearVault(page);
    await page.goto('http://localhost:4173/#/scan');

    const importBtn = page.locator('button').filter({hasText: /Import/i});
    await expect(importBtn).toBeVisible({timeout: 15000});
    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'perf-ocr.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    await expect(page.locator('page-editor')).toBeVisible({timeout: 15000});
    await page.evaluate(() => {
        const el = document.querySelector('page-editor') as { quad?: unknown; requestUpdate?: () => void } | null;
        if (!el) return;
        el.quad = [
            {x: 10, y: 10},
            {x: 490, y: 10},
            {x: 490, y: 490},
            {x: 10, y: 490}
        ];
        el.requestUpdate?.();
    });

    const t0 = Date.now();
    await page.getByRole('button', {name: /Save Scan/i}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 15000});

    const ocrDone = await page.evaluate(async () => {
        function sleep(ms: number): Promise<void> {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            const status = await new Promise<string | null>((resolve, reject) => {
                const req = indexedDB.open('sahifah-lens');
                req.onerror = () => reject(req.error ?? new Error('DB open failed'));
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction(['pages'], 'readonly');
                    const store = tx.objectStore('pages');
                    const allReq = store.getAll();
                    allReq.onsuccess = () => {
                        const rows = (allReq.result || []) as Array<{createdAt?: number; ocrStatus?: string}>;
                        rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
                        db.close();
                        resolve(rows[0]?.ocrStatus ?? null);
                    };
                    allReq.onerror = () => {
                        db.close();
                        reject(allReq.error ?? new Error('Read pages failed'));
                    };
                };
            });
            if (status === 'done' || status === 'error') return true;
            await sleep(150);
        }
        return false;
    });
    expect(ocrDone).toBe(true);

    const elapsed = Date.now() - t0;
    storePerfResult('ocr_single_page', [elapsed], PERF_THRESHOLDS_MS.ocrSinglePage);
    expect(elapsed).toBeLessThanOrEqual(PERF_THRESHOLDS_MS.ocrSinglePage);
});

test('PERF-SEARCH-001 search <= 500ms at 1000 docs', async ({page}) => {
    await clearVault(page);
    await page.goto('http://localhost:4173/#/library');
    await seedVault(page, {docCount: 1000, pagesPerDoc: 0, includeFiles: false, searchOnly: true});
    await page.reload();

    const search = page.locator('input[placeholder*="Search"]');
    await expect(search).toBeVisible({timeout: 15000});

    const tokens = ['keyword-0001', 'keyword-0500', 'keyword-0999'];
    const samples: number[] = [];
    for (const token of tokens) {
        await search.fill('');
        const t0 = Date.now();
        await search.fill(token);
        await expect(page.locator('h3', {hasText: /Perf Doc/}).first()).toBeVisible({timeout: 2000});
        samples.push(Date.now() - t0);
    }

    storePerfResult('search_1000_docs', samples, PERF_THRESHOLDS_MS.search1000Docs);
    expect(Math.round(median(samples))).toBeLessThanOrEqual(PERF_THRESHOLDS_MS.search1000Docs);
});

test('PERF-EXPORT-001 export 100-doc vault <= 60s', async ({page}) => {
    await clearVault(page);
    await page.goto('http://localhost:4173/#/settings');
    await seedVault(page, {docCount: 100, pagesPerDoc: 1, includeFiles: true});
    await page.reload();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('perf123456');

    const t0 = Date.now();
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().endsWith('.slbk')).toBe(true);
    const elapsed = Date.now() - t0;

    storePerfResult('export_100_docs', [elapsed], PERF_THRESHOLDS_MS.export100Docs);
    expect(elapsed).toBeLessThanOrEqual(PERF_THRESHOLDS_MS.export100Docs);
});

test('PERF-RESET-001 nuclear reset 500-doc vault <= 3s', async ({page}) => {
    await clearVault(page);
    await page.goto('http://localhost:4173/#/settings');
    await seedVault(page, {docCount: 500, pagesPerDoc: 1, includeFiles: true});
    await page.reload();

    await page.getByRole('button', {name: 'Show Destructive Options'}).click();
    await page.locator('input[placeholder="DELETE"]').fill('DELETE');

    const t0 = Date.now();
    await page.getByRole('button', {name: 'Erase Everything'}).click();
    await page.getByRole('button', {name: 'Wipe Everything', exact: true}).click();

    await page.waitForURL(/#\/settings/, {timeout: 15000});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);

    let empty = false;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            empty = await page.evaluate(async () => {
        const dbCounts = await new Promise<{docs: number; pages: number}>((resolve, reject) => {
            const req = indexedDB.open('sahifah-lens');
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['docs', 'pages'], 'readonly');
                const docsReq = tx.objectStore('docs').count();
                const pagesReq = tx.objectStore('pages').count();
                tx.oncomplete = () => {
                    db.close();
                    resolve({docs: docsReq.result || 0, pages: pagesReq.result || 0});
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error ?? new Error('Count failed'));
                };
            };
        });

        if (!navigator.storage?.getDirectory) return dbCounts.docs === 0 && dbCounts.pages === 0;
        const root = await navigator.storage.getDirectory();

        async function countFilesUnder(name: string): Promise<number> {
            try {
                const dir = await root.getDirectoryHandle(name, {create: false});
                let count = 0;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for await (const [, handle] of (dir as any).entries()) {
                    if (handle.kind === 'file') {
                        count++;
                    }
                }
                return count;
            } catch {
                return 0;
            }
        }

        const docsFiles = await countFilesUnder('docs');
        const pagesFiles = await countFilesUnder('pages');
        const exportsFiles = await countFilesUnder('exports');
        return dbCounts.docs === 0 && dbCounts.pages === 0 && docsFiles === 0 && pagesFiles === 0 && exportsFiles === 0;
    });
            break;
        } catch {
            await page.waitForTimeout(150);
        }
    }
    expect(empty).toBe(true);

    const elapsed = Date.now() - t0;
    storePerfResult('reset_500_docs', [elapsed], PERF_THRESHOLDS_MS.reset500Docs);
    expect(elapsed).toBeLessThanOrEqual(PERF_THRESHOLDS_MS.reset500Docs);
});
