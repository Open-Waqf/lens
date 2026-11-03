// Single-source i18n registry: locale config + messages live in this file.

export type TextDirection = 'ltr' | 'rtl';

const STORAGE_KEY = 'sahifah.locale';
const DEFAULT_LOCALE = 'en' as const;

const EN_MESSAGES = {
    // Scan Page
    'scan.title': 'Scan',
    'scan.add_pages': 'Add pages',
    'scan.retake': 'Retake',
    'scan.auto_capture': 'Auto Capture',
    'scan.import_unavailable': 'Import unavailable',
    'scan.capture_failed': 'Capture failed',
    'scan.max_pages_reached': 'Maximum page limit reached ({{max}}). Please save this document before adding more.',
    'scan.permission_title': 'Camera Access Blocked',
    'scan.permission_body': 'Camera access is blocked. Try again after granting permission, or continue now by importing files.',
    'scan.try_again': 'Try Again',
    'scan.import_files': 'Import from Files',
    'scan.open_camera': 'Open Camera',
    'scan.start_scanner': 'Start Scanner',
    'scan.mode_quick_desc': 'Uses native document scanner for fastest capture.',
    'scan.import_docs': 'Import a photo or PDF',
    'scan.importing_files': 'Importing files...',
    'scan.done': 'Done',
    'scan.share_pdf': 'Share as PDF',
    'scan.scan_another': 'Scan another page',
    'scan.idle_hint_web': 'Point the camera at a page, or import a photo or a PDF.',
    'scan.toggle_torch': 'Toggle Torch',
    'scan.edit_page': 'Edit page',
    'scan.remove_page': 'Remove page',
    'scan.retake_body': 'Capture will replace the selected page',
    'scan.picker_error': 'Could not open picker: {{error}}',
    'scan.quick_scan_failed': 'Quick scan failed: {{error}}',
    'scan.thumbnail_alt': 'Page thumbnail {{index}}',
    'scan.capture': 'Capture',
    'scan.edges_unclear': 'Document edges unclear — adjust the crop manually',

    // Overlay / Guidance
    'scan.guide_align': 'Align document here',
    'scan.guide_hold_steady': 'Hold steady',
    'scan.guide_move_closer': 'Move closer',
    
    // Editor / Review
    'scan.review_title': 'Reviewing imported pages',
    'scan.review_pages': '{{current}}/{{total}}',
    'scan.discard_scan': 'Discard Scan?',
    'scan.stop_review': 'Stop Reviewing?',
    'scan.stop_review_body': 'You have {{count}} unedited page(s) remaining. They will be saved as is.',
    'scan.discard_edits': 'Discard Edits?',
    'scan.discard_capture': 'Discard Capture?',
    'scan.discard_body': 'This action cannot be undone.',
    'scan.save_scan': 'Save Scan',
    'scan.share_as_title': 'Share as',
    'scan.share_as_jpg': 'Share as JPG',
    'scan.share_as_pdf': 'Share as PDF',
    'scan.back_to_document': 'Back to Document',
    'scan.back_to_library': 'Back to Library',
    'scan.discard_imported_body': 'Discard this document? Imported pages will be lost.',

    // Common
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.discard': 'Discard',
    'common.stop': 'Stop Reviewing',
    'common.document': 'Document',
    'common.unsort': 'Unsort Documents',
    'common.share_now': 'Share Now',
    'common.back': 'Back',
    'common.confirm': 'Confirm',
    'common.loading': 'Loading...',
    'common.close': 'Close',
    'common.processing': 'Processing...',

    // Library
    'library.title': 'Library',
    'library.search_placeholder': 'Search docs & content...',
    'library.all_docs': 'All Documents',
    'library.unsorted': 'Unsorted',
    'library.no_scans': 'No scans yet',
    'library.no_scans_body': 'Tap + below to scan your first document. It stays on this phone: no cloud, no account.',
    'library.delete_folder_title': 'Delete Folder?',
    'library.delete_folder_body': 'All documents in "{{folder}}" will be moved to "Unsorted". No documents will be deleted.',
    'library.folder_removed': 'Folder "{{folder}}" removed',
    'library.moved_to': 'Moved to "{{folder}}"',
    'library.move_to_folder': 'Move to Folder',
    'library.enter_folder_name': 'Enter a folder name or leave blank to unsort.',
    'library.existing_folders': 'Existing: {{folders}}',
    'library.delete_selected_count': 'Delete ({{count}})',
    'library.move_selected': 'Move Selected To Folder',
    'library.move_to_folder_placeholder': 'e.g. Taxes, Work...',
    'library.move_confirm': 'Move',
    'library.group_by_folder_title': 'Group by Folder',
    'library.select_title': 'Select',
    'library.unsort_folder_title': 'Unsort Folder',
    'library.protect_data': 'Protect Your Data',
    'library.protect_body': 'You have {{count}} documents stored locally. If you lose your device or clear browser data, these will be lost forever.',
    'library.create_backup': 'Create an Encrypted Backup now →',
    'library.no_results': 'No documents match "{{query}}"',
    'library.clear_filters': 'Clear Filters',
    'library.analyzing': 'Analyzing',
    'library.analyzing_docs': 'Documents...',

    // Doc Page
    'doc.library_back': 'Library',
    'doc.title_label': 'Title',
    'doc.folder_label': 'Folder',
    'doc.folder_placeholder': 'e.g. Finance',
    'doc.find_label': 'Find in document',
    'doc.find_placeholder': 'Search text...',
    'doc.show_text': 'Text',
    'doc.copy_text': 'Copy OCR Text',
    'doc.copied_text': 'OCR text copied to clipboard.',
    'doc.copy_failed': 'Could not copy text to clipboard.',
    'doc.edit_ocr_text': 'Edit OCR Text',
    'doc.edit_ocr_help': 'Correct OCR text for accuracy. Your corrected text is used for copy and search.',
    'doc.ocr_text_placeholder': 'Type corrected OCR text...',
    'doc.save_ocr_text': 'Save OCR Text',
    'doc.reset_ocr_text': 'Reset to Auto OCR',
    'doc.ocr_text_saved': 'Corrected OCR text saved.',
    'doc.ocr_text_reset': 'Reverted to automatic OCR text.',
    'doc.no_text': 'No text detected in this document yet.',
    'doc.export_pdf': 'Share PDF',
    'doc.more': 'More',
    'doc.page_edit': 'Edit',
    'doc.page_share': 'Share',
    'doc.delete_doc_action': 'Delete document',
    'doc.export_pdf_small': 'Smaller PDF',
    'doc.share_images': 'Share Images',
    'doc.add_pages': 'Add Pages',
    'doc.generating_pdf': 'Generating PDF',
    'doc.delete_page_title': 'Delete Page?',
    'doc.page_label': 'Page {{count}}',
    'doc.share_failed_zip': 'Sharing failed. Try sharing the pages one by one, or export a PDF.',
    'doc.browser_share_zip': 'This browser cannot share several files at once. Export a PDF instead.',
    'doc.not_found': 'Document not found',
    'doc.filtered_by_search': 'Filtered by search',
    'doc.share_image_title': 'Share this image',
    'doc.page_not_found': 'Page not found',
    'doc.edit_load_failed': 'Could not load image for editing',
    'doc.viewer_load_failed': 'Failed to load image',
    'doc.pages_count': 'Pages ({{count}})',
    'doc.open_page': 'Open page {{count}}',
    'doc.drag_reorder': 'Drag to reorder pages',
    'doc.clear_search': 'Clear search',
    'doc.viewer_close': 'Close viewer',
    'doc.viewer_prev': 'Previous page',
    'doc.viewer_next': 'Next page',

    // Page Editor
    'editor.clear_error': 'Clear error',
    'editor.crop': 'Crop',
    'editor.crop_done': 'Done cropping',
    'editor.filter': 'Filter',
    'editor.auto_detect_edges': 'Auto detect edges',
    'editor.auto_short': 'AUTO',
    'editor.rotate_90': 'Rotate 90°',
    'editor.undo': 'Undo',
    'editor.invalid_selection': 'Invalid selection',
    'editor.filter_original': 'Original',
    'editor.filter_clean': 'Clean',
    'editor.filter_bw': 'Black & white',
    'editor.load_failed': 'Failed to load image',

    // Settings / Backup
    'settings.encrypt_backup_title': 'Encrypt Backup',
    'settings.encrypt_backup_desc': 'Enter a password.',
    'settings.title': 'Settings',
    'settings.local_storage': 'Local Storage',
    'settings.data_management': 'Data Management',
    'settings.export_confirm': 'Export',
    'settings.backup_password_placeholder': 'Password123',
    'settings.decrypt_backup_title': 'Decrypt Backup',
    'settings.decrypt_backup_desc': 'Enter password',
    'settings.restore_confirm': 'Restore',
    'settings.restore_password_placeholder': 'Password',
    'settings.backup_password_required': 'Password is required for .slbk export.',
    'settings.restore_password_required': 'Password is required for .slbk backups.',
    'settings.app_lock': 'App Lock',
    'settings.app_lock_desc': 'Require Biometrics to open app',
    'settings.ocr_label': 'Text Recognition (OCR)',
    'settings.ocr_desc': 'Extract text for search.',
    'settings.clipboard_auto_clear': 'Clipboard Auto-Clear',
    'settings.clipboard_auto_clear_desc': 'When enabled, text copied from the app is cleared after 60 seconds.',
    'settings.restore_incorrect_password': 'Incorrect password.',
    'settings.restore_corrupted_file': 'Vault file is corrupted or incomplete.',
    'settings.restore_unsupported_version': 'Vault file version is not supported.',
    'settings.ocr_language': 'OCR Language',
    'settings.ocr_lang_ara_eng': 'Arabic + English (Default)',
    'settings.ocr_lang_ara': 'Arabic',
    'settings.ocr_lang_eng': 'English',
    'settings.storage_audit_title': 'Storage Audit',
    'settings.storage_audit_desc': 'Find and clean files not linked to any document.',
    'settings.storage_audit_running': 'Running...',
    'settings.storage_audit_idle': 'Run',
    'settings.storage_audit_found_short': 'Found {{count}}',
    'settings.storage_audit_deleted_short': 'Deleted {{count}}',
    'settings.storage_audit_found_body': 'Found {{count}} orphaned files not linked to metadata. Delete them now?',
    'settings.storage_audit_delete': 'Delete orphans',
    'settings.storage_audit_deleted': 'Storage Audit complete: deleted {{count}} orphan files.',
    'settings.storage_audit_no_orphans': 'Storage Audit complete: no orphan files found.',
    'settings.storage_audit_failed': 'Storage Audit failed: {{error}}',
    'settings.rebuild_index_title': 'Rebuild Library Index?',
    'settings.rebuild_index_desc': 'This recreates document metadata from files currently on disk. Existing metadata will be replaced.',
    'settings.rebuild_index_confirm': 'Rebuild',
    'settings.rebuild_index_running': 'Rebuilding index from files...',
    'settings.rebuild_index_done': 'Recovery complete. Restored {{docs}} documents and {{pages}} pages.',
    'settings.rebuild_index_failed': 'Recovery failed: {{error}}',
    'settings.auth_setup_unavailable': 'Setup cancelled or biometrics not available.',
    'settings.restore_mode_title': 'Restore Backup',
    'settings.restore_mode_desc': 'This backup has {{count}} document(s). Add them to your library, or replace your library with them?',
    'settings.restore_mode_merge': 'Add to my library',
    'settings.restore_mode_replace': 'Replace my library',
    'settings.nuke_final_title': 'Final Warning',
    'settings.nuke_final_desc': 'This will wipe ALL documents and settings. This cannot be undone.',
    'settings.nuke_final_confirm': 'Wipe Everything',
    'settings.nuke_running': 'Wiping data...',
    'settings.nuke_failed': 'Failed to reset: {{error}}',
    'settings.backup_creating': 'Creating Backup',
    'settings.backup_processing_item': 'Processing item {{current}} of {{total}}',
    'settings.privacy_body': 'This app is Offline Only. Your documents are stored locally and are never sent to any cloud server.',
    'settings.storage_native_info': 'Your documents are stored in this app\'s private storage on this phone.',
    'settings.storage_web_info': 'Managed by browser. The OS may clear this if storage is low.',
    'settings.persistence_request': 'Request Persistent Storage',
    'settings.persistence_requesting': 'Requesting...',
    'settings.persistence_granted': 'Persistent storage granted.',
    'settings.persistence_already': 'Persistent storage already active.',
    'settings.persistence_denied_hint': 'Your browser denied this request. To enable it, click the lock icon in the address bar and allow storage access for this site.',
    'settings.persistence_failed': 'Persistent storage request failed: {{error}}',
    'settings.export_backup': 'Export Backup',
    'settings.export_backup_desc': 'An encrypted file you can keep anywhere',
    'settings.restore_backup': 'Restore Backup',
    'settings.restore_backup_desc': 'Merge or replace library',
    'settings.restore_select_valid_file': 'Please select a .slbk or .zip file.',
    'settings.restore_picker_error': 'Could not open file picker: {{error}}',
    'settings.restore_invalid_backup': 'Invalid backup: missing metadata.',
    'settings.repair_library': 'Repair Library',
    'settings.repair_library_desc': 'Your library index may be incomplete. Tap to rebuild it and recover missing documents.',
    'settings.erase_all_body': 'Permanently delete all documents and reset app.',
    'settings.never_backed_up': 'Never backed up. Export a backup to prevent data loss.',
    'settings.last_backup_line': 'Last backup: {{date}} ({{days}} days ago)',
    'settings.backup_recommended_suffix': ' - Backup Recommended',
    'settings.erasing': 'Erasing...',
    'settings.erase_everything': 'Erase Everything',
    'settings.packaging_backup': 'Packaging backup...',
    'settings.backup_encrypting': 'Encrypting...',
    'settings.backup_encrypting_desc': 'Encrypting and saving — almost done.',
    'settings.backup_exported': 'Backup exported successfully.',
    'settings.decrypting_stream': 'Decrypting stream...',
    'settings.unpacking_library': 'Unpacking library...',
    'settings.restore_complete_processed': 'Restore complete. Processed {{count}} files.',
    'settings.restore_complete': 'Restore complete! You can return to the Library.',
    'settings.restore_failed': 'Restore failed: {{error}}',
    'settings.language': 'App Language',
    'settings.language_en': 'English',
    'settings.language_ar': 'Arabic',

    // Storage / backup reminders
    'storage.banner.title': 'Storage is not persistent',
    'storage.banner.body': 'OS may clear storage. Export backup to be safe.',
    'storage.banner.settings': 'Settings',
    'storage.banner.dismiss': 'Dismiss',
    'storage.risk.title': 'Possible metadata loss detected',
    'storage.risk.body': 'Files exist but index is missing. Open Settings to recover.',
    'storage.risk.recover': 'Recover',
    'storage.audit.auto_cleaned': 'Cleaned up {{count}} leftover file(s).',
    'nav.new_scan': 'New Scan',
    'nav.library': 'Library',
    'nav.settings': 'Settings',
    'app.fatal_title': 'Something went wrong',
    'app.reload': 'Reload App',
    'app.update_title': 'Update available',
    'app.update_body': 'A newer version is ready. Update when you are not in the middle of scanning.',
    'app.update_now': 'Update now',
    'app.update_later': 'Later',
    'app.factory_reset': 'Factory Reset',
    'auth.locked_title': 'Sahifah is Locked',
    'auth.locked_body': 'Use your device security (Fingerprint, FaceID, or PIN) to unlock.',
    'auth.locked_alt': 'Locked',
    'auth.unlock': 'Unlock Vault',
    'auth.failed': 'Authentication failed. Try again.',
    'cropper.captured_alt': 'Captured image',
    'cropper.drag_hint': 'Drag to select crop area (optional)',
    'errors.render': 'Render error',
    'errors.generic': 'Error',
    'errors.camera_permission': 'Camera access is blocked. Allow camera permission and try again.',
    'errors.camera_unavailable': 'No camera is available on this device.',
    'errors.camera_busy': 'Camera is currently in use by another app. Close it and try again.',
    'errors.camera_constraints': 'Camera constraints are not supported on this device/browser.',
    'errors.native_file_access': 'Cannot open this file from Android picker. Please choose the file again or use a different location.',
    'errors.pdf_font_load_failed': 'Failed to load bundled Arabic font ({{status}}).',
    'errors.pdf_font_invalid': 'Bundled Arabic font file is invalid or truncated.',
    'errors.pdf_arabic_font_required': 'Arabic OCR text layer requires bundled Arabic font. Please reinstall app assets.',
    'errors.pdf_arabic_line_font_required': 'Arabic line requires embedded Unicode font.',
    'errors.pdf_generate_page_failed': 'Failed to generate PDF at page {{page}}.',
    'errors.editor_bitmap_missing': 'Failed to load preview bitmap.',
    'errors.editor_encode_master_failed': 'Failed to encode output image.',
    'errors.editor_encode_thumb_failed': 'Failed to encode thumbnail image.',
    'errors.editor_master_missing': 'Processed image data is missing.',
    'errors.editor_thumb_missing': 'Processed thumbnail data is missing.',
    'errors.editor_encode_share_failed': 'Failed to encode share image.',
    'errors.editor_share_missing': 'Share image data is missing.',
    'seo.app_name': 'Sahifah Lens',
    'seo.default_description': 'Local-first, zero-cloud document scanner with offline OCR and encrypted backups.',
    'seo.keywords': 'private scanner, offline OCR, local-first, encrypted backup, no cloud',
    'seo.locale': 'en_US',
    'seo.locale_alt': 'ar_AR',
    'settings.factory_reset_title': 'Factory Reset?',
    'settings.factory_reset_body': 'This will erase ALL local documents and settings.\nCannot be undone.',
    'settings.factory_reset_confirm': 'Reset Everything',
    'errors.opfs_security': 'Local secure storage is blocked in this browser mode. Exit private mode and try again.',
    'library.page_count_one': '1 page',
    'library.page_count_other': '{{count}} pages',
    'undo.undo': 'Undo',
    'undo.doc_deleted': 'Document deleted',
    'undo.docs_deleted': 'Documents deleted: {{count}}',
    'undo.page_deleted': 'Page deleted',
    'undo.pages_deleted': 'Pages deleted: {{count}}',
    'doc.sign_with_signer': 'Sign with Signer',
    'doc.ocr_reading': 'Reading the text…',
    'doc.folder_new': 'New folder…',
} as const;

