import type {FilterMode} from '../../domain/types';

export type ScanQualityPreset = 'archive' | 'share' | 'original';
export type ScanQualityAction = 'save' | 'share';

export type ScanQualityPlan = {
    masterWidth: number;
    masterHeight: number;
    masterJpegQuality: number;
    thumbMax: number;
    thumbJpegQuality: number;
    sharpenAmount: number;
};

type PresetPolicy = {
    minDim?: number;
    maxDim: number;
    masterJpegQuality: number;
    thumbMax: number;
    thumbJpegQuality: number;
    baseSharpen: number;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function scaleToBounds(rawWidth: number, rawHeight: number, policy: PresetPolicy): { width: number; height: number } {
    const largest = Math.max(rawWidth, rawHeight);
    let scale = 1;

    if (policy.minDim && largest < policy.minDim) scale = policy.minDim / largest;
    if (largest * scale > policy.maxDim) scale = policy.maxDim / largest;

    return {
        width: Math.max(1, Math.round(rawWidth * scale)),
        height: Math.max(1, Math.round(rawHeight * scale)),
    };
}

function getPresetPolicy(preset: ScanQualityPreset, action: ScanQualityAction): PresetPolicy {
    if (preset === 'archive') {
        return {
            minDim: 1800,
            maxDim: 2800,
            masterJpegQuality: action === 'share' ? 0.9 : 0.95,
            thumbMax: 900,
            thumbJpegQuality: 0.82,
            baseSharpen: 0.42,
        };
    }
    if (preset === 'original') {
        return {
            maxDim: 2500,
            masterJpegQuality: 0.92,
            thumbMax: 800,
            thumbJpegQuality: 0.82,
            baseSharpen: 0,
        };
    }
    return {
        minDim: 1200,
        maxDim: 2000,
        masterJpegQuality: action === 'share' ? 0.84 : 0.87,
        thumbMax: 720,
        thumbJpegQuality: 0.76,
        baseSharpen: 0.26,
    };
}

function computeAdaptiveSharpen(base: number, filter: FilterMode, largestDim: number): number {
    if (base <= 0) return 0;
    let amount = base;
    if (filter === 'magic') amount -= 0.12;
    if (filter === 'bw' || filter === 'whiteboard') amount += 0.05;
    if (largestDim > 2200) amount -= 0.07;
    return clamp(amount, 0, 0.6);
}

export function resolveScanQualityPlan(input: {
    action: ScanQualityAction;
    preset: ScanQualityPreset;
    filter: FilterMode;
    rawWidth: number;
    rawHeight: number;
}): ScanQualityPlan {
    const policy = getPresetPolicy(input.preset, input.action);
    const largestDim = Math.max(input.rawWidth, input.rawHeight);
    const scaled = scaleToBounds(input.rawWidth, input.rawHeight, policy);
    return {
        masterWidth: scaled.width,
        masterHeight: scaled.height,
        masterJpegQuality: policy.masterJpegQuality,
        thumbMax: policy.thumbMax,
        thumbJpegQuality: policy.thumbJpegQuality,
        sharpenAmount: computeAdaptiveSharpen(policy.baseSharpen, input.filter, largestDim),
    };
}
