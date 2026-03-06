import {t} from './i18n';

export function toUserErrorMessage(error: unknown): string {
    const message = (error as Error)?.message ?? String(error);

    if (isOpfsSecurityError(error, message)) {
        return t('errors.opfs_security');
    }
    if (isCameraPermissionError(error, message)) {
        return t('errors.camera_permission');
    }
    if (isCameraUnavailableError(error, message)) {
        return t('errors.camera_unavailable');
    }
    if (isCameraBusyError(error, message)) {
        return t('errors.camera_busy');
    }
    if (isCameraConstraintError(error, message)) {
        return t('errors.camera_constraints');
    }
    if (isNativeFileAccessError(message)) {
        return t('errors.native_file_access');
    }

    return message;
}

function isOpfsSecurityError(error: unknown, message: string): boolean {
    if (error instanceof DOMException && error.name === 'SecurityError') {
        return true;
    }

    return message.includes('Failed to access OPFS') && message.includes('GetDirectory');
}

function isCameraPermissionError(error: unknown, message: string): boolean {
    const msg = message.toLowerCase();
    if (error instanceof DOMException && error.name === 'NotAllowedError') return true;
    return msg.includes('not allowed by the user agent')
        || msg.includes('permission denied')
        || msg.includes('permission dismissed')
        || msg.includes('permission to use camera');
}

function isCameraUnavailableError(error: unknown, message: string): boolean {
    const msg = message.toLowerCase();
    if (error instanceof DOMException && error.name === 'NotFoundError') return true;
    return msg.includes('requested device not found')
        || msg.includes('no media tracks')
        || msg.includes('no camera');
}

function isCameraBusyError(error: unknown, message: string): boolean {
    const msg = message.toLowerCase();
    if (error instanceof DOMException && error.name === 'NotReadableError') return true;
    return msg.includes('could not start video source')
        || msg.includes('device is already in use')
        || msg.includes('track start failed');
}

function isCameraConstraintError(error: unknown, message: string): boolean {
    const msg = message.toLowerCase();
    return (error instanceof DOMException && error.name === 'OverconstrainedError')
        || msg.includes('overconstrained')
        || msg.includes('constraint');
}

function isNativeFileAccessError(message: string): boolean {
    const msg = message.toLowerCase();
    return (msg.includes('content://') && msg.includes('violates the following content security policy directive'))
        || (msg.includes('refused to connect') && msg.includes('content://'))
        || (msg.includes('fetch api cannot load content://'))
        || msg.includes('unable to open asset url');
}
