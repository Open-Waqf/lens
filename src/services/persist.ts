export async function tryPersistStorage(): Promise<boolean> {
    if (!navigator.storage || !navigator.storage.persist) {
        return false;
    }

    // 1. Check if already persisted
    const alreadyPersisted = await navigator.storage.persisted();
    if (alreadyPersisted) {
        console.log('Storage is already persistent.');
        return true;
    }

    // 2. Request persistence
    const isPersisted = await navigator.storage.persist();
    console.log(`Storage persistence request: ${isPersisted ? 'GRANTED' : 'DENIED'}`);
    return isPersisted;
}