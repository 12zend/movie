import {
    MP4_AUDIO_MIME_TYPES,
    MP4_VIDEO_MIME_TYPES,
    RENDERING_DEFAULT_FRAME_RATE,
    RENDERING_FORMATS,
    RENDERING_MASTER_GAIN,
    RENDERING_MAX_FRAME_RATE,
    WEBM_AUDIO_MIME_TYPES,
    WEBM_VIDEO_MIME_TYPES
} from './movie-asset-manager-constants';
import {
    clamp,
    toNumber
} from './movie-asset-manager-utils';

// Rendering export system is disabled - UI is preserved for future restoration.
// This stub keeps helpers (used by timeline settings and audio mixing tests) but
// disables actual export/encoding paths. Restore via git to re-enable.

const RENDERING_EXPORT_DISABLED_MESSAGE =
    'Rendering export is disabled (UI preserved). ' +
    'Restore src/lib/movie-asset-manager-render-export.js to re-enable.';

const MovieAssetManagerRenderExportMethods = {
    normalizeRenderingFramerate (value) {
        const framerate = Number(value);
        if (!Number.isFinite(framerate) || framerate <= 0) return RENDERING_DEFAULT_FRAME_RATE;
        return Math.min(RENDERING_MAX_FRAME_RATE, Math.max(1, framerate));
    },

    normalizeRenderingFormat (value) {
        const format = String(value || '').toLowerCase();
        return RENDERING_FORMATS.includes(format) ? format : 'mp4';
    },

    getRenderingVideoMimeType (format, includeAudio) {
        if (typeof MediaRecorder === 'undefined') {
            throw new Error('This browser does not support video rendering.');
        }
        const normalizedFormat = this.normalizeRenderingFormat(format);
        const candidates = normalizedFormat === 'webm' ?
            (includeAudio ? WEBM_AUDIO_MIME_TYPES : WEBM_VIDEO_MIME_TYPES) :
            (includeAudio ? MP4_AUDIO_MIME_TYPES : MP4_VIDEO_MIME_TYPES);
        if (typeof MediaRecorder.isTypeSupported !== 'function') return candidates[candidates.length - 1];
        for (const candidate of candidates) {
            try {
                if (MediaRecorder.isTypeSupported(candidate)) return candidate;
            } catch (error) {
                // Some browsers throw when they see a codec they do not recognize.
            }
        }
        throw new Error(`This browser cannot encode ${normalizedFormat.toUpperCase()} with MediaRecorder.`);
    },

    getRenderingMp4MimeType (includeAudio) {
        return this.getRenderingVideoMimeType('mp4', includeAudio);
    },

    getRenderingAudioMasterGain (clips) {
        if (!Array.isArray(clips) || clips.length === 0) return 1;
        const events = [];
        for (const clip of clips) {
            const start = Math.max(0, toNumber(clip.startTime));
            const offset = Math.max(0, toNumber(clip.offset));
            const playbackRate = Math.max(Number.EPSILON, toNumber(clip.playbackRate, 1));
            const bufferDuration = clip.buffer && Number(clip.buffer.duration);
            const naturalDuration = Number.isFinite(bufferDuration) ?
                Math.max(0, (bufferDuration - offset) / playbackRate) : Infinity;
            const requestedDuration = Number(clip.duration);
            const duration = Number.isFinite(requestedDuration) ?
                Math.min(naturalDuration, Math.max(0, requestedDuration)) : naturalDuration;
            const volume = clamp(toNumber(clip.volume, 1), 0, 1);
            if (duration <= 0 || volume <= 0) continue;
            events.push({change: volume, time: start});
            events.push({change: -volume, time: start + duration});
        }
        events.sort((a, b) => (a.time - b.time) || (a.change - b.change));

        let currentVolume = 0;
        let maximumVolume = 0;
        for (const event of events) {
            currentVolume += event.change;
            maximumVolume = Math.max(maximumVolume, currentVolume);
        }
        return maximumVolume > 1 ? RENDERING_MASTER_GAIN / maximumVolume : 1;
    },

    createRenderingAudioMaster (audioContext, destination, clips) {
        const nodes = [];
        let input = destination;

        // Scale the entire mix linearly from the maximum simultaneous clip volume.
        const masterGain = this.getRenderingAudioMasterGain(clips);
        if (masterGain < 1 && typeof audioContext.createGain === 'function') {
            const gain = audioContext.createGain();
            gain.gain.value = masterGain;
            gain.connect(destination);
            input = gain;
            nodes.push(gain);
        }

        return {input, nodes};
    },

    // eslint-disable-next-line require-await
    async encodeRenderingFrames () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    },

    // eslint-disable-next-line require-await
    async exportRenderingVideo () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    },

    exportRenderingMp4 () {
        return Promise.reject(new Error(RENDERING_EXPORT_DISABLED_MESSAGE));
    },

    // eslint-disable-next-line require-await
    async exportRenderingPngSequence () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    },

    // eslint-disable-next-line require-await
    async exportRenderingFramePng () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    },

    // eslint-disable-next-line require-await
    async encodeRenderingAudioWav () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    },

    // eslint-disable-next-line require-await
    async exportRenderingAudioWav () {
        throw new Error(RENDERING_EXPORT_DISABLED_MESSAGE);
    }
};

export default MovieAssetManagerRenderExportMethods;
