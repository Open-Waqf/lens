const SAVE_COUNT_KEY = 'sahifah.backupReminder.saveCount';
const LAST_BACKUP_SEEN_KEY = 'sahifah.backupReminder.lastBackupSeen';
const REMINDER_INTERVAL = 10;

export function recordSuccessfulSaveAndShouldRemind(): boolean {
    const lastBackup = localStorage.getItem('sahifah.lastBackup') || '';
    const lastSeenBackup = localStorage.getItem(LAST_BACKUP_SEEN_KEY) || '';
    if (lastBackup !== lastSeenBackup) {
        localStorage.setItem(SAVE_COUNT_KEY, '0');
        localStorage.setItem(LAST_BACKUP_SEEN_KEY, lastBackup);
    }

    const current = Number(localStorage.getItem(SAVE_COUNT_KEY) || '0');
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(SAVE_COUNT_KEY, String(next));

    return next % REMINDER_INTERVAL === 0;
}
