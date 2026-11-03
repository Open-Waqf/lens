# Translations

All texts live in `src/lib/i18n.ts` (English, Arabic). `npm run check-i18n` fails if a
language misses a text, a text is unused, or a translation uses a placeholder English does
not have. `scripts/i18n-known-gaps.json` lists accepted gaps (empty since Nov 2026: keep it
that way).

Plurals: Arabic grammar needs different words for one and for several, so a count gets two
texts (`…_one`, `…_other`), and the code picks one. Never glue an English "s" onto a text.

Dates follow the app language (`toLocaleDateString(i18n.getLocale())`), not the phone's.

## Needs a native Arabic review

These Arabic texts were written by AI in Nov 2026 and have not been checked by a native
speaker yet. Remove a line from this list once it has been reviewed.

- Restore and erase: `settings.restore_mode_desc`, `settings.restore_mode_merge`,
  `settings.restore_mode_replace`, `settings.factory_reset_title`, `settings.factory_reset_body`,
  `settings.factory_reset_confirm`, `settings.erasing`, `settings.restore_incorrect_password`,
  `settings.restore_corrupted_file`, `settings.restore_unsupported_version`
- Settings: `settings.export_backup_desc`, `settings.storage_native_info`,
  `settings.storage_web_info`, `settings.ocr_toggle`
- Library: `library.delete_count_one`, `library.delete_count_other`, `library.page_count_one`,
  `library.page_count_other`, `library.deleted_count`, `library.delete_folder_title`,
  `library.delete_folder_body`, `library.folder_removed`, `library.moved_to`,
  `library.move_to_folder`, `library.enter_folder_name`, `library.existing_folders`,
  `library.delete_body`, `library.move_to_folder_placeholder`, `library.move_confirm`,
  `library.group_by_folder_title`, `library.select_title`, `library.unsort_folder_title`,
  `library.protect_data`, `library.protect_body`, `library.create_backup`
- Document and editor: `doc.export_pdf_small`, `doc.share_failed_zip`, `doc.browser_share_zip`,
  `editor.filter_original`, `editor.filter_clean`, `editor.filter_bw`
- Other: `scan.picker_error`, `common.stop`, `common.unsort`, `common.share_now`,
  `storage.risk.title`, `storage.risk.body`, `storage.risk.recover`,
  `storage.audit.auto_cleaned`, `app.factory_reset`, `errors.render`, `errors.generic`,
  `errors.opfs_security`
