# Backup fixtures: old backups must always restore

Each `.slbk` here was exported by a real release of Lens. `tests/e2e/backup-compat.spec.ts`
restores every one of them on every test run. That proves a backup someone made years ago
still opens after any update.

Rules:
- Never edit, regenerate or delete a file here. If a test fails, the app broke old backups:
  fix the app.
- When the backup format or the stored data changes, export a new backup with the new
  version and add it next to the old ones (keep the old ones).

| File | Made by | Password | Contents |
|---|---|---|---|
| `lens-0.5.0-2026-11.slbk` | Lens 0.5.0 (SLBK v3), Nov 2026 | `fixture-2026-11` | 1 document, "Backup fixture 2026-11 عقد", 2 pages |
