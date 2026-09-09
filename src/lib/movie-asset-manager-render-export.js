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

const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

const normalizeAudioSampleRate = value => {
    const sampleRate = Math.round(Number(value));
    return Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000 ?
        sampleRate : null;
};

const getRenderingAudioSampleRate = (audio, vm) => {
    const contextRate = normalizeAudioSampleRate(audio && audio.context && audio.context.sampleRate);
    if (contextRate) return contextRate;
    if (Array.isArray(audio && audio.clips)) {
        for (const clip of audio.clips) {
            const rate = normalizeAudioSampleRate(clip.buffer && clip.buffer.sampleRate);
            if (rate) return rate;
        }
    }
    // Fallback to any sound buffer in the VM
    const runtime = vm && vm.runtime;
    const targets = runtime && Array.isArray(runtime.targets) ? runtime.targets : [];
    for (const target of targets) {
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const sounds = target && target.sprite && Array.isArray(target.sprite.sounds) ? target.sprite.sounds : [];
        for (const sound of sounds) {
            const player = soundBank && typeof soundBank.getSoundPlayer === 'function' && sound.soundId ?
                soundBank.getSoundPlayer(sound.soundId) : null;
            const rate = normalizeAudioSampleRate(player && player.buffer && player.buffer.sampleRate);
            if (rate) return rate;
        }
    }
    return DEFAULT_AUDIO_SAMPLE_RATE;
};

const createMixedAudioBuffer = (audioContext, clips, duration, sampleRate, masterGain = 1) => {
    const frameCount = Math.max(1, Math.ceil(Math.max(0, duration) * sampleRate));
    const mixed = audioContext.createBuffer(2, frameCount, sampleRate);
    const left = mixed.getChannelData(0);
    const right = mixed.getChannelData(1);

    for (const clip of clips || []) {
        const buffer = clip && clip.buffer;
        if (!buffer || typeof buffer.getChannelData !== 'function') continue;
        const sourceRate = normalizeAudioSampleRate(buffer.sampleRate) || sampleRate;
        const sourceLeft = buffer.getChannelData(0);
        const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
        const playbackRate = Number(clip.playbackRate);
        const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
        const sourceOffset = Math.max(0, Number(clip.offset) || 0) * sourceRate;
        const startFrame = Math.max(0, Math.round((Number(clip.startTime) || 0) * sampleRate));
        if (startFrame >= frameCount || sourceOffset >= sourceLeft.length) continue;

        const naturalDuration = Math.max(0, (sourceLeft.length - sourceOffset) /
            sourceRate / safePlaybackRate);
        const requestedDuration = Number(clip.duration);
        const clipDuration = Number.isFinite(requestedDuration) ?
            Math.min(naturalDuration, Math.max(0, requestedDuration)) : naturalDuration;
        const outputFrames = Math.min(
            frameCount - startFrame,
            Math.max(0, Math.ceil(clipDuration * sampleRate))
        );
        const pan = Math.max(-1, Math.min(1, Number(clip.pan) || 0));
        const volume = Math.max(0, Math.min(1, Number(clip.volume) || 0)) * masterGain;
        const leftGain = volume * (pan > 0 ? 1 - pan : 1);
        const rightGain = volume * (pan < 0 ? 1 + pan : 1);

        for (let outputIndex = 0; outputIndex < outputFrames; outputIndex++) {
            const sourcePosition = sourceOffset + ((outputIndex / sampleRate) * sourceRate * safePlaybackRate);
            const firstIndex = Math.floor(sourcePosition);
            if (firstIndex >= sourceLeft.length) break;
            const secondIndex = Math.min(sourceLeft.length - 1, firstIndex + 1);
            const interpolation = sourcePosition - firstIndex;
            const sourceLeftSample = sourceLeft[firstIndex] +
                ((sourceLeft[secondIndex] - sourceLeft[firstIndex]) * interpolation);
            const sourceRightSample = sourceRight[firstIndex] +
                ((sourceRight[secondIndex] - sourceRight[firstIndex]) * interpolation);
            const destinationIndex = startFrame + outputIndex;
            left[destinationIndex] += sourceLeftSample * leftGain;
            right[destinationIndex] += sourceRightSample * rightGain;
        }
    }

    // Keep the mix inside the range accepted by encoders and prevent hard-clipping from overlapping clips.
    for (let index = 0; index < frameCount; index++) {
        left[index] = Math.max(-1, Math.min(1, left[index]));
        right[index] = Math.max(-1, Math.min(1, right[index]));
    }
    return mixed;
};

