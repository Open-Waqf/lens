import {t} from './i18n';

export function toUserErrorMessage(error: unknown): string {
    const message = (error as Error)?.message ?? String(error);

    if (isOpfsSecurityError(error, message)) {
        return t('errors.opfs_security');
    }

    return message;
}

function isOpfsSecurityError(error: unknown, message: string): boolean {
    if (error instanceof DOMException && error.name === 'SecurityError') {
        return true;
    }

    return message.includes('Failed to access OPFS') && message.includes('GetDirectory');
}