const AR_MESSAGES = {
    ...EN_MESSAGES,
    // App / Navigation
    'nav.new_scan': 'مسح جديد',
    'nav.library': 'المكتبة',
    'nav.settings': 'الإعدادات',
    'app.fatal_title': 'حدث خطأ ما',
    'app.reload': 'إعادة تحميل التطبيق',
    'app.update_title': 'يوجد تحديث متاح',
    'app.update_body': 'إصدار أحدث جاهز. حدّث عندما لا تكون في منتصف المسح.',
    'app.update_now': 'حدّث الآن',
    'app.update_later': 'لاحقًا',

    // Common
    'common.cancel': 'إلغاء',
    'common.delete': 'حذف',
    'common.discard': 'تجاهل',
    'common.document': 'مستند',
    'common.back': 'رجوع',
    'common.confirm': 'تأكيد',
    'common.loading': 'جارٍ التحميل...',
    'common.close': 'إغلاق',
    'common.processing': 'جارٍ المعالجة...',

    // Scan
    'scan.title': 'المسح',
    'scan.add_pages': 'إضافة صفحات',
    'scan.auto_capture': 'التقاط تلقائي',
    'scan.import_unavailable': 'الاستيراد غير متاح',
    'scan.capture_failed': 'فشل الالتقاط',
    'scan.max_pages_reached': 'تم الوصول للحد الأقصى للصفحات ({{max}}). يرجى حفظ المستند قبل إضافة المزيد.',
    'scan.permission_title': 'تم حظر الوصول للكاميرا',
    'scan.permission_body': 'الوصول للكاميرا محظور. أعد المحاولة بعد منح الإذن أو تابع بالاستيراد من الملفات.',
    'scan.try_again': 'إعادة المحاولة',
    'scan.open_camera': 'فتح الكاميرا',
    'scan.start_scanner': 'بدء الماسح',
    'scan.mode_quick_desc': 'يستخدم ماسح النظام الأصلي لأسرع التقاط.',
    'scan.import_files': 'استيراد من الملفات',
    'scan.import_docs': 'استيراد صورة أو ملف PDF',
    'scan.importing_files': 'جارٍ استيراد الملفات...',
    'scan.done': 'تم',
    'scan.share_pdf': 'مشاركة كملف PDF',
    'scan.scan_another': 'مسح صفحة أخرى',
    'scan.idle_hint_web': 'وجّه الكاميرا نحو صفحة، أو استورد صورة أو ملف PDF.',
    'scan.toggle_torch': 'تبديل الإضاءة',
    'scan.edit_page': 'تعديل الصفحة',
    'scan.remove_page': 'إزالة الصفحة',
    'scan.retake_body': 'سيتم استبدال الصفحة المحددة باللقطة الجديدة',
    'scan.retake': 'إعادة الالتقاط',
    'scan.guide_align': 'حاذِ المستند داخل الإطار',
    'scan.guide_hold_steady': 'ثبّت الجهاز',
    'scan.guide_move_closer': 'اقترب أكثر',
    'scan.review_title': 'مراجعة الصفحات المستوردة',
    'scan.review_pages': '{{current}}/{{total}}',
    'scan.discard_scan': 'تجاهل المسح؟',
    'scan.stop_review': 'إيقاف المراجعة؟',
    'scan.stop_review_body': 'لديك {{count}} صفحة غير معدلة. سيتم حفظها كما هي.',
    'scan.discard_edits': 'تجاهل التعديلات؟',
    'scan.share_as_title': 'المشاركة بصيغة',
    'scan.share_as_jpg': 'مشاركة كصورة JPG',
    'scan.share_as_pdf': 'مشاركة كملف PDF',
    'scan.back_to_document': 'العودة إلى المستند',
    'scan.back_to_library': 'العودة إلى المكتبة',
    'scan.discard_imported_body': 'هل تريد تجاهل هذا المستند؟ ستفقد الصفحات المستوردة.',
    'scan.save_scan': 'حفظ المسح',
    'scan.discard_capture': 'تجاهل الالتقاط؟',
    'scan.discard_body': 'لا يمكن التراجع عن هذا الإجراء.',
    'scan.quick_scan_failed': 'فشل المسح السريع: {{error}}',
    'scan.thumbnail_alt': 'صورة مصغرة للصفحة {{index}}',
    'scan.capture': 'التقاط',
    'scan.edges_unclear': 'حواف المستند غير واضحة — اضبط الاقتصاص يدويًا',

    // Library
    'library.title': 'المكتبة',
    'library.search_placeholder': 'ابحث في المستندات والمحتوى...',
    'library.all_docs': 'كل المستندات',
    'library.unsorted': 'غير مصنف',
    'library.no_scans': 'لا توجد عمليات مسح بعد',
    'library.no_scans_body': 'اضغط + أدناه لمسح أول مستند. يبقى على هذا الهاتف: بلا سحابة وبلا حساب.',
    'library.no_results': 'لا توجد مستندات تطابق "{{query}}"',
    'library.clear_filters': 'مسح الفلاتر',
    'library.analyzing': 'جارٍ التحليل',
    'library.analyzing_docs': 'المستندات...',

    // Document
    'doc.library_back': 'المكتبة',
    'doc.title_label': 'العنوان',
    'doc.folder_label': 'المجلد',
    'doc.folder_placeholder': 'مثال: الشؤون المالية',
    'doc.find_label': 'بحث داخل المستند',
    'doc.find_placeholder': 'ابحث في النص...',
    'doc.show_text': 'النص',
    'doc.copy_text': 'نسخ نص OCR',
    'doc.copied_text': 'تم نسخ نص OCR إلى الحافظة.',
    'doc.copy_failed': 'تعذر نسخ النص إلى الحافظة.',
    'doc.edit_ocr_text': 'تعديل نص OCR',
    'doc.edit_ocr_help': 'صحّح نص OCR لتحسين الدقة. النص المصحح يُستخدم للنسخ والبحث.',
    'doc.ocr_text_placeholder': 'اكتب النص المصحح...',
    'doc.save_ocr_text': 'حفظ نص OCR',
    'doc.reset_ocr_text': 'إعادة للنص التلقائي',
    'doc.ocr_text_saved': 'تم حفظ نص OCR المصحح.',
    'doc.ocr_text_reset': 'تم الرجوع للنص التلقائي.',
    'doc.no_text': 'لا يوجد نص مستخرج في هذا المستند حتى الآن.',
    'doc.export_pdf': 'مشاركة PDF',
    'doc.more': 'المزيد',
    'doc.page_edit': 'تعديل',
    'doc.page_share': 'مشاركة',
    'doc.delete_doc_action': 'حذف المستند',
    'doc.export_pdf_small': 'PDF أصغر حجمًا',
    'doc.share_images': 'مشاركة الصور',
    'doc.add_pages': 'إضافة صفحات',
    'doc.generating_pdf': 'جاري إنشاء ملف PDF',
    'doc.delete_page_title': 'حذف الصفحة؟',
    'doc.page_label': 'الصفحة {{count}}',
    'doc.not_found': 'لم يتم العثور على المستند',
    'doc.filtered_by_search': 'مفلتر حسب البحث',
    'doc.share_image_title': 'مشاركة هذه الصورة',
    'doc.page_not_found': 'لم يتم العثور على الصفحة',
    'doc.edit_load_failed': 'تعذر تحميل الصورة للتعديل',
    'doc.viewer_load_failed': 'فشل تحميل الصورة',
    'doc.pages_count': 'الصفحات ({{count}})',
    'doc.open_page': 'فتح الصفحة {{count}}',
    'doc.drag_reorder': 'اسحب لإعادة ترتيب الصفحات',
    'doc.clear_search': 'مسح البحث',
    'doc.viewer_close': 'إغلاق العارض',
    'doc.viewer_prev': 'الصفحة السابقة',
    'doc.viewer_next': 'الصفحة التالية',

    // Page Editor
    'editor.clear_error': 'مسح الخطأ',
    'editor.crop': 'اقتصاص',
    'editor.crop_done': 'إنهاء الاقتصاص',
    'editor.filter': 'فلتر',
    'editor.auto_detect_edges': 'اكتشاف الحواف تلقائيًا',
    'editor.auto_short': 'تلقائي',
    'editor.rotate_90': 'تدوير 90°',
    'editor.undo': 'تراجع',
    'editor.invalid_selection': 'تحديد غير صالح',
    'editor.load_failed': 'تعذر تحميل الصورة',
    'editor.filter_original': 'الأصل',
    'editor.filter_clean': 'منقّح',
    'editor.filter_bw': 'أبيض وأسود',

    // Settings
    'settings.title': 'الإعدادات',
    'settings.privacy_body': 'بياناتك تبقى على جهازك. لا حسابات ولا سحابة ولا تتبع.',
    'settings.data_management': 'إدارة البيانات',
    'settings.local_storage': 'التخزين المحلي',
    'settings.app_lock': 'قفل التطبيق',
    'settings.app_lock_desc': 'يتطلب المصادقة الحيوية لفتح التطبيق',
    'settings.export_backup': 'تصدير نسخة احتياطية',
    'settings.export_backup_desc': 'ملف مشفّر يمكنك حفظه في أي مكان',
    'settings.export_confirm': 'تصدير',
    'settings.encrypt_backup_title': 'تشفير النسخة الاحتياطية',
    'settings.encrypt_backup_desc': 'أدخل كلمة مرور.',
    'settings.backup_password_placeholder': 'Password123',
    'settings.backup_password_required': 'كلمة المرور مطلوبة لتصدير .slbk.',
    'settings.packaging_backup': 'تجهيز النسخة الاحتياطية...',
    'settings.backup_encrypting': 'جارٍ التشفير...',
    'settings.backup_encrypting_desc': 'جارٍ التشفير والحفظ — يكاد ينتهي.',
    'settings.backup_creating': 'جارٍ إنشاء النسخة الاحتياطية',
    'settings.backup_processing_item': 'عنصر {{current}} من {{total}}',
    'settings.backup_exported': 'تم تصدير النسخة الاحتياطية بنجاح.',
    'settings.restore_backup': 'استعادة نسخة احتياطية',
    'settings.restore_backup_desc': 'دمج أو استبدال المكتبة',
    'settings.decrypt_backup_title': 'فك تشفير النسخة الاحتياطية',
    'settings.decrypt_backup_desc': 'أدخل كلمة المرور',
    'settings.restore_password_placeholder': 'كلمة المرور',
    'settings.restore_password_required': 'كلمة المرور مطلوبة لنسخ .slbk.',
    'settings.restore_confirm': 'استعادة',
    'settings.restore_select_valid_file': 'يرجى اختيار ملف .slbk أو .zip صالح.',
    'settings.restore_picker_error': 'تعذر فتح منتقي الملفات: {{error}}',
    'settings.restore_invalid_backup': 'نسخة احتياطية غير صالحة: البيانات الوصفية مفقودة.',
    'settings.restore_mode_title': 'استعادة النسخة الاحتياطية',
    'settings.restore_mode_desc': 'تحتوي هذه النسخة على {{count}} مستند. هل تضيفها إلى مكتبتك أم تستبدل بها مكتبتك؟',
    'settings.restore_mode_merge': 'أضفها إلى مكتبتي',
    'settings.restore_mode_replace': 'استبدل مكتبتي',
    'settings.decrypting_stream': 'جارٍ فك التشفير...',
    'settings.unpacking_library': 'جارٍ فك المكتبة...',
    'settings.restore_complete_processed': 'اكتملت الاستعادة. تمت معالجة {{count}} ملفًا.',
    'settings.restore_complete': 'اكتملت الاستعادة! يمكنك الرجوع إلى المكتبة.',
    'settings.restore_failed': 'فشلت الاستعادة: {{error}}',
    'settings.storage_web_info': 'يديره المتصفح، وقد يمسحه النظام عند امتلاء التخزين. صدّر نسخة احتياطية بانتظام.',
    'settings.storage_native_info': 'مستنداتك محفوظة في التخزين الخاص بهذا التطبيق على هذا الهاتف.',
    'settings.never_backed_up': 'لم يتم أخذ نسخة احتياطية من قبل. صدّر نسخة لتجنب فقدان البيانات.',
    'settings.last_backup_line': 'آخر نسخة احتياطية: {{date}} (قبل {{days}} يومًا)',
    'settings.backup_recommended_suffix': ' - يُنصح بالنسخ الاحتياطي',
    'settings.persistence_request': 'طلب الاستمرارية',
    'settings.persistence_requesting': 'جارٍ الطلب...',
    'settings.persistence_granted': 'تم تفعيل الاستمرارية.',
    'settings.persistence_already': 'الاستمرارية كانت مفعلة مسبقًا.',
    'settings.persistence_denied_hint': 'رفض المتصفح هذا الطلب. لتفعيله، انقر على أيقونة القفل في شريط العنوان واسمح بالوصول إلى التخزين لهذا الموقع.',
    'settings.persistence_failed': 'فشل طلب الاستمرارية: {{error}}',
    'settings.ocr_label': 'التعرّف على النص (OCR)',
    'settings.ocr_desc': 'استخراج النص للبحث',
    'settings.ocr_language': 'لغة OCR',
    'settings.ocr_lang_ara_eng': 'العربية + الإنجليزية (افتراضي)',
    'settings.ocr_lang_ara': 'العربية',
    'settings.ocr_lang_eng': 'الإنجليزية',
    'settings.clipboard_auto_clear': 'مسح الحافظة تلقائيًا',
    'settings.clipboard_auto_clear_desc': 'عند التفعيل، يتم مسح النص المنسوخ من التطبيق بعد 60 ثانية.',
    'settings.storage_audit_title': 'تدقيق التخزين',
    'settings.storage_audit_desc': 'اعثر على الملفات غير المرتبطة بأي مستند ونظّفها.',
    'settings.storage_audit_running': 'جارٍ التشغيل...',
    'settings.storage_audit_idle': 'تشغيل',
    'settings.storage_audit_found_short': 'تم العثور على {{count}}',
    'settings.storage_audit_deleted_short': 'تم حذف {{count}}',
    'settings.storage_audit_found_body': 'تم العثور على {{count}} ملفًا يتيمًا غير مرتبط بالبيانات. حذفه الآن؟',
    'settings.storage_audit_delete': 'حذف الملفات اليتيمة',
    'settings.storage_audit_deleted': 'اكتمل تدقيق التخزين: تم حذف {{count}} ملفًا يتيمًا.',
    'settings.storage_audit_no_orphans': 'اكتمل تدقيق التخزين: لا توجد ملفات يتيمة.',
    'settings.storage_audit_failed': 'فشل تدقيق التخزين: {{error}}',
    'settings.repair_library': 'إصلاح المكتبة',
    'settings.repair_library_desc': 'قد يكون فهرس مكتبتك غير مكتمل. اضغط لإعادة بنائه واسترداد المستندات المفقودة.',
    'settings.rebuild_index_title': 'إعادة بناء فهرس المكتبة؟',
    'settings.rebuild_index_desc': 'سيتم إعادة إنشاء بيانات المستندات من الملفات الموجودة حاليًا. سيتم استبدال البيانات الحالية.',
    'settings.rebuild_index_confirm': 'إعادة البناء',
    'settings.rebuild_index_running': 'جارٍ إعادة بناء الفهرس...',
    'settings.rebuild_index_done': 'اكتملت الاستعادة. تمت استعادة {{docs}} مستندًا و{{pages}} صفحة.',
    'settings.rebuild_index_failed': 'فشلت الاستعادة: {{error}}',
    'settings.auth_setup_unavailable': 'تم إلغاء الإعداد أو أن المصادقة الحيوية غير متاحة.',
    'settings.erase_all_body': 'حذف دائم لكل المستندات وإعادة ضبط التطبيق.',
    'settings.nuke_final_title': 'تحذير نهائي',
    'settings.nuke_final_desc': 'سيتم مسح كل المستندات والإعدادات. لا يمكن التراجع.',
    'settings.nuke_final_confirm': 'مسح كل شيء',
    'settings.nuke_running': 'جارٍ المسح...',
    'settings.nuke_failed': 'فشل إعادة الضبط: {{error}}',
    'settings.erase_everything': 'مسح كل شيء',
    'settings.language': 'لغة التطبيق',
    'settings.language_en': 'الإنجليزية',
    'settings.language_ar': 'العربية',
    'library.delete_selected_count': 'حذف ({{count}})',
    'library.move_selected': 'نقل المحدد إلى مجلد',
    'auth.locked_title': 'صحيفة مقفلة',
    'auth.locked_body': 'استخدم أمان جهازك (بصمة، FaceID أو PIN) لفتح التطبيق.',
    'auth.locked_alt': 'مقفل',
    'auth.unlock': 'فتح الخزنة',
    'auth.failed': 'فشلت المصادقة. حاول مرة أخرى.',
    'cropper.captured_alt': 'صورة ملتقطة',
    'cropper.drag_hint': 'اسحب لتحديد منطقة القص (اختياري)',
    'storage.banner.title': 'التخزين غير دائم',
    'storage.banner.body': 'قد يقوم النظام بحذف التخزين. صدّر نسخة احتياطية للبقاء آمنًا.',
    'storage.banner.settings': 'الإعدادات',
    'storage.banner.dismiss': 'إخفاء',
    'errors.camera_permission': 'تم حظر الوصول للكاميرا. اسمح بإذن الكاميرا ثم أعد المحاولة.',
    'errors.camera_unavailable': 'لا توجد كاميرا متاحة على هذا الجهاز.',
    'errors.camera_busy': 'الكاميرا قيد الاستخدام من تطبيق آخر. أغلقه ثم أعد المحاولة.',
    'errors.camera_constraints': 'قيود الكاميرا غير مدعومة على هذا الجهاز/المتصفح.',
    'errors.native_file_access': 'تعذر فتح هذا الملف من منتقي ملفات أندرويد. اختر الملف مرة أخرى أو استخدم موقعًا مختلفًا.',
    'errors.pdf_font_load_failed': 'تعذر تحميل خط العربية المدمج ({{status}}).',
    'errors.pdf_font_invalid': 'ملف خط العربية المدمج غير صالح أو تالف.',
    'errors.pdf_arabic_font_required': 'طبقة نص OCR العربية تتطلب خط عربية مدمجًا. يرجى إعادة تثبيت أصول التطبيق.',
    'errors.pdf_arabic_line_font_required': 'السطر العربي يتطلب خط Unicode مضمّنًا.',
    'errors.pdf_generate_page_failed': 'فشل إنشاء PDF في الصفحة {{page}}.',
    'errors.editor_bitmap_missing': 'تعذر تحميل صورة المعاينة.',
    'errors.editor_encode_master_failed': 'فشل ترميز صورة الإخراج.',
    'errors.editor_encode_thumb_failed': 'فشل ترميز صورة المصغّر.',
    'errors.editor_master_missing': 'بيانات الصورة المعالجة مفقودة.',
    'errors.editor_thumb_missing': 'بيانات المصغّر المعالجة مفقودة.',
    'errors.editor_encode_share_failed': 'فشل ترميز صورة المشاركة.',
    'errors.editor_share_missing': 'بيانات صورة المشاركة مفقودة.',
    'seo.app_name': 'عدسة الصحيفة',
    'seo.default_description': 'ماسح مستندات محلي بالكامل بدون سحابة، مع OCR دون اتصال ونسخ احتياطية مشفّرة.',
    'seo.keywords': 'ماسح خاص, OCR بدون إنترنت, محلي بالكامل, نسخة احتياطية مشفرة, بدون سحابة',
    'seo.locale': 'ar_AR',
    'seo.locale_alt': 'en_US',
    'library.page_count_one': 'صفحة واحدة',
    'library.page_count_other': 'عدد الصفحات: {{count}}',
    'scan.picker_error': 'تعذّر فتح منتقي الملفات: {{error}}',
    'common.stop': 'إيقاف المراجعة',
    'common.unsort': 'إزالة التصنيف',
    'common.share_now': 'مشاركة',
    'library.delete_folder_title': 'حذف المجلد؟',
    'library.delete_folder_body': 'ستُنقل كل المستندات في "{{folder}}" إلى "غير مصنّف". لن يُحذف أي مستند.',
    'library.folder_removed': 'أُزيل المجلد "{{folder}}"',
    'library.moved_to': 'نُقل إلى "{{folder}}"',
    'library.move_to_folder': 'نقل إلى مجلد',
    'library.enter_folder_name': 'اكتب اسم مجلد، أو اتركه فارغًا لإزالة التصنيف.',
    'library.existing_folders': 'المجلدات الحالية: {{folders}}',
    'library.move_to_folder_placeholder': 'مثل: ضرائب، عمل...',
    'library.move_confirm': 'نقل',
    'library.group_by_folder_title': 'تجميع حسب المجلد',
    'library.select_title': 'تحديد',
    'library.unsort_folder_title': 'إزالة تصنيف المجلد',
    'library.protect_data': 'احمِ بياناتك',
    'library.protect_body': 'لديك {{count}} مستندات محفوظة على هذا الجهاز فقط. إذا فقدت الجهاز أو مُسحت بياناته، ستضيع إلى الأبد.',
    'library.create_backup': 'أنشئ نسخة احتياطية مشفّرة الآن ←',
    'doc.share_failed_zip': 'فشلت المشاركة. جرّب مشاركة الصفحات واحدة واحدة، أو صدّر ملف PDF.',
    'doc.browser_share_zip': 'لا يستطيع هذا المتصفح مشاركة عدة ملفات معًا. صدّر ملف PDF بدلًا من ذلك.',
    'settings.restore_incorrect_password': 'كلمة المرور غير صحيحة.',
    'settings.restore_corrupted_file': 'ملف النسخة الاحتياطية تالف أو غير مكتمل.',
    'settings.restore_unsupported_version': 'إصدار ملف النسخة الاحتياطية غير مدعوم.',
    'settings.erasing': 'جارٍ المسح...',
    'storage.risk.title': 'قد تكون قائمة المستندات مفقودة',
    'storage.risk.body': 'الملفات موجودة لكن قائمتها مفقودة. افتح الإعدادات لاستعادتها.',
    'storage.risk.recover': 'استعادة',
    'storage.audit.auto_cleaned': 'نُظّفت ملفات متبقية ({{count}}).',
    'app.factory_reset': 'إعادة ضبط المصنع',
    'errors.render': 'خطأ في العرض',
    'errors.generic': 'خطأ',
    'settings.factory_reset_title': 'إعادة ضبط المصنع؟',
    'settings.factory_reset_body': 'سيُمسح كل ما في هذا الجهاز من مستندات وإعدادات.\nلا يمكن التراجع.',
    'settings.factory_reset_confirm': 'مسح كل شيء',
    'errors.opfs_security': 'التخزين المحلي محظور في وضع المتصفح هذا. اخرج من وضع التصفح الخاص وحاول مرة أخرى.',
    'undo.undo': 'تراجع',
    'undo.doc_deleted': 'حُذف المستند',
    'undo.docs_deleted': 'المستندات المحذوفة: {{count}}',
    'undo.page_deleted': 'حُذفت الصفحة',
    'undo.pages_deleted': 'الصفحات المحذوفة: {{count}}',
    'doc.sign_with_signer': 'التوقيع عبر Signer',
    'doc.ocr_reading': 'جارٍ قراءة النص…',
    'doc.folder_new': 'مجلد جديد…',
} as const;

