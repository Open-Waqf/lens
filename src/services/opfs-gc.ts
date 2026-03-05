import {deleteOrphanStorageFiles, findOrphanStorageFiles} from './storage-audit';

export async function garbageCollectOpfsDocs(): Promise<number> {
    const orphans = await findOrphanStorageFiles();
    if (orphans.length === 0) return 0;
    return await deleteOrphanStorageFiles(orphans);
}
