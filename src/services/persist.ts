export async function requestStoragePersistence(): Promise<void> {
    try {
        if (!('storage' in navigator)) return;
        // Ask browser to persist storage (reduce eviction risk)
        // Not guaranteed, but helps on Chromium-based browsers.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storage = navigator.storage as any;
        if (typeof storage.persist === 'function') {
            await storage.persist();
        }
    } catch {
        // ignore
    }
}
