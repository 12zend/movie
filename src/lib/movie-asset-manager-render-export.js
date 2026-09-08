import JSZip from '@turbowarp/jszip';
import WavEncoder from 'wav-encoder';

import {
    MP4_AUDIO_MIME_TYPES,
    MP4_VIDEO_MIME_TYPES,
    RENDERING_FILE_NAME,
    RENDERING_DEFAULT_FRAME_RATE,
    RENDERING_FORMATS,
    RENDERING_MASTER_GAIN,
    RENDERING_MAX_FRAME_RATE,
    WEBM_AUDIO_MIME_TYPES,
    WEBM_VIDEO_MIME_TYPES
} from './movie-asset-manager-constants';
import {
    canvasToBlob,
    clamp,
    now,
    toNumber,
    wait
} from './movie-asset-manager-utils';
import downloadBlob from './download-blob';

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

        // Scale the entire mix linearly from the maximum simultaneous clip volume. Unlike compression or
        // limiting, a constant gain preserves the original tone and dynamics.
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

    async encodeRenderingFrames (frames, framerate, audio, format = 'mp4') {
        if (typeof document === 'undefined' || typeof MediaStream === 'undefined') {
            throw new Error('Rendering export is only available in a browser.');
        }
        const firstFrame = frames[0];
        const [stageWidth, stageHeight] = this.getStageSize();
        const width = Math.max(1, Number(firstFrame.width) || stageWidth);
        const height = Math.max(1, Number(firstFrame.height) || stageHeight);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the rendering export canvas.');

        const drawFrame = frame => {
            context.clearRect(0, 0, width, height);
            context.drawImage(frame, 0, 0, width, height);
        };
        drawFrame(firstFrame);
        if (typeof canvas.captureStream !== 'function') {
            throw new Error('This browser cannot capture rendering frames.');
        }

        // Prefer explicit frame capture so MediaRecorder can never sample the export canvas between clearing it
        // and drawing the completed frame. Fall back to timed capture for browsers without requestFrame().
        let videoStream = canvas.captureStream(0);
        let videoTrack = videoStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('Could not create a video stream for the rendering.');
        const manuallyCaptureFrames = typeof videoTrack.requestFrame === 'function';
        if (!manuallyCaptureFrames) {
            videoTrack.stop();
            videoStream = canvas.captureStream(framerate);
            videoTrack = videoStream.getVideoTracks()[0];
            if (!videoTrack) throw new Error('Could not create a video stream for the rendering.');
        }
        const recordingStream = new MediaStream();
        recordingStream.addTrack(videoTrack);

        const audioSources = [];
        let audioDestination = null;
        let audioMasterNodes = [];
        if (audio) {
            if (!audio.context || typeof audio.context.createMediaStreamDestination !== 'function') {
                throw new Error('This browser cannot add audio to the rendering.');
            }
            audioDestination = audio.context.createMediaStreamDestination();
            const audioMaster = this.createRenderingAudioMaster(audio.context, audioDestination, audio.clips);
            audioMasterNodes = audioMaster.nodes;
            for (const clip of audio.clips) {
                const source = audio.context.createBufferSource();
                const nodes = [source];
                source.buffer = clip.buffer;
                source.playbackRate.value = clip.playbackRate;
                let output = source;
                if (typeof audio.context.createStereoPanner === 'function') {
                    const panNode = audio.context.createStereoPanner();
                    panNode.pan.value = clip.pan;
                    output.connect(panNode);
                    output = panNode;
                    nodes.push(panNode);
                }
                if (typeof audio.context.createGain === 'function') {
                    const gainNode = audio.context.createGain();
                    gainNode.gain.value = clip.volume;
                    output.connect(gainNode);
                    output = gainNode;
                    nodes.push(gainNode);
                }
                output.connect(audioMaster.input);
                audioSources.push({
                    duration: clip.duration,
                    nodes,
                    offset: clip.offset,
                    source,
                    startTime: clip.startTime
                });
            }
            const audioTrack = audioDestination.stream.getAudioTracks()[0];
            if (!audioTrack) throw new Error('Could not create an audio stream for the rendering.');
            recordingStream.addTrack(audioTrack);
        }

        const mimeType = this.getRenderingVideoMimeType(format, Boolean(audio));
        const recorder = new MediaRecorder(recordingStream, {mimeType});
        const chunks = [];
        let recordingError = null;
        let finished = false;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            for (const audioSource of audioSources) {
                try {
                    audioSource.source.stop();
                } catch (error) {
                    // The source may not have started if recording setup failed.
                }
                audioSource.nodes.forEach(node => {
                    if (typeof node.disconnect === 'function') node.disconnect();
                });
            }
            audioMasterNodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
            if (audioDestination && typeof audioDestination.disconnect === 'function') {
                audioDestination.disconnect();
            }
            recordingStream.getTracks().forEach(track => track.stop());
            if (audio && audio.ownsContext && audio.context && typeof audio.context.close === 'function') {
                const closePromise = audio.context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
        };

        let resolveRecording;
        let rejectRecording;
        const recordingPromise = new Promise((resolve, reject) => {
            resolveRecording = resolve;
            rejectRecording = reject;
        });
        const finishRecording = error => {
            if (finished) return;
            cleanup();
            if (error) {
                rejectRecording(error);
            } else {
                resolveRecording(new Blob(chunks, {type: mimeType}));
            }
        };
        const failRecording = error => {
            recordingError = error instanceof Error ? error : new Error(String(error));
            if (recorder.state === 'inactive') {
                finishRecording(recordingError);
                return;
            }
            try {
                recorder.stop();
            } catch (stopError) {
                finishRecording(recordingError);
            }
        };

        recorder.ondataavailable = event => {
            if (event.data && event.data.size !== 0) chunks.push(event.data);
        };
        recorder.onerror = event => failRecording(
            (event && event.error) || new Error('The MP4 renderer encountered an error.')
        );
        recorder.onstop = () => finishRecording(recordingError);

        try {
            if (audio && audio.context && typeof audio.context.resume === 'function') {
                await audio.context.resume();
            }
            recorder.start();
            const audioStartTime = audio && audio.context ? audio.context.currentTime : 0;
            for (const audioSource of audioSources) {
                const scheduledStart = audioStartTime + audioSource.startTime;
                audioSource.source.start(scheduledStart, audioSource.offset);
                if (Number.isFinite(Number(audioSource.duration))) {
                    audioSource.source.stop(scheduledStart + Math.max(0, Number(audioSource.duration)));
                }
            }

            const frameDuration = 1000 / framerate;
            const startTime = now();
            if (manuallyCaptureFrames) videoTrack.requestFrame();
            for (let index = 1; index < frames.length; index++) {
                await wait(Math.max(0, startTime + (index * frameDuration) - now()));
                drawFrame(frames[index]);
                if (manuallyCaptureFrames) videoTrack.requestFrame();
            }
            await wait(Math.max(0, startTime + (frames.length * frameDuration) - now()));
            if (recorder.state !== 'inactive') recorder.stop();
        } catch (error) {
            failRecording(error);
        }

        return recordingPromise;
    },

    async exportRenderingVideo (target, requestedSound, requestedFramerate, requestedFormat = 'mp4') {
        const frames = Array.isArray(this.renderingFrames) ? this.renderingFrames.slice() : [];
        if (frames.length === 0) {
            throw new Error('Add at least one rendering frame before exporting.');
        }

        const framerate = this.normalizeRenderingFramerate(requestedFramerate);
        const format = this.normalizeRenderingFormat(requestedFormat) === 'webm' ? 'webm' : 'mp4';
        const audio = await this.decodeRenderingAudio(target, requestedSound, framerate);
        const blob = await this.encodeRenderingFrames(frames, framerate, audio, format);
        const filename = format === 'webm' ? 'rendering.webm' : RENDERING_FILE_NAME;
        downloadBlob(filename, blob);
        this.emit('renderingExported', {
            blob,
            errors: (this.renderingFrameErrors || []).slice(),
            format,
            framerate,
            frameCount: frames.length,
            sound: requestedSound || '',
            soundCount: audio ? audio.clips.length : 0
        });
        return blob;
    },

    exportRenderingMp4 (target, requestedSound, requestedFramerate) {
        return this.exportRenderingVideo(target, requestedSound, requestedFramerate, 'mp4');
    },

    async exportRenderingPngSequence () {
        const frames = Array.isArray(this.renderingFrames) ? this.renderingFrames.slice() : [];
        if (!frames.length) throw new Error('Add at least one rendering frame before exporting.');
        const frameNumbers = Array.isArray(this.renderingFrameNumbers) ? this.renderingFrameNumbers : [];
        const zip = new JSZip();
        const digits = Math.max(4, String(Math.max(...frameNumbers, frames.length - 1)).length);
        for (let index = 0; index < frames.length; index++) {
            const frameNumber = Number.isFinite(Number(frameNumbers[index])) ? Number(frameNumbers[index]) : index;
            const blob = await canvasToBlob(frames[index]);
            zip.file(`frame-${String(frameNumber).padStart(digits, '0')}.png`, blob);
        }
        if (this.renderingFrameErrors && this.renderingFrameErrors.length) {
            zip.file('render-errors.json', JSON.stringify(this.renderingFrameErrors, null, 2));
        }
        const blob = await zip.generateAsync({compression: 'DEFLATE', type: 'blob'});
        downloadBlob('rendering-png.zip', blob);
        this.emit('renderingExported', {
            blob,
            errors: (this.renderingFrameErrors || []).slice(),
            format: 'png-sequence',
            frameCount: frames.length
        });
        return blob;
    },

    async exportRenderingFramePng (requestedIndex) {
        const frames = Array.isArray(this.renderingFrames) ? this.renderingFrames : [];
        if (!frames.length) throw new Error('Add at least one rendering frame before exporting.');
        const numericIndex = Number(requestedIndex);
        const index = Number.isFinite(numericIndex) ?
            clamp(Math.round(numericIndex), 0, frames.length - 1) : frames.length - 1;
        const blob = await canvasToBlob(frames[index]);
        const frameNumbers = Array.isArray(this.renderingFrameNumbers) ? this.renderingFrameNumbers : [];
        const frameNumber = Number.isFinite(Number(frameNumbers[index])) ? frameNumbers[index] : index;
        downloadBlob(`rendering-frame-${String(frameNumber).padStart(4, '0')}.png`, blob);
        this.emit('renderingExported', {blob, format: 'png-frame', frameCount: 1, frameNumber});
        return blob;
    },

    async encodeRenderingAudioWav (audio, duration) {
        if (!audio || !Array.isArray(audio.clips) || !audio.clips.length) {
            throw new Error('Add a timeline audio event or select a rendering sound before exporting audio.');
        }
        const sampleRate = Math.max(8000, ...audio.clips.map(clip => (
            toNumber(clip.buffer && clip.buffer.sampleRate, 48000)
        )));
        const frameCount = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
        const left = new Float32Array(frameCount);
        const right = new Float32Array(frameCount);
        const masterGain = this.getRenderingAudioMasterGain(audio.clips);
        for (const clip of audio.clips) {
            const buffer = clip.buffer;
            if (!buffer || typeof buffer.getChannelData !== 'function') continue;
            const sourceRate = toNumber(buffer.sampleRate, sampleRate);
            const sourceLeft = buffer.getChannelData(0);
            const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
            const startFrame = Math.max(0, Math.round(toNumber(clip.startTime) * sampleRate));
            const playbackRate = Math.max(Number.EPSILON, toNumber(clip.playbackRate, 1));
            const sourceOffset = Math.max(0, toNumber(clip.offset) * sourceRate);
            const requestedDuration = Number(clip.duration);
            const naturalDuration = Math.max(0, (sourceLeft.length - sourceOffset) / sourceRate / playbackRate);
            const clipDuration = Number.isFinite(requestedDuration) ?
                Math.min(naturalDuration, Math.max(0, requestedDuration)) : naturalDuration;
            const outputFrames = Math.min(frameCount - startFrame, Math.ceil(clipDuration * sampleRate));
            const pan = clamp(toNumber(clip.pan), -1, 1);
            const volume = clamp(toNumber(clip.volume, 1), 0, 1) * masterGain;
            const leftGain = volume * (pan > 0 ? 1 - pan : 1);
            const rightGain = volume * (pan < 0 ? 1 + pan : 1);
            for (let outputIndex = 0; outputIndex < outputFrames; outputIndex++) {
                const sourcePosition = sourceOffset + ((outputIndex / sampleRate) * sourceRate * playbackRate);
                const firstIndex = Math.floor(sourcePosition);
                if (firstIndex >= sourceLeft.length) break;
                const secondIndex = Math.min(sourceLeft.length - 1, firstIndex + 1);
                const progress = sourcePosition - firstIndex;
                const leftSample = sourceLeft[firstIndex] +
                    ((sourceLeft[secondIndex] - sourceLeft[firstIndex]) * progress);
                const rightSample = sourceRight[firstIndex] +
                    ((sourceRight[secondIndex] - sourceRight[firstIndex]) * progress);
                left[startFrame + outputIndex] += leftSample * leftGain;
                right[startFrame + outputIndex] += rightSample * rightGain;
            }
        }
        const buffer = await WavEncoder.encode({channelData: [left, right], sampleRate});
        return new Blob([buffer], {type: 'audio/wav'});
    },

    async exportRenderingAudioWav (target, requestedSound, requestedFramerate) {
        const framerate = this.normalizeRenderingFramerate(requestedFramerate);
        const audio = await this.decodeRenderingAudio(target, requestedSound, framerate);
        const duration = this.renderingFrames.length / framerate;
        const blob = await this.encodeRenderingAudioWav(audio, duration);
        downloadBlob('rendering-audio.wav', blob);
        this.emit('renderingExported', {blob, format: 'audio-wav'});
        return blob;
    }
};

export default MovieAssetManagerRenderExportMethods;
