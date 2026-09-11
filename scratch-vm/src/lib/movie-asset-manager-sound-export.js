import {
    RENDERING_DEFAULT_FRAME_RATE
} from './movie-asset-manager-constants';
import {
    clamp,
    copyArrayBuffer,
    toNumber
} from './movie-asset-manager-utils';

const MovieAssetManagerSoundExportMethods = {
    renderAndExportTimeline (options = {}) {
        let cancelled = false;
        let renderErrorEmitted = false;
        const rendering = new Promise((resolve, reject) => {
            const cleanup = () => {
                // eslint-disable-next-line no-use-before-define
                this.removeListener('timelineRenderComplete', handleComplete);
                // eslint-disable-next-line no-use-before-define
                this.removeListener('timelineRenderCancelled', handleCancelled);
                // eslint-disable-next-line no-use-before-define
                this.removeListener('renderError', handleRenderError);
            };
            const handleComplete = () => {
                cleanup();
                resolve();
            };
            const handleCancelled = () => {
                cancelled = true;
                cleanup();
                reject(new Error('Rendering was stopped before the MP4 export completed.'));
            };
            const handleRenderError = error => {
                renderErrorEmitted = true;
                cleanup();
                reject(error);
            };

            this.once('timelineRenderComplete', handleComplete);
            this.once('timelineRenderCancelled', handleCancelled);
            this.once('renderError', handleRenderError);
            try {
                this.renderTimeline(options);
            } catch (error) {
                this.restorePreviewRendererSize();
                cleanup();
                reject(error);
            }
        });

        return rendering
            .then(() => this.exportTimeline(options))
            .catch(error => {
                if (!cancelled && !renderErrorEmitted) this.emit('renderError', error);
                throw error;
            });
    },

    getRenderFrameSounds () {
        const selections = [];
        const seen = new Set();
        for (const target of this.runtime.targets) {
            if (!target || !target.isOriginal || !target.blocks || !target.sprite) continue;
            const scriptIds = typeof target.blocks.getScripts === 'function' ? target.blocks.getScripts() : [];
            for (const scriptId of scriptIds) {
                const block = typeof target.blocks.getBlock === 'function' ? target.blocks.getBlock(scriptId) : null;
                if (!block || block.opcode !== 'event_renderframe') continue;
                const field = block.fields && block.fields.SOUND_MENU;
                const soundName = Array.isArray(field) ? field[0] :
                    (field && typeof field === 'object' ? field.value : field);
                const sound = this.getRenderingSound(target, soundName);
                if (!sound || !sound.soundId) continue;
                const key = `${target.id}:${sound.soundId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                selections.push({sound, target});
            }
        }
        return selections;
    },

    playSoundAtFrame (args, util) {
        if (!this.timeline.playing || !util || !util.target) return;
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        const requestedFrame = Math.max(0, Math.round(toNumber(args && args.FRAME)));
        const currentFrame = this.timeline.recording ?
            this.timeline.renderFrameIndex :
            Math.round(this.timeline.currentTime * this.timeline.framerate);
        if (currentFrame !== requestedFrame) return;

        const sound = this.getRenderingSound(util.target, args && args.SOUND_MENU);
        if (!sound) return;
        const blockId = util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : `${sound.name}:${requestedFrame}`;
        const key = `${util.target.id}:${blockId}:${requestedFrame}`;
        if (this.playedTimelineSoundBlocks.has(key)) return;
        this.playedTimelineSoundBlocks.add(key);

        if (this.timeline.recording) {
            this.renderingSoundEvents.push({
                dedupeKey: key,
                frame: requestedFrame,
                pan: toNumber(util.target.soundEffects && util.target.soundEffects.pan),
                pitch: toNumber(util.target.soundEffects && util.target.soundEffects.pitch),
                sound,
                target: util.target,
                volume: clamp(toNumber(util.target.volume, 100), 0, 100)
            });
            return;
        }
        const playSound = this.runtime._primitives.sound_play;
        if (typeof playSound === 'function') playSound({SOUND_MENU: sound.name}, util);
    },

    playSoundAtTime (args, util) {
        if (!util || !util.target) return;
        // Projects saved before the ranged sound block used TIME as an offset into the source audio.
        if (!Object.prototype.hasOwnProperty.call(args || {}, 'T1') &&
            !Object.prototype.hasOwnProperty.call(args || {}, 'T2')) {
            this.playLegacySoundAtTime(args, util);
            return;
        }
        this.playRangedSound(args, util);
    },

    playLegacySoundAtTime (args, util) {
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        if (!(this.playedTimelineSoundBlocks instanceof Set)) this.playedTimelineSoundBlocks = new Set();

        const thread = util.thread;
        const blocks = thread && (thread.blockContainer || util.target.blocks);
        const topBlock = blocks && typeof blocks.getBlock === 'function' ? blocks.getBlock(thread.topBlock) : null;
        // Scrubbing a paused timeline evaluates render-frame scripts to refresh the stage. Keep that visual
        // preview silent while still allowing this block to be clicked and auditioned directly.
        if (!this.timeline.playing && !this.timeline.recording && topBlock &&
            topBlock.opcode === 'event_renderframe') return;

        const sound = this.getRenderingSound(util.target, args && args.SOUND_MENU);
        if (!sound) return;
        const requestedTime = Math.max(0, toNumber(args && args.TIME));
        const blockId = util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : `${sound.name}:${requestedTime}`;
        const key = `${util.target.id}:${blockId}`;

        // A render-frame script runs again on every frame. During timeline playback, let each block start once
        // so the sound can continue in real time instead of being restarted on every VM step.
        if (this.timeline.playing) {
            if (this.playedTimelineSoundBlocks.has(key)) return;
            this.playedTimelineSoundBlocks.add(key);
        }

        if (this.timeline.recording) {
            this.renderingSoundEvents.push({
                dedupeKey: key,
                frame: this.timeline.renderFrameIndex,
                offset: requestedTime,
                pan: toNumber(util.target.soundEffects && util.target.soundEffects.pan),
                pitch: toNumber(util.target.soundEffects && util.target.soundEffects.pitch),
                sound,
                target: util.target,
                volume: clamp(toNumber(util.target.volume, 100), 0, 100)
            });
            return;
        }
        this.startSoundAtTime(util.target, sound, requestedTime);
    },

    getTimelineSoundBlockKey (target, sound, util) {
        const blockId = util && util.thread && typeof util.thread.peekStack === 'function' ?
            util.thread.peekStack() : sound.name;
        return `${target.id}:${blockId}`;
    },

    getRangedSoundConfiguration (args) {
        const start = Math.max(0, toNumber(args && args.T1));
        const requestedEnd = Number(args && args.T2);
        const end = Number.isFinite(requestedEnd) ? Math.max(start, requestedEnd) : Number.POSITIVE_INFINITY;
        const requestedSpeed = Number(args && args.SPEED);
        return {
            end,
            speed: Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 1,
            start,
            volume: clamp(toNumber(args && args.VOLUME, 100), 0, 100)
        };
    },

    playRangedSound (args, util) {
        const target = util.target;
        const sound = this.getRenderingSound(target, args && args.SOUND_MENU);
        if (!sound) return;
        const configuration = this.getRangedSoundConfiguration(args);
        const key = this.getTimelineSoundBlockKey(target, sound, util);
        const thread = util.thread;
        const blocks = thread && (thread.blockContainer || target.blocks);
        const topBlock = blocks && typeof blocks.getBlock === 'function' ? blocks.getBlock(thread.topBlock) : null;

        // A paused render-frame evaluation is only a visual scrub. Clicking the block directly still auditions it.
        if (!this.timeline.playing && !this.timeline.recording) {
            if (topBlock && topBlock.opcode === 'event_renderframe') return;
            const duration = Number.isFinite(configuration.end) ? configuration.end - configuration.start : Infinity;
            this.startRangedSoundPlayback(target, sound, {
                ...configuration,
                duration,
                offset: 0
            });
            return;
        }

        const currentTime = toNumber(this.timeline.currentTime);
        const active = currentTime >= configuration.start && currentTime < configuration.end;
        if (!active) {
            this.stopTimelineSoundPlayback(key);
            return;
        }

        const offset = Math.max(0, (currentTime - configuration.start) * configuration.speed);
        const remaining = Number.isFinite(configuration.end) ? configuration.end - currentTime : Infinity;
        if (this.timeline.recording) {
            if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
            const frameDuration = 1 / Math.max(1, toNumber(this.timeline.framerate, RENDERING_DEFAULT_FRAME_RATE));
            this.renderingSoundEvents.push({
                dedupeKey: `${key}:${this.timeline.renderFrameIndex}`,
                duration: Math.min(frameDuration, remaining),
                frame: this.timeline.renderFrameIndex,
                offset,
                pan: 0,
                playbackRate: configuration.speed,
                sound,
                target,
                volume: configuration.volume
            });
            this.stopTimelineSoundPlayback(key);
            return;
        }

        if (!(this.timelineSoundPlaybacksSeen instanceof Set)) this.timelineSoundPlaybacksSeen = new Set();
        this.timelineSoundPlaybacksSeen.add(key);
        if (!(this.timelineSoundPlaybacks instanceof Map)) this.timelineSoundPlaybacks = new Map();
        let playback = this.timelineSoundPlaybacks.get(key);
        if (playback && playback.soundId !== sound.soundId) {
            this.stopTimelineSoundPlayback(key, playback);
            playback = null;
        }
        if (!playback) {
            playback = this.startRangedSoundPlayback(target, sound, {
                ...configuration,
                duration: remaining,
                key,
                offset
            });
        }
        if (!playback) return;
        playback.source.playbackRate.value = configuration.speed;
        if (playback.gain) playback.gain.gain.value = configuration.volume / 100;
    },

    startRangedSoundPlayback (target, sound, configuration) {
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
            soundBank.getSoundPlayer(sound.soundId) : null;
        const buffer = player && player.buffer;
        if (!context || typeof context.createBufferSource !== 'function' || !buffer) return null;

        const offset = Math.max(0, toNumber(configuration.offset));
        if (Number.isFinite(buffer.duration) && offset >= buffer.duration) return null;
        if (!(this.timelineSoundSources instanceof Set)) this.timelineSoundSources = new Set();
        if (!(this.timelineSoundPlaybacks instanceof Map)) this.timelineSoundPlaybacks = new Map();

        const source = context.createBufferSource();
        const nodes = [source];
        source.buffer = buffer;
        source.playbackRate.value = configuration.speed;
        let output = source;
        let gain = null;
        if (typeof context.createGain === 'function') {
            gain = context.createGain();
            gain.gain.value = configuration.volume / 100;
            output.connect(gain);
            output = gain;
            nodes.push(gain);
        }
        output.connect(typeof audioEngine.getInputNode === 'function' ?
            audioEngine.getInputNode() : audioEngine.inputNode);

        const playback = {gain, key: configuration.key, nodes, soundId: sound.soundId, source};
        source.onended = () => {
            this.timelineSoundSources.delete(playback);
            if (playback.key && this.timelineSoundPlaybacks.get(playback.key) === playback) {
                this.timelineSoundPlaybacks.delete(playback.key);
            }
            nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        };
        this.timelineSoundSources.add(playback);
        if (playback.key) this.timelineSoundPlaybacks.set(playback.key, playback);
        const requestedDuration = Number(configuration.duration);
        const sourceDuration = Number.isFinite(requestedDuration) ? requestedDuration * configuration.speed : Infinity;
        if (Number.isFinite(sourceDuration)) source.start(0, offset, sourceDuration);
        else source.start(0, offset);
        return playback;
    },

    stopTimelineSoundPlayback (key, requestedPlayback) {
        if (!(this.timelineSoundPlaybacks instanceof Map)) this.timelineSoundPlaybacks = new Map();
        const playback = requestedPlayback || this.timelineSoundPlaybacks.get(key);
        if (!playback) return;
        playback.source.onended = null;
        try {
            playback.source.stop(0);
        } catch (error) {
            // The source may have ended between render-frame evaluations.
        }
        playback.nodes.forEach(node => {
            if (typeof node.disconnect === 'function') node.disconnect();
        });
        this.timelineSoundSources.delete(playback);
        if (this.timelineSoundPlaybacks.get(key) === playback) this.timelineSoundPlaybacks.delete(key);
    },

    startSoundAtTime (target, sound, seconds) {
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        const soundBank = target && target.sprite && target.sprite.soundBank;
        const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
            soundBank.getSoundPlayer(sound.soundId) : null;
        const buffer = player && player.buffer;
        if (!context || typeof context.createBufferSource !== 'function' || !buffer) return;

        const offset = Math.max(0, toNumber(seconds));
        if (Number.isFinite(buffer.duration) && offset >= buffer.duration) return;
        if (!(this.timelineSoundSources instanceof Set)) this.timelineSoundSources = new Set();

        const source = context.createBufferSource();
        const nodes = [source];
        source.buffer = buffer;
        source.playbackRate.value = Math.pow(2, toNumber(target.soundEffects && target.soundEffects.pitch) / 120);
        let output = source;

        if (typeof context.createStereoPanner === 'function') {
            const panNode = context.createStereoPanner();
            panNode.pan.value = clamp(toNumber(target.soundEffects && target.soundEffects.pan), -100, 100) / 100;
            output.connect(panNode);
            output = panNode;
            nodes.push(panNode);
        }
        if (typeof context.createGain === 'function') {
            const gainNode = context.createGain();
            gainNode.gain.value = clamp(toNumber(target.volume, 100), 0, 100) / 100;
            output.connect(gainNode);
            output = gainNode;
            nodes.push(gainNode);
        }
        output.connect(typeof audioEngine.getInputNode === 'function' ?
            audioEngine.getInputNode() : audioEngine.inputNode);

        const playback = {nodes, source};
        source.onended = () => {
            this.timelineSoundSources.delete(playback);
            nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        };
        this.timelineSoundSources.add(playback);
        source.start(0, offset);
    },

    playTimelineSounds (seconds) {
        if (this.timeline.recording) return;
        const audioEngine = this.runtime.audioEngine;
        const context = audioEngine && audioEngine.audioContext;
        if (!context || typeof context.createBufferSource !== 'function') return;
        if (!(this.timelineSoundSources instanceof Set)) this.timelineSoundSources = new Set();

        for (const {sound, target} of this.getRenderFrameSounds()) {
            const soundBank = target.sprite.soundBank;
            const player = soundBank && typeof soundBank.getSoundPlayer === 'function' ?
                soundBank.getSoundPlayer(sound.soundId) : null;
            const buffer = player && player.buffer;
            if (!buffer) continue;

            const pitch = toNumber(target.soundEffects && target.soundEffects.pitch);
            const playbackRate = Math.pow(2, pitch / 120);
            const offset = Math.max(0, toNumber(seconds) * playbackRate);
            if (Number.isFinite(buffer.duration) && offset >= buffer.duration) continue;

            const source = context.createBufferSource();
            const nodes = [source];
            source.buffer = buffer;
            source.playbackRate.value = playbackRate;
            let output = source;

            if (typeof context.createStereoPanner === 'function') {
                const panNode = context.createStereoPanner();
                panNode.pan.value = clamp(toNumber(target.soundEffects && target.soundEffects.pan), -100, 100) / 100;
                output.connect(panNode);
                output = panNode;
                nodes.push(panNode);
            }
            if (typeof context.createGain === 'function') {
                const gainNode = context.createGain();
                gainNode.gain.value = clamp(toNumber(target.volume, 100), 0, 100) / 100;
                output.connect(gainNode);
                output = gainNode;
                nodes.push(gainNode);
            }
            output.connect(typeof audioEngine.getInputNode === 'function' ?
                audioEngine.getInputNode() : audioEngine.inputNode);

            const playback = {nodes, source};
            source.onended = () => {
                this.timelineSoundSources.delete(playback);
                nodes.forEach(node => {
                    if (typeof node.disconnect === 'function') node.disconnect();
                });
            };
            this.timelineSoundSources.add(playback);
            source.start(0, offset);
        }
    },

    stopTimelineSounds () {
        if (!(this.timelineSoundSources instanceof Set)) {
            this.timelineSoundSources = new Set();
        }
        for (const playback of this.timelineSoundSources) {
            playback.source.onended = null;
            try {
                playback.source.stop(0);
            } catch (error) {
                // The source may already have ended between timeline ticks.
            }
            playback.nodes.forEach(node => {
                if (typeof node.disconnect === 'function') node.disconnect();
            });
        }
        this.timelineSoundSources.clear();
        if (!(this.timelineSoundPlaybacks instanceof Map)) this.timelineSoundPlaybacks = new Map();
        this.timelineSoundPlaybacks.clear();
        if (!(this.timelineSoundPlaybacksSeen instanceof Set)) this.timelineSoundPlaybacksSeen = new Set();
        this.timelineSoundPlaybacksSeen.clear();
        this.stopAllObjectVideoAudio();
    },

    beginTimelineSoundFrame () {
        if (!(this.timelineSoundPlaybacksSeen instanceof Set)) this.timelineSoundPlaybacksSeen = new Set();
        this.timelineSoundPlaybacksSeen.clear();
    },

    finishTimelineSoundFrame () {
        if (!(this.timelineSoundPlaybacks instanceof Map)) this.timelineSoundPlaybacks = new Map();
        if (!(this.timelineSoundPlaybacksSeen instanceof Set)) this.timelineSoundPlaybacksSeen = new Set();
        for (const [key, playback] of this.timelineSoundPlaybacks) {
            if (!this.timelineSoundPlaybacksSeen.has(key)) this.stopTimelineSoundPlayback(key, playback);
        }
    },

    beginObjectVideoAudioFrame () {
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        this.objectVideoAudioSeen.clear();
    },

    finishObjectVideoAudioFrame () {
        if (!(this.objectVideoAudio instanceof Map)) this.objectVideoAudio = new Map();
        if (!(this.objectVideoAudioSeen instanceof Set)) this.objectVideoAudioSeen = new Set();
        for (const [key, playback] of this.objectVideoAudio) {
            if (!this.objectVideoAudioSeen.has(key)) this.stopObjectVideoAudioEntry(key, playback);
        }
    },

    stopObjectVideoAudioEntry (key, playback) {
        if (!playback) return;
        playback.version = (Number(playback.version) || 0) + 1;
        const element = playback.element;
        if (element) {
            if (typeof element.pause === 'function') element.pause();
            if (typeof element.removeAttribute === 'function') element.removeAttribute('src');
            if (typeof element.load === 'function') element.load();
        }
        if (this.objectVideoAudio instanceof Map && this.objectVideoAudio.get(key) === playback) {
            this.objectVideoAudio.delete(key);
        }
    },

    stopObjectVideoAudio (target, configuration) {
        if (!(this.objectVideoAudio instanceof Map) || !target) return;
        const key = this.getObjectVideoPlaybackKey(target, configuration);
        this.stopObjectVideoAudioEntry(key, this.objectVideoAudio.get(key));
    },

    stopAllObjectVideoAudio () {
        if (!(this.objectVideoAudio instanceof Map)) {
            this.objectVideoAudio = new Map();
            return;
        }
        for (const [key, playback] of this.objectVideoAudio) {
            this.stopObjectVideoAudioEntry(key, playback);
        }
        if (this.objectVideoAudioSeen instanceof Set) this.objectVideoAudioSeen.clear();
    },

    getTimelineSounds () {
        const target = this.runtime.targets.find(item => item.isOriginal && !item.isStage);
        return target && target.sprite && Array.isArray(target.sprite.sounds) ?
            target.sprite.sounds.map(sound => sound.name) : [];
    },

    captureRenderingFrame () {
        if (typeof document === 'undefined') {
            throw new Error('Rendering frames are only available in a browser.');
        }
        const renderer = this.runtime.renderer;
        if (!renderer || !renderer.canvas) {
            throw new Error('The stage renderer is not ready.');
        }
        if (this.timeline.recording) this.resizeRendererForTimeline();
        if (typeof renderer.draw === 'function') renderer.draw();

        const [stageWidth, stageHeight] = this.getStageSize();
        const width = Math.max(1, Number(renderer.canvas.width) || stageWidth);
        const height = Math.max(1, Number(renderer.canvas.height) || stageHeight);
        const frame = document.createElement('canvas');
        frame.width = width;
        frame.height = height;
        const context = frame.getContext('2d');
        if (!context) throw new Error('Could not create a rendering frame.');
        context.drawImage(renderer.canvas, 0, 0, width, height);
        frame.reusable = false;
        return frame;
    },

    addRenderingFrame () {
        if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
        if (!Array.isArray(this.renderingFrameNumbers)) this.renderingFrameNumbers = [];
        const frame = this.captureRenderingFrame();
        this.renderingFrames.push(frame);
        const frameIndex = Number.isFinite(Number(this.timeline.renderFrameIndex)) ?
            Number(this.timeline.renderFrameIndex) : this.renderingFrames.length - 1;
        this.renderingFrameNumbers.push(frameIndex);
        if (!(this.renderingFrameCache instanceof Map)) this.renderingFrameCache = new Map();
        this.renderingFrameCache.set(this.getRenderingFrameCacheKey(frameIndex), frame);
        if (!(this.renderingSoundEventCache instanceof Map)) this.renderingSoundEventCache = new Map();
        this.renderingSoundEventCache.set(
            this.getRenderingFrameCacheKey(frameIndex),
            this.renderingSoundEvents.filter(event => Number(event.frame) === frameIndex).map(event => ({...event}))
        );
        this.emit('renderingFramesChanged', this.renderingFrames.length);
        return frame;
    },

    clearRenderingFrames (options = {}) {
        if (!Array.isArray(this.renderingFrames)) this.renderingFrames = [];
        this.renderingFrames.length = 0;
        if (!Array.isArray(this.renderingFrameNumbers)) this.renderingFrameNumbers = [];
        this.renderingFrameNumbers.length = 0;
        if (!Array.isArray(this.renderingFrameErrors)) this.renderingFrameErrors = [];
        this.renderingFrameErrors.length = 0;
        if (!options.preserveCache) {
            if (!(this.renderingFrameCache instanceof Map)) this.renderingFrameCache = new Map();
            this.renderingFrameCache.clear();
            if (!(this.renderingSoundEventCache instanceof Map)) this.renderingSoundEventCache = new Map();
            this.renderingSoundEventCache.clear();
        }
        if (!Array.isArray(this.renderingSoundEvents)) this.renderingSoundEvents = [];
        this.renderingSoundEvents.length = 0;
        this.emit('renderingFramesChanged', 0);
    },

    exportTimeline (options = {}) {
        const target = this.runtime.targets.find(item => item.isOriginal && !item.isStage);
        const format = this.normalizeRenderingFormat(options.format || this.timeline.exportFormat);
        if (format === 'png-sequence') return this.exportRenderingPngSequence();
        if (format === 'png-frame') return this.exportRenderingFramePng(options.frameIndex);
        if (format === 'audio-wav') {
            return this.exportRenderingAudioWav(target, this.timeline.sound, this.timeline.framerate);
        }
        return this.exportRenderingVideo(
            target,
            this.timeline.sound,
            this.timeline.framerate,
            format
        );
    },

    getRenderingSound (target, requestedSound) {
        const name = String(requestedSound || '');
        if (!name) return null;
        const sounds = target && target.sprite && target.sprite.sounds;
        return Array.isArray(sounds) ? sounds.find(sound => sound && sound.name === name) || null : null;
    },

    async decodeRenderingSound (sound, preferredAudio) {
        const data = sound && sound.asset && sound.asset.data;
        if (!data) return null;

        const audioEngine = this.runtime.audioEngine;
        if (audioEngine && typeof audioEngine.decodeSoundPlayer === 'function') {
            const player = await audioEngine.decodeSoundPlayer({data: data});
            if (player && player.buffer) {
                return {
                    buffer: player.buffer,
                    context: audioEngine.audioContext,
                    ownsContext: false
                };
            }
        }

        let context = preferredAudio && preferredAudio.context;
        if (!context) context = audioEngine && audioEngine.audioContext;
        let ownsContext = false;
        if (!context && typeof window !== 'undefined') {
            const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
            if (AudioContextConstructor) {
                context = new AudioContextConstructor();
                ownsContext = true;
            }
        }
        if (!context || typeof context.decodeAudioData !== 'function') {
            throw new Error('Audio export is not supported in this browser.');
        }
        const buffer = await context.decodeAudioData(copyArrayBuffer(data));
        return {buffer, context, ownsContext};
    },

    async decodeRenderingVideoAudio (video, preferredAudio) {
        const data = video && video.asset && video.asset.data;
        if (!data) return null;
        const audioEngine = this.runtime.audioEngine;
        if (audioEngine && typeof audioEngine.decodeSoundPlayer === 'function') {
            try {
                const player = await audioEngine.decodeSoundPlayer({data: data});
                if (player && player.buffer) {
                    return {
                        buffer: player.buffer,
                        context: audioEngine.audioContext,
                        ownsContext: false
                    };
                }
            } catch (error) {
                // Video containers are not accepted by every Scratch audio decoder; Web Audio may still decode it.
            }
        }

        let context = preferredAudio && preferredAudio.context;
        if (!context) context = audioEngine && audioEngine.audioContext;
        let ownsContext = false;
        if (!context && typeof window !== 'undefined') {
            const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
            if (AudioContextConstructor) {
                context = new AudioContextConstructor();
                ownsContext = true;
            }
        }
        if (!context || typeof context.decodeAudioData !== 'function') return null;
        try {
            const buffer = await context.decodeAudioData(copyArrayBuffer(data));
            return {buffer, context, ownsContext};
        } catch (error) {
            if (ownsContext && typeof context.close === 'function') {
                const closePromise = context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
            return null;
        }
    },

    async decodeRenderingAudio (target, requestedSound, framerate) {
        const clips = [];
        const legacySound = this.getRenderingSound(target, requestedSound);
        if (requestedSound && !legacySound) {
            throw new Error('The selected rendering sound could not be found.');
        }
        if (legacySound) {
            clips.push({
                frame: 0,
                pan: 0,
                pitch: 0,
                sound: legacySound,
                volume: 100
            });
        }
        for (const event of this.renderingSoundEvents || []) clips.push(event);
        if (!clips.length) return null;

        let sharedAudio = null;
        const decodedClips = [];
        for (const clip of clips) {
            const decoded = clip.video ?
                await this.decodeRenderingVideoAudio(clip.video, sharedAudio) :
                await this.decodeRenderingSound(clip.sound, sharedAudio);
            if (!decoded || !decoded.buffer) continue;
            if (!sharedAudio) sharedAudio = decoded;
            const numericPlaybackRate = Number(clip.playbackRate);
            const decodedClip = {
                buffer: decoded.buffer,
                offset: Math.max(0, toNumber(clip.offset)),
                pan: clamp(toNumber(clip.pan), -100, 100) / 100,
                playbackRate: Number.isFinite(numericPlaybackRate) && numericPlaybackRate > 0 ?
                    numericPlaybackRate : Math.pow(2, toNumber(clip.pitch) / 120),
                startTime: Math.max(0, Number.isFinite(Number(clip.startTime)) ?
                    Number(clip.startTime) : toNumber(clip.frame) / framerate),
                volume: clamp(toNumber(clip.volume, 100), 0, 100) / 100
            };
            if (Number.isFinite(Number(clip.duration))) {
                decodedClip.duration = Math.max(0, Number(clip.duration));
            }
            decodedClips.push(decodedClip);
        }
        if (!sharedAudio || !decodedClips.length) {
            if (sharedAudio && sharedAudio.ownsContext && sharedAudio.context &&
                typeof sharedAudio.context.close === 'function') {
                const closePromise = sharedAudio.context.close();
                if (closePromise && typeof closePromise.catch === 'function') closePromise.catch(() => {});
            }
            return null;
        }
        return {
            clips: decodedClips,
            context: sharedAudio.context,
            ownsContext: sharedAudio.ownsContext
        };
    }
};

export default MovieAssetManagerSoundExportMethods;
