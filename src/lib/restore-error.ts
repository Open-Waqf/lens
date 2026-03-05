import {ERR_CORRUPTED_VAULT, ERR_INCORRECT_PASSWORD, ERR_UNSUPPORTED_VAULT_VERSION} from './crypto/pbe';
import {t} from './i18n';
import {toUserErrorMessage} from './user-error';

const LEGACY_INCORRECT_PASSWORD = 'Incorrect password';
const LEGACY_CORRUPTED_VAULT = 'Vault file is corrupted or incomplete';
const LEGACY_UNSUPPORTED_VAULT_VERSION = 'Vault file version is not supported.';

export function mapRestoreError(error: unknown): { direct: boolean; message: string } {
    const raw = (error as Error)?.message ?? String(error);

    if (raw === ERR_INCORRECT_PASSWORD || raw === LEGACY_INCORRECT_PASSWORD) {
        return {direct: true, message: t('settings.restore_incorrect_password')};
    }

    if (raw === ERR_CORRUPTED_VAULT || raw === LEGACY_CORRUPTED_VAULT) {
        return {direct: true, message: t('settings.restore_corrupted_file')};
    }

    if (raw === ERR_UNSUPPORTED_VAULT_VERSION || raw === LEGACY_UNSUPPORTED_VAULT_VERSION) {
        return {direct: true, message: t('settings.restore_unsupported_version')};
    }

    if (raw === t('settings.restore_password_required')) {
        return {direct: true, message: raw};
    }

    return {direct: false, message: toUserErrorMessage(error)};
}
