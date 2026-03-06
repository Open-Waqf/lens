export type PersistenceStatus = {
    supported: boolean;
    persisted: boolean;
    grantedThisCall: boolean;
    quotaBytes?: number;
    usageBytes?: number;
};

export async function getPersistenceStatus(options?: { requestIfNeeded?: boolean }): Promise<PersistenceStatus> {
    const requestIfNeeded = options?.requestIfNeeded ?? true;

    const supported =
        !!navigator.storage &&
        typeof navigator.storage.persisted === 'function' &&
        typeof navigator.storage.persist === 'function';

    if (!supported) return {supported: false, persisted: false, grantedThisCall: false};

    const already = await navigator.storage.persisted();
    const grantedThisCall = already || !requestIfNeeded ? false : await navigator.storage.persist();

    let quotaBytes: number | undefined;
    let usageBytes: number | undefined;

    if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        quotaBytes = typeof est.quota === 'number' ? est.quota : undefined;
        usageBytes = typeof est.usage === 'number' ? est.usage : undefined;
    }

    return {
        supported: true,
        persisted: await navigator.storage.persisted(),
        grantedThisCall,
        quotaBytes,
        usageBytes,
    };
}