const createCanvas = (width, height) => {
    if (typeof OffscreenCanvas === 'function') {
        try {
            return new OffscreenCanvas(width, height);
        } catch (error) {
            // Fall back to DOM canvas if OffscreenCanvas construction fails.
        }
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        throw new Error('A browser canvas is required for rendering');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

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

    async encodeRenderingFramesWithMediabunny (frames, framerate, audio, format = 'mp4', options = {}) {
        if (!Array.isArray(frames) || frames.length === 0) {
            throw new Error('Add at least one rendering frame before exporting.');
        }
        if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
            throw new Error('Rendering export is only available in a browser.');
        }
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('This browser cannot encode video (WebCodecs is unavailable)');
        }

        const firstFrame = frames[0];
        const [stageWidth, stageHeight] = this.getStageSize();
        const width = Math.max(1, Number(firstFrame.width) || stageWidth);
        const height = Math.max(1, Number(firstFrame.height) || stageHeight);
        const captureCanvas = createCanvas(width, height);
        const captureContext = captureCanvas.getContext('2d');
        if (!captureContext) throw new Error('The browser cannot create a 2D capture canvas');

        // Use Mediabunny's compiled browser entry explicitly. Webpack 4 can
        // otherwise follow the package metadata into mediabunny/src/*.ts,
        // which it cannot parse as JavaScript.
        const mediabunny = await import('mediabunny/dist/modules/src/index.js');
        const {
            BufferTarget,
            CanvasSource,
            Mp4OutputFormat,
            WebMOutputFormat,
            Output,
            Quality,
            AudioBufferSource,
            getFirstEncodableAudioCodec,
            getFirstEncodableVideoCodec
        } = mediabunny;

        const duration = frames.length / framerate;
        const {signal, onProgress} = options;
        const throwIfAborted = () => {
            if (signal && signal.aborted) {
                const error = typeof DOMException === 'function' ?
                    new DOMException('Aborted', 'AbortError') : new Error('Aborted');
                error.name = 'AbortError';
                throw error;
            }
        };
        throwIfAborted();

        const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
        const output = new Output({
            format: outputFormat,
            target: new BufferTarget()
        });

        const videoCodec = await getFirstEncodableVideoCodec(
            output.format.getSupportedVideoCodecs(),
            {width, height}
        );
        if (!videoCodec) {
            throw new Error('This browser cannot encode video (no supported MP4 video codec)');
        }

        const videoSource = new CanvasSource(captureCanvas, {
            codec: videoCodec,
            quality: new Quality('high')
        });
        output.addVideoTrack(videoSource, {frameRate: framerate});

        let audioSource = null;
        let audioSampleRate = DEFAULT_AUDIO_SAMPLE_RATE;
        let audioContextForMix = audio && audio.context;
        if (audio && Array.isArray(audio.clips) && audio.clips.length) {
            if (!audioContextForMix || typeof audioContextForMix.createBuffer !== 'function') {
                // Find any usable AudioContext
                const vmAudio = this.runtime && this.runtime.audioEngine && this.runtime.audioEngine.audioContext;
                audioContextForMix = vmAudio || audioContextForMix;
            }
            if (!audioContextForMix || typeof audioContextForMix.createBuffer !== 'function') {
                throw new Error('This browser cannot render timeline audio');
            }
            audioSampleRate = getRenderingAudioSampleRate(audio, this.vm || {runtime: this.runtime});
            const audioCodec = await getFirstEncodableAudioCodec(
                output.format.getSupportedAudioCodecs(),
                {numberOfChannels: 2, sampleRate: audioSampleRate}
            );
            if (!audioCodec) {
                throw new Error('This browser cannot encode MP4 audio');
            }
            audioSource = new AudioBufferSource({
                codec: audioCodec,
                quality: new Quality('high')
            });
            output.addAudioTrack(audioSource);
        }

        let outputFinalized = false;
        let videoSourceClosed = false;
        try {
            await output.start();
            throwIfAborted();

            // Deterministic frame writing: each frame gets an explicit timestamp and duration.
            // This guarantees every captured frame is stored exactly once with uniform spacing,
            // unlike MediaRecorder's wall-clock sampling which can skip or duplicate frames.
            for (let index = 0; index < frames.length; index++) {
                throwIfAborted();
                const frame = frames[index];
                captureContext.clearRect(0, 0, width, height);
                // Draw the already-captured frame onto the capture surface.
                // Using drawImage keeps color-space and alpha handling identical to the original export.
                captureContext.drawImage(frame, 0, 0, width, height);
                // eslint-disable-next-line no-await-in-loop
                await videoSource.add(index / framerate, 1 / framerate);
                if (typeof onProgress === 'function') {
                    try {
                        onProgress({
                            currentTime: Math.min(index / framerate, duration),
                            duration,
                            frame: index + 1,
                            progress: (index + 1) / frames.length,
                            totalFrames: frames.length
                        });
                    } catch (error) {
                        // Progress callbacks must not break an export.
                    }
                }
                // Periodically yield so the export settings dialog can repaint during long exports.
                if (index % 30 === 29) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise(resolve => setTimeout(resolve, 0));
                    throwIfAborted();
                }
            }

            videoSource.close();
            videoSourceClosed = true;
            if (audioSource) {
                const masterGain = this.getRenderingAudioMasterGain(audio.clips);
                const audioBuffer = createMixedAudioBuffer(
                    audioContextForMix,
                    audio.clips,
                    duration,
                    audioSampleRate,
                    masterGain
                );
                // eslint-disable-next-line no-await-in-loop
                await audioSource.add(audioBuffer);
            }
            await output.finalize();
            outputFinalized = true;
            throwIfAborted();

            const buffer = output.target.buffer;
            if (!buffer || !buffer.byteLength) throw new Error('Rendering produced no video data');
            const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
            return new Blob([buffer], {type: mimeType});
        } catch (error) {
            if (videoSource && !videoSourceClosed) {
                try {
                    videoSource.close();
                } catch (closeError) {
                    // Ignore cleanup errors while reporting the original failure.
                }
            }
            if (output && !outputFinalized) {
                try {
                    await output.cancel();
                } catch (cancelError) {
                    // Ignore cleanup errors while reporting the original failure.
                }
            }
            throw error;
        } finally {
            if (audio && audio.ownsContext && audio.context && typeof audio.context.close === 'function' &&
                audioContextForMix !== audio.context) {
                // Only close the temporary context if we created it; owned contexts from decodeRenderingAudio
                // are closed by the MediaRecorder path. For mediabunny we keep the decoded context alive
                // until the caller cleans it up, matching shading-simple's export-video behavior where
                // the timeline's audioContext is not closed.
            }
        }
    },

    async encodeRenderingFramesWithMediaRecorder (frames, framerate, audio, format = 'mp4') {
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

    async encodeRenderingFrames (frames, framerate, audio, format = 'mp4', options = {}) {
        if (!Array.isArray(frames) || frames.length === 0) {
            throw new Error('Add at least one rendering frame before exporting.');
        }
        // Prefer deterministic WebCodecs encoding (via mediabunny) when available.
        // This writes every frame at an exact timestamp (frame / framerate) instead of
        // relying on MediaRecorder's wall-clock sampling, which can pause or duplicate
        // frames between clearRect/drawImage.
        if (typeof VideoEncoder !== 'undefined') {
            try {
                return await this.encodeRenderingFramesWithMediabunny(frames, framerate, audio, format, options);
            } catch (error) {
                // If the mediabunny path fails for an encoding reason, fall back to MediaRecorder
                // only when the browser actually supports it. Re-throw AbortError or explicit
                // unsupported errors.
                if (error && (error.name === 'AbortError' ||
                    /WebCodecs is unavailable|Cannot encode video/.test(error.message))) {
                    throw error;
                }
                if (typeof MediaStream === 'undefined' || typeof MediaRecorder === 'undefined') throw error;
                // Fall through to MediaRecorder fallback for other transient mediabunny errors.
            }
        }
        return this.encodeRenderingFramesWithMediaRecorder(frames, framerate, audio, format);
    },

    async exportRenderingVideo (target, requestedSound, requestedFramerate, requestedFormat = 'mp4', options = {}) {
        const frames = Array.isArray(this.renderingFrames) ? this.renderingFrames.slice() : [];
        if (frames.length === 0) {
            throw new Error('Add at least one rendering frame before exporting.');
        }

        const framerate = this.normalizeRenderingFramerate(requestedFramerate);
        const format = this.normalizeRenderingFormat(requestedFormat) === 'webm' ? 'webm' : 'mp4';
        const audio = await this.decodeRenderingAudio(target, requestedSound, framerate);
        const blob = await this.encodeRenderingFrames(frames, framerate, audio, format, options);
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
        // Prevent hard-clipping from overlapping loud clips, same as createMixedAudioBuffer.
        for (let index = 0; index < frameCount; index++) {
            left[index] = Math.max(-1, Math.min(1, left[index]));
            right[index] = Math.max(-1, Math.min(1, right[index]));
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