type LocaleDefinition = {
    label: string;
    dir: TextDirection;
    messages: Record<string, string>;
};

const LOCALES = {
    en: {
        label: 'English',
        dir: 'ltr',
        messages: EN_MESSAGES,
    },
    ar: {
        label: 'العربية',
        dir: 'rtl',
        messages: AR_MESSAGES,
    },
} as const satisfies Record<string, LocaleDefinition>;

export type LocaleCode = keyof typeof LOCALES;
export type LocaleKey = keyof typeof EN_MESSAGES;

function isLocaleCode(value: string): value is LocaleCode {
    return value in LOCALES;
}

class I18nService {
    private currentLocale: LocaleCode;

    constructor() {
        this.currentLocale = this.resolveInitialLocale();
        this.applyDocumentLocale();
    }

    private resolveInitialLocale(): LocaleCode {
        const fromUrl = this.resolveLocaleFromUrl();
        if (fromUrl) return fromUrl;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && isLocaleCode(stored)) return stored;
        } catch {
            // Ignore storage access errors (e.g. restrictive browser mode).
        }
        if (typeof navigator !== 'undefined') {
            const browser = navigator.language?.toLowerCase() || '';
            if (browser.startsWith('ar')) return 'ar';
        }
        return DEFAULT_LOCALE;
    }

    private resolveLocaleFromUrl(): LocaleCode | null {
        try {
            if (typeof window === 'undefined') return null;
            const search = new URLSearchParams(window.location.search);
            const direct = search.get('lang');
            if (direct && isLocaleCode(direct)) return direct;

            const hash = window.location.hash || '';
            const idx = hash.indexOf('?');
            if (idx >= 0) {
                const hashSearch = new URLSearchParams(hash.slice(idx + 1));
                const hashLang = hashSearch.get('lang');
                if (hashLang && isLocaleCode(hashLang)) return hashLang;
            }
        } catch {
            // Ignore malformed URL params.
        }
        return null;
    }

    private applyDocumentLocale(): void {
        if (typeof document === 'undefined') return;
        const html = document.documentElement;
        const def = LOCALES[this.currentLocale];
        html.lang = this.currentLocale;
        html.dir = def.dir;
    }

    t(key: LocaleKey, params?: Record<string, string | number>): string {
        const messages = LOCALES[this.currentLocale].messages;
        const fallback = LOCALES[DEFAULT_LOCALE].messages;
        let text: string = messages[key] || fallback[key] || key;
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(`{{${k}}}`, String(v));
            }
        }
        return text;
    }

    setLocale(locale: string): boolean {
        if (!isLocaleCode(locale)) return false;
        this.currentLocale = locale;
        try {
            localStorage.setItem(STORAGE_KEY, locale);
        } catch {
            // Ignore storage write failures; locale still applies for this session.
        }
        try {
            if (typeof window !== 'undefined') {
                const url = new URL(window.location.href);
                url.searchParams.set('lang', locale);
                window.history.replaceState(null, '', url.toString());
            }
        } catch {
            // Ignore URL update failures; locale state is still applied.
        }
        this.applyDocumentLocale();
        window.dispatchEvent(new CustomEvent('sahifah-locale-changed', {detail: {locale}}));
        return true;
    }

    getLocale(): LocaleCode {
        return this.currentLocale;
    }

    getDirection(locale: LocaleCode = this.currentLocale): TextDirection {
        return LOCALES[locale].dir;
    }

    getAvailableLocales(): Array<{ code: LocaleCode; label: string; dir: TextDirection }> {
        return (Object.keys(LOCALES) as LocaleCode[]).map(code => ({
            code,
            label: LOCALES[code].label,
            dir: LOCALES[code].dir,
        }));
    }
}

export const i18n = new I18nService();
export const t = (key: LocaleKey, params?: Record<string, string | number>) => i18n.t(key, params);
